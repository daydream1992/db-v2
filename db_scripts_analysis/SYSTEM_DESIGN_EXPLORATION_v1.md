# DB数据库_v2 系统化方案探索 v1

> 目标：把散装的 26 个入库脚本 + run.py CLI，演进为一个**可治理、可观测、可编排**的数据管道平台。
> 本文档是探索稿，不是最终方案。先看全貌，再逐块决策。

---

## 〇、一句话定位

**这不是"重写一套入库系统"，而是给现有的 run.py + 脚本契约，套上一层「治理壳 + 可视化壳」。**

现有资产（run.py 的 scan/check/get/add/remove/fix/backup、@meta 元数据、FIELD_MAP、tdx_reader）都保留，只是：
- 把"靠人记"的规范 → 升级为"机器校验"的规范
- 把"命令行才能看"的状态 → 升级为"UI 看板可见"的状态
- 把"手动 all"的执行 → 升级为"调度+依赖+重试"的编排

---

## 一、三层架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  观测层 (Observability)  ← UI 管理台 (Next.js)              │
│  Dashboard / Catalog / Health / Orchestration / Lineage     │
│  Lint Report / Logs / Data Dictionary / Settings            │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST API (read-heavy)
┌──────────────────────────┴──────────────────────────────────┐
│  治理层 (Governance)  ← 单一事实来源 + 校验                  │
│  meta registry (YAML/JSON) · schema contract · lint engine  │
│  lineage graph · schedule plan · data dictionary            │
└──────────────────────────┬──────────────────────────────────┘
                           │ 调用
┌──────────────────────────┴──────────────────────────────────┐
│  执行层 (Execution)  ← 现有 run.py 演进                     │
│  BaseIngest 基类 · fetcher 适配器 · orchestrator · runner    │
│  state machine · retry · backfill · tdx_reader (保留)       │
└─────────────────────────────────────────────────────────────┘
        │                          │
   DuckDB (profit_radar)      TDX/tqcenter/文件 (数据源)
```

**三层职责切分：**

| 层 | 关心什么 | 不关心什么 |
|----|---------|-----------|
| 执行层 | "怎么把数据弄进 DB" | UI 长啥样、谁在调度 |
| 治理层 | "有哪些表、谁依赖谁、合不合规" | 具体怎么 fetch |
| 观测层 | "现在什么状态、出了什么问题、点哪里能跑" | 实现细节 |

---

## 二、治理层：元数据 SSOT + 可机器校验的规范

### 2.1 元数据单一事实来源（SSOT）

现状：@meta 在脚本头部 + tables.json（备用）+ data_dictionary.json（字段级）+ 散落的 README。**四处真相，互相矛盾。**

目标：**一个 registry，多处渲染。**

```
config/registry/
  tables/
    stock_daily_kline.yaml      # 每表一个声明文件
    trading_calendar.yaml
    ...
  sources.yaml                  # 数据源定义 (TQ/TDX二进制/SQL派生)
  schedules.yaml                # 调度计划
```

单个 `trading_calendar.yaml` 长这样：

```yaml
# config/registry/tables/trading_calendar.yaml
table: trading_calendar
cn: 交易日历
dir: 1_入库
sort: 091
schedule: daily
mode: increment
source: API(TQ)

# 依赖（血缘用）
depends_on:
  - table: tq.get_trading_dates   # 外部源
upstream_tables: []                # 库内无依赖
downstream_tables:                 # 谁依赖我（自动反查填充）
  - stock_daily_kline              # K线增量要用交易日判定

# Schema 契约
schema:
  - name: date
    type: DATE
    cn: 日期
    nullable: false
  - name: is_trading
    type: BOOLEAN
    cn: 是否交易日
  - name: market
    type: VARCHAR
    cn: 市场

# 入库语义
dedup_key: [date]              # 增量去重键
date_col: date                 # 新鲜度判定列
freshness_rule: daily          # daily=必须到最新交易日

# 字段映射（给 data_dictionary 渲染）
field_map:
  is_trading: 是否交易日

# 执行配置
retry: { max: 3, backoff: 30 }
timeout: 300
```

**收益：**
- @meta 不再写在脚本头部（消除"脚本改了忘改 @meta"的矛盾）——脚本只保留代码，元数据在 YAML
- `tables.json` / `data_dictionary.json` / README 全部由 YAML **生成**，不再是手写真相
- 血缘 `upstream/downstream` 显式声明，不再靠 run.py 猜

### 2.2 可机器校验的编码规范（核心创新）

现状规范在 CLAUDE.md 里是"自然语言 + 人记"。升级为 **lint engine**，每个规范一条校验规则，CI/pre-commit 强制：

```python
# common/lint/rules.py  (示意)
class Rule_001_TableNameFormat(Rule):
    """表名必须纯小写下划线，禁数字开头"""
    def check(self, reg: TableRegistry) -> list[Issue]:
        return [Issue(t.table, f"表名违规: {t.table}")
                for t in reg.tables
                if not re.match(r'^[a-z][a-z0-9_]*$', t.table)]

class Rule_002_MetaCodeConsistency(Rule):
    """YAML 的 mode/schedule 必须与脚本常量一致"""
    def check(self, reg, script_ast): ...

class Rule_003_ContractSignature(Rule):
    """入库脚本必须实现 BaseIngest 子类，不得自由签名"""
    ...

class Rule_004_ColumnNameNoChinese(Rule):
    """列名禁中文禁空格"""
    ...

class Rule_005_SortUnique(Rule):
    """sort 编号全局唯一"""
    ...

class Rule_006_DedupKeyExists(Rule):
    """increment 模式必须声明 dedup_key"""
    ...

class Rule_007_DateColExists(Rule):
    """必须声明 date_col（健康度判定用）"""
    ...

class Rule_008_LineageNoCycle(Rule):
    """血缘图无环"""
    ...

class Rule_009_NoCircularImport(Rule):
    """入库脚本禁止 import run.py"""
    ...
```

**lint 输出分级：**

| 级别 | 含义 | 处理 |
|------|------|------|
| 🔴 RED | 阻断（契约违反、表名违规、环依赖） | CI 拒绝合并 |
| 🟡 YELLOW | 警告（缺字段中文、mode 矛盾） | 提示但不阻断 |
| 🔵 BLUE | 建议（命名风格、缺文档） | 仅提示 |

`run.py lint` 一键跑全部规则，UI 的「规范校验」页直接渲染结果。

### 2.3 血缘图（Lineage）

从 YAML 的 `depends_on` / `upstream_tables` / `downstream_tables` 构建 DAG：

```
tq.get_trading_dates ──► trading_calendar ──► stock_daily_kline ──► stock_kline_weekly
                                            ──► stock_kline_1m   ──► pianpao_daily
                                            ──► dim_security_type
```

**用途：**
- 上游表坏了 → 一键查"哪些下游受影响"
- 改某表 schema → 查"哪些脚本要同步改"
- 调度排序自动拓扑排序（替代 run.py 现在的 sort 数字）

---

## 三、执行层：编排引擎 + 状态机

### 3.1 BaseIngest 基类（解决"5 种签名"问题）

现状 26 个脚本 5 种 `fetch_data` 签名。统一为：

```python
# common/ingest_base.py
class BaseIngest(ABC):
    # 子类必须声明（可从 YAML 注入，不必写死）
    table: str
    mode: str = 'increment'
    
    @abstractmethod
    def fetch_data(self, ctx: IngestContext) -> pd.DataFrame:
        """纯取数，不碰 DB。ctx 提供 con(只读)/force/last_date/params"""
    
    @abstractmethod
    def ensure_table(self, con): ...
    
    # save_data 有默认实现，子类一般不用 override
    def save_data(self, con, df):
        if self.mode == 'increment':
            self._delete_increment(con, df)
        else:
            con.execute(f"DELETE FROM {self.table}")
        self._bulk_insert(con, df)   # 默认 COPY parquet
    
    # run 有默认实现，子类几乎不用 override
    def run(self, force=False) -> bool:
        with self._transaction() as con:
            self.ensure_table(con)
            if self._is_fresh(con, force): 
                return True
            df = self.fetch_data(self._ctx(con, force))
            if df.empty: return True
            self.save_data(con, df)
            return True
```

**特殊脚本逃生口：**
- 流式（080/137）：override `run`，用 `yield` 模式，基类提供 `_flush(con, df)` 工具
- 多表产物（70_pianpao）：声明 `outputs: [pianpao_daily, pianpao_daily_summary, ...]`
- SQL 派生（82/83/84）：用 `BaseCompute`，`fetch_data(con)` 直接 execute SQL

### 3.2 执行状态机

每个表的每次执行，状态机化：

```
PENDING ──► RUNNING ──► SUCCESS
              │
              ├──► FAILED ──► RETRY ──► RUNNING
              ├──► SKIPPED (is_fresh)
              └──► TIMEOUT
```

状态落库 `pipeline_runs` 表：

```sql
CREATE TABLE pipeline_runs (
    id BIGINT PRIMARY KEY,
    table_name VARCHAR,
    run_id VARCHAR,          -- uuid
    trigger VARCHAR,         -- schedule/manual/health-fix/backfill
    status VARCHAR,          -- pending/running/success/failed/skipped
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    rows_in BIGINT,
    error TEXT,
    force BOOLEAN,
    log_path VARCHAR
);
```

**收益：**
- UI 能查"某表最近 N 次执行"
- 失败自动重试（按 YAML 的 retry 配置）
- backfill（补数）记录可追溯，不再是一笔糊涂账

### 3.3 编排器（Orchestrator）

替代 `run.py all` 的"无脑顺序执行"：

```python
# common/orchestrator.py
class Orchestrator:
    def run_schedule(self, tier: str):
        """按调度层跑，自动拓扑排序"""
        tables = self.registry.filter(schedule=tier)
        ordered = self.lineage.topo_sort(tables)   # 按依赖排，不再靠 sort 数字
        for t in ordered:
            self.runner.submit(t, trigger='schedule')
    
    def run_table(self, table, force=False, backfill_dates=None):
        """单表执行，自动连带重跑下游（可选）"""
    
    def run_dag(self, root_table):
        """跑一个表及其全部下游（schema 变更后用）"""
```

**调度计划（schedules.yaml）：**
```yaml
schedules:
  daily_1700:          # 每日盘后 17:00
    cron: "0 17 * * 1-5"
    tier: daily
  weekly_friday:
    cron: "0 18 * * 5"
    tier: weekly
```

可接 cron / systemd timer / 或保留现有"手动 python run.py all"。

---

## 四、观测层：UI 管理台信息架构

### 4.1 页面结构（9 个主页面）

```
DataOps 管理台
├── 📊 Dashboard          全局健康度 + 今日执行 + 告警
├── 📚 脚本目录 Catalog   所有表/脚本，卡片+表格双视图
├── 💊 健康度 Health       红绿灯矩阵 + 新鲜度 + 行数趋势
├── 🔀 编排 Orchestration  DAG 图 + 调度计划 + 执行历史 + 手动触发
├── 🔗 血缘 Lineage        表↔脚本↔源 关系图（可点击下钻）
├── ✅ 规范校验 Lint       规则列表 + 违规清单 + 修复建议
├── 📜 日志 Logs           按表/时间/级别筛选 + 全文搜索
├── 📖 数据字典 Dictionary 字段级元数据浏览
└── ⚙️ 设置 Settings       DB 连接 + 调度配置 + 数据源
```

### 4.2 各页面核心信息

**Dashboard（概览）：**
- 顶部 4 个 KPI 卡：总表数 / 健康表数 / 滞后表数 / 今日执行成功率
- 中部：今日执行时间线（gantt 风格，每条 = 一个表的执行）
- 右侧：待处理告警列表（红/黄表、lint 失败、失败重试）
- 底部：行数 Top10 表 + 增长趋势 mini chart

**Catalog（脚本目录）：**
- 左侧筛选：目录(1_入库/2_计算) / 类型(事实/维度/视图) / schedule / 数据源
- 主区：表格视图（表名/cn/sort/dir/schedule/mode/行数/最新日期/健康度/操作）
- 行操作：查看详情 / 手动跑 / 强制重跑 / 查血缘 / 查日志
- 右侧抽屉：单表详情（schema 列表+中文、FIELD_MAP、最近10次执行、上下游）

**Health（健康度）：**
- 红绿灯矩阵：每行一个表，列=日期（近7天），格子颜色=当日是否成功+新鲜
- 新鲜度列：绿(最新)/黄(无日期列)/红(滞后)/灰(once)
- 一致性栏：孤儿表数 / 死脚本数 / 字段中文 TODO 数
- 「补数」按钮：对标红表批量 force 重跑（带确认）

**Orchestration（编排）：**
- DAG 可视化（react-flow / dagre）：节点=表，边=依赖，颜色=健康度
- 调度计划表：cron 表达式 + 下次执行时间 + 上次结果
- 执行历史：pipeline_runs 表的时序列表，可点开看日志
- 「立即执行」：选表 + force/backfill 选项 → 触发

**Lineage（血缘）：**
- 中心选一个表 → 展开上下游 N 层
- 节点点击下钻
- 边显示「依赖类型」（数据依赖 / 调度依赖）

**Lint（规范校验）：**
- 规则清单：每条规则 + 通过/失败计数
- 违规列表：表名 + 规则 + 级别 + 修复建议 + 「跳转脚本」
- 趋势：lint 通过率随时间（鼓励持续改善）

**Logs（日志）：**
- 筛选：表 / 级别 / 时间范围 / 关键字
- 实时 tail（WebSocket 推送，跑 all 时实时看）
- 失败日志高亮 + 堆栈

**Dictionary（数据字典）：**
- 左侧表树，右侧字段表：列名 / 类型 / 中文 / 来源 / 备注
- 搜索：按中文反查列名

### 4.3 UI 设计原则

- **读多写少**：90% 页面是只读看板，写操作（触发执行/改配置）走确认弹窗
- **一屏一主题**：每页一个核心问题（"哪坏了"/"该跑啥"/"谁依赖谁"）
- **颜色语义统一**：绿=好 / 黄=待查 / 红=坏 / 灰=不适用，全站一致
- **响应式**：表格在窄屏转卡片，DAG 支持缩放平移
- **暗色模式**：盘后盯盘场景友好

---

## 五、从入库到调用的全流程（端到端）

### 5.1 全流程时序

```
[1] 声明        [2] 校验        [3] 调度        [4] 执行        [5] 监控        [6] 调用
定义表YAML  →  lint+schema  →  cron触发     →  runner跑     →  health采集  →  用户查询
   │              │              │              │              │              │
   ▼              ▼              ▼              ▼              ▼              ▼
registry/    lint engine     schedules     pipeline_runs   health表      _labeled视图
tables/*.yaml issues列表     .yaml         状态机          红绿灯        JOIN dim
```

### 5.2 各阶段产物

| 阶段 | 输入 | 产物 | 谁负责 |
|------|------|------|--------|
| 1 声明 | 业务需求 | `tables/X.yaml` + 脚本骨架 | 开发者 |
| 2 校验 | YAML + 脚本 AST | lint issues 列表 | lint engine (CI) |
| 3 调度 | schedules.yaml + cron | 触发指令 | orchestrator |
| 4 执行 | 触发指令 | 数据入 DuckDB + pipeline_runs 记录 | runner (BaseIngest) |
| 5 监控 | pipeline_runs + DB 状态 | health 红绿灯 + 告警 | health collector |
| 6 调用 | 用户的 SQL 需求 | `_labeled` 视图 / dim JOIN | 用户/下游应用 |

### 5.3 「调用」环节特别说明

现状"调用"= 用户自己写 SQL，靠记忆知道哪张表能 join 谁。run.py 有 `cmd_join` 给建议但只是 CLI。

升级后：
- **数据字典 UI** 替代 `cmd_join`：可视化看每张表的字段+中文+可关联的 dim
- **`_labeled` 视图自动生成**：YAML 声明 `labeled: true` 的表，lint/engine 自动建 `{table}_labeled` 视图（JOIN dim）
- **SQL Playground**（可选 P2）：UI 里直接写 SQL 跑 DuckDB，看结果

---

## 六、与现有 run.py 的演进关系（不推翻）

| 现有 run.py 命令 | 演进策略 |
|----------------|---------|
| `all [--weekly/--full]` | → orchestrator.run_schedule()，UI「立即执行」按钮 |
| `scan` | → UI Health 页（红绿灯矩阵）|
| `check <table>` | → UI Catalog 单表详情抽屉 |
| `get <table>` | → UI Dictionary + SQL Playground |
| `add <table>` | → 脚手架命令 `scaffold <table>`，生成 YAML + 脚本骨架 |
| `remove <table>` | → UI 操作 + 影响面提示（下游表数）|
| `fix <table>` | → UI Health 页「补数」按钮 |
| `backup` | → UI Settings 定时备份配置 |
| `catalog` / `health` / `join` / `integrity` | → 各自独立 UI 页 |

**run.py 不删**，保留为 CLI 入口（CI/脚本场景仍需）。UI 后端调 run.py 的函数或直接调 orchestrator。

---

## 七、技术选型建议

| 组件 | 选型 | 理由 |
|------|------|------|
| UI 前端 | Next.js 16 + shadcn/ui | 现有项目已就绪，组件齐全 |
| UI 后端 API | Next.js API Routes | 与前端同构，无额外服务 |
| 元数据存储 | YAML 文件 + DuckDB `pipeline_runs` 表 | YAML 利于 git diff，DuckDB 存运行时状态 |
| 执行引擎 | 现有 Python run.py + BaseIngest | 不重写，渐进演进 |
| 调度器 | cron / systemd / 或 APScheduler | 先用系统 cron，不引入 Airflow 这么重 |
| DAG 可视化 | react-flow | 轻量、可交互 |
| 图表 | recharts / shadcn chart | 健康/趋势 |
| 实时日志 | WebSocket (socket.io mini-service) | 跑 all 时实时 tail |
| 数据库 | DuckDB (现有) | 不变 |

**刻意不选：** Airflow / Dagster / Prefect —— 对 26 个表 + 单人维护的规模过重，引入成本 > 收益。这个方案的哲学是「够用就好，能演进」。

---

## 八、落地路线图（分阶段，每阶段独立可交付）

| 阶段 | 时长 | 内容 | 交付物 |
|------|------|------|--------|
| **E0 探索**（本阶段）| 1 天 | 本文档 + UI 原型（mock 数据） | 本文档 + 可点击的 UI demo |
| **E1 治理地基** | 3 天 | YAML registry + lint engine(9 条规则) + BaseIngest 基类 | `run.py lint` 可跑、3 个脚本迁移示范 |
| **E2 执行状态机** | 2 天 | pipeline_runs 表 + runner 改造 + orchestrator | 执行有记录、可重试 |
| **E3 UI 接真实数据** | 3 天 | UI 后端 API 接 registry/pipeline_runs/health | UI 看到真状态 |
| **E4 全量迁移** | 5 天 | 26 个脚本迁 BaseIngest + 列名英文化 + 废弃清理 | lint 全绿 |
| **E5 高级** | 按需 | DAG 调度 + 实时日志 + SQL Playground | 全功能 |

**E0 之后，你可以决定：**
- 整体方向认不认可？
- 哪些页面优先做（E3 时先接哪个）
- 是否接受 YAML registry 替代脚本头部 @meta
- BaseIngest 基类 vs 保留平铺风格

---

## 九、本次探索的 UI 原型说明

为让你直观感受方案，我会用 Next.js 搭一个**全 mock 数据的 UI 原型**，覆盖 9 个主页面：

1. Dashboard — KPI + 执行时间线 + 告警
2. Catalog — 脚本目录表格 + 详情抽屉
3. Health — 红绿灯矩阵 + 补数
4. Orchestration — DAG 图 + 执行历史
5. Lineage — 血缘关系图
6. Lint — 规则校验报告
7. Logs — 日志筛选
8. Dictionary — 数据字典
9. Settings — 配置

mock 数据基于真实脚本清单（26 个表 + 8 个 lint issue + 诊断报告里的 bug 清单），让你看到的是**你项目的真实样子**，不是假数据。

原型目的：验证信息架构是否合理、交互是否顺手，再决定是否投入 E1+ 的真实开发。
