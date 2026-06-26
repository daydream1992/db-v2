# DB数据库_v2 脚本库诊断报告与治理方案

> 评审范围：`DB数据库_v2.zip` 解压后全部内容（1_入库 / 2_计算 / 3_策略 / 4_工具 / 5_bangdan / run.py / 文档）
> 评审日期：2026-06-26
> 评审方式：逐文件通读 + grep 量化统计

---

## 一、项目全貌（实际盘点）

| 目录 | .py 文件数 | 总行数 | 状态 |
|------|-----------|--------|------|
| `1_入库/` | 16（active）+ 18（废弃） | ~3,400 | 主力，但混乱 |
| `2_计算/` | 10 | ~1,100 | 模式不统一 |
| `3_策略/` | 1（check_health） | 148 | 几乎空置 |
| `4_工具/` | 7 | ~2,400 | tdx_reader 1608 行是核心 |
| `5_bangdan/` | 1 | 239 | 独立，未接入 run.py |
| `run.py` | 1 | 903 | 包工头 CLI |
| **合计** | **~45 active** | **~8,700** | |

> ⚠️ `dbv2-skeleton.md` 自称「70 个脚本」，但实际 active 只有 ~26 个数据脚本。骨架文档与实物严重脱节（下文详述）。

### 编码规则（已从 CLAUDE.md / dbv2-skeleton.md 提炼）

1. **脚本命名**：`{3位sort}_{table}.py`，`table` 部分即 DuckDB 表名
2. **表名**：纯小写下划线，禁止数字开头（DuckDB 限制）
3. **目录分类**：`1_入库`（外部数据源→DB）/ `2_计算`（SQL 派生）
4. **头部 `@meta`**：`table / cn / dir / sort / schedule / mode / source`，run.py 优先读它
5. **脚本契约**：`run(force=False)→bool` + `ensure_table(con)` + `fetch_data()` / `fetch_data(con)` + `save_data(con, df)`
6. **入库语义**：增量先 DELETE 再 INSERT，全量先清空再 INSERT
7. **列名规范**：全小写下划线，禁中文禁空格
8. **SSOT**：`config/data_dictionary.json`（生成器产出，不手改）+ 脚本内 `FIELD_MAP`
9. **schedule 映射**：每日→daily / 每周→weekly / 每月→monthly / 一次性→once

规则本身设计是合理的。问题出在**执行层大面积违规且无强制校验**。

---

## 二、诊断：8 类核心问题（附证据）

### 问题 1：脚本契约四分五裂（最严重）

CLAUDE.md 规定 `fetch_data()`（入库无参）/ `fetch_data(con)`（计算带参）+ `save_data(con, df)`。实际至少有 **5 种签名变体**：

| 模式 | 代表脚本 | 问题 |
|------|---------|------|
| 标准 `fetch_data()` + `save_data(con,df)` | 91/95/104/262 | ✅ 合规 |
| `fetch_data(con)` 但属于 1_入库 | `10_stock_daily_kline.py` | ❌ 入库脚本却用了计算脚本的签名 |
| 生成器 `fetch_data(min_date)` yield (file,df) | `080_stock_kline_1m.py` | ❌ run() 自己迭代，绕过 save_data 契约 |
| `fetch_and_save(con, force)` 合二为一 | `137_capital_info.py` | ❌ 完全没有 fetch_data/save_data |
| `fetch_data(con, force)` 内部直接 INSERT，无 save_data | `82/83/84/36/17/18/001/19`（8 个计算脚本） | ❌ fetch_data 有副作用且不返回 df |
| 自定义 `run(target_date, force, report_only)` | `70_pianpao_daily.py` | ❌ run 签名都不一样 |

**后果**：run.py 的 `cmd_all` 只能调 `mod.run(force)`，对内部结构无感知；但任何想复用 `fetch_data`/`save_data` 的工具（如 ingest_plan、check、health 自动补数）都会因签名不一致而失败或需要特判。

### 问题 2：`@meta` 与代码常量互相矛盾

| 脚本 | @meta 写的 | 代码常量 | 矛盾点 |
|------|-----------|---------|--------|
| `34_t_bk5_19_.py` | `mode=increment` | `MODE='full'` | mode 相反 |
| `3_策略/check_health.py` | `table=-` | — | 占位符 `-` 会被 run.py 当成真表名 |
| `4_工具/gen_skeleton.py` | `table=skeleton` | — | 工具脚本不该有 @meta，会被误收录 |
| `4_工具/ingest_plan.py` | `table=kline_ingest_plan` | — | 同上 |
| `dbv2-skeleton.md` | sort=094 撞号（dim_gp_indicator 与 sector_bk05_19） | — | 文档已记录但未根治 |

**后果**：run.py 的 `get_all_scripts_meta()` 会把 `table=-` / `table=skeleton` / `table=kline_ingest_plan` 当成数据表，污染 scan/catalog/health 输出。

### 问题 3：DRY 违反——同一段代码复制 N 份

| 重复代码 | 出现次数 | 文件 |
|---------|---------|------|
| `DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'` | **49 次** | 几乎每个 .py |
| TQ 初始化样板（TQ_PATHS 循环 + tq.initialize） | **9 次**（active） | 91/101/104/137/262/35/105 + 废弃 |
| `_stock_code_to_tdx()` 函数 | 2 次（完全相同） | 101 / 104 |
| `_get_all_codes()` / `_int_to_date_str()` | 各 1+ | 137（应抽公共） |
| `sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))` | ~12 次 | 几乎所有入库脚本 |
| save_data 的 DELETE+INSERT 模板 | ~10 次 | 91/95/33 等几乎一字不差 |
| KLINE_TABLES 清单 | 2 份 | ingest_plan.py 硬编码 vs run.py 从 @meta 扫 |

**后果**：
- DB 路径换位置/换名 → 改 49 个文件
- TQ 初始化逻辑修一个 bug → 改 9 个文件，漏改必出事
- `91_trading_calendar.py` 第 70 行 `isinstance(dates, pandas.DatetimeIndex)` 用了未导入的 `pandas`（只 import 了 `pd`），这种 bug 在复制粘贴中极易扩散

### 问题 4：列名规范大面积违反

CLAUDE.md 明确「列名全小写下划线，禁中文禁空格」。实际：

| 脚本 | 违规列名 |
|------|---------|
| `10_stock_daily_kline.py` | `涨跌幅` `换手率` `前复权因子` |
| `262_stock_block_relation.py` | `板块代码` `板块名称` `板块类型` `成分股数` |
| `34_t_bk5_19_.py` | `涨跌数` `总市值` `流通市值`（与英文 `pe_ttm` 混用） |
| `92_market_sc1_42.py` | 「清爽中文列名」写在 docstring 里，明显是设计选择 |

**后果**：DuckDB 列名带中文虽能跑，但①跨工具（dbt/外部 BI）兼容差 ②SQL 里要频繁加双引号 ③与 `config/data_dictionary.json` 的「英文列名+中文含义」SSOT 设计冲突——既然 FIELD_MAP 已经存了中文，列名就没必要再中文。

### 问题 5：未实现/僵尸脚本混在 active 目录

| 脚本 | 问题 |
|------|------|
| `33_sector_stocks.py` | `fetch_data()` 只返回空 + warning；`ensure_table` 里表名字面量写着 `表名`（中文占位符），根本跑不通 |
| `34_t_bk5_19_.py` | 文件名带尾下划线 `34_t_bk5_19_.py`；表名 `t_bk5_19` 与骨架文档的 `sector_trading_data` 不符 |

这类「半成品」混在 1_入库 里，run.py `all` 会尝试执行并 FAIL，污染健康度统计。

### 问题 6：废弃目录（18 个脚本）未真正隔离

`1_入库/废弃/` 里有 18 个 .py，全部带 `@meta`。run.py 的 `get_all_scripts_meta()` 只扫 `DIR_ORDER=['1_入库','2_计算']` 顶层 `*.py`——**但 `1_入库/废弃/` 是子目录，glob('*.py') 不会递归**，所以当前侥幸没被收录。

**隐患**：一旦有人改 run.py 为 `rglob`，或把废弃脚本移回上层，18 个僵尸立刻复活。且废弃目录的 README.md 里有 62 条编号清单，与 active 的 ~26 条对不上，极易误导。

### 问题 7：文档三处自相矛盾 / 严重过时

| 文档 | 问题 |
|------|------|
| `dbv2-skeleton.md` | 称「1_入库 31 个 / 2_计算 8 个」，实际 active 16+10；列出的 131~148 系列脚本大部分已在废弃目录 |
| `2_计算/README.md` | 列了 `11_stock_extended_info` / `55_etf_derived_indicator`，**这两个文件根本不存在**；漏了 19/36/70/71/82/83/84 |
| `1_入库/废弃/README.md` | 62 条编号清单是历史快照，与现状脱节 |

**后果**：接手者读文档会被误导，按文档去找脚本找不到。

### 问题 8：循环依赖 + 模块污染

- `137_capital_info.py` 第 28 行 `from run import _last_trading_day` ——**入库脚本反向 import run.py**。run.py 体量 903 行，import 它会执行其顶层代码（含 logger 配置、常量定义）。这是反依赖方向。
- 几乎所有入库脚本都 `sys.path.insert(0, ...)` 操纵全局 sys.path，多脚本被 run.py 用 importlib 加载时会互相污染 path。

---

## 三、解决方案（三档，按侵入度递增）

### 🟢 方案 A：零风险清理（立即可做，不改逻辑）

只动文档/废弃文件/占位符，不动任何 active 业务逻辑：

1. **删除或 gitignore `1_入库/废弃/`** —— 当前没被 run.py 收录，纯属噪音。要么彻底删，要么移到项目根 `archive/deprecated/` 并去掉 `@meta`。
2. **修占位 @meta**：`3_策略/check_health.py` 的 `table=-`、`4_工具/gen_skeleton.py` 的 `table=skeleton`、`4_工具/ingest_plan.py` 的 `table=kline_ingest_plan` → 全部删掉 @meta 行（工具脚本不该有）。
3. **同步三份文档**：`dbv2-skeleton.md` / `2_计算/README.md` / `1_入库/废弃/README.md` 按 active 实物重生成（gen_skeleton.py 本就是干这个的，先修它的 @meta 再跑）。
4. **修明显 bug**：`91_trading_calendar.py:70` 的 `pandas.DatetimeIndex` → `pd.DatetimeIndex`；`91` 的 TQ_PATHS 重复项去重。
5. **删/标记 `33_sector_stocks.py`**：`ensure_table` 里写着字面量「表名」，要么实现要么移走。

### 🟡 方案 B：中度治理——抽公共层 + 强制契约（推荐主攻方向）

目标：消除 90% 重复，让 26 个脚本变薄、变一致，但不改业务语义。

#### B1. 建立 `common/` 公共模块

```
common/
  __init__.py
  config.py        # DB_PATH / TQ_PATHS / PROJECT_ROOT 单一来源
  db.py            # get_con() / run_in_transaction() 上下文管理
  tq_client.py     # init_tq() 单例 + get_tq(); _stock_code_to_tdx()
  tdx_codes.py     # _stock_code_to_tdx / _get_all_codes / _int_to_date_str
  ingest_base.py   # BaseIngest 抽象基类（见下）
  logger.py        # 统一 logger 配置
```

每个入库脚本顶部从 30 行缩到 5 行：
```python
from common import BaseIngest, get_tq
class Ingest(BaseIngest):
    TABLE='trading_calendar'; MODE='increment'; SCHEDULE='daily'
    def fetch_data(self): ...
```

#### B2. 用基类固化契约（解决「5 种签名」问题）

```python
class BaseIngest(ABC):
    TABLE:str; MODE:str; SCHEDULE:str; DB_PATH = config.DB_PATH
    @abstractmethod
    def fetch_data(self) -> pd.DataFrame: ...
    @abstractmethod
    def ensure_table(self, con): ...
    def save_data(self, con, df):  # 默认实现 DELETE+INSERT
        ...
    def run(self, force=False) -> bool:  # 默认实现，子类一般不用重写
        ...
```

收益：26 个脚本里的 `run()` 几乎全是模板（20+ 行重复），用基类后每个脚本只剩 `fetch_data` + `ensure_table` + 常量。**预计代码量减少 40-50%**。

对特殊脚本（080 生成器、137 流式、70 pianpao）保留 override 能力，但要在基类里留 hook。

#### B3. @meta 一致性校验脚本

新增 `common/lint_meta.py`：扫描所有 .py，断言：
- @meta 的 `mode` == 代码 `MODE` 常量
- @meta 的 `table` == 代码 `TABLE` 常量
- `table` 不含中文/不以数字开头
- `sort` 不重复（全局唯一）
- 非 1_入库/2_计算 目录的脚本不得有 @meta

挂到 git pre-commit + run.py 新增 `lint` 子命令。**把问题 2/4/6 变成 CI 报错而非靠人记**。

#### B4. 列名统一为英文（配合 data_dictionary SSOT）

把 `涨跌幅`→`change_pct`、`板块代码`→`block_code` 等。中文含义已经存在 FIELD_MAP / dim 表里，列名没必要再中文。这是一次性 ALTER TABLE RENAME COLUMN + 改脚本，做完一劳永逸。

> ⚠️ 这一步会动表结构，属 CLAUDE.md 的「敏感操作」，需你授权后分表逐个做。

### 🔴 方案 C：架构重做（侵入最大，长期收益最高）

把「一个脚本一个表」升级为「声明式配置 + 通用引擎」：

```yaml
# config/tables/trading_calendar.yaml
table: trading_calendar
cn: 交易日历
schedule: daily
mode: increment
source: API(TQ)
fetch:
  type: tq
  method: get_trading_dates
  args: {market: SH, years_back: 20}
schema:
  date: DATE
  is_trading: BOOLEAN
  market: VARCHAR
dedup_key: [date]
```

一个通用 `engine.py` 读 YAML → 调对应 fetcher → ensure_table → save。26 个 .py 脚本变成 26 个 .yaml + 几个 fetcher 适配器（TQ / TDX二进制 / SQL派生）。

**收益**：新增一张表 = 加一个 YAML，0 代码；契约天然统一；配置即文档。
**代价**：一次性重写工作量大（~2-3 人天），存量脚本需迁移；特殊逻辑（137 的断点续传、70 的多表产物、101 的样本推断建表）要保留逃生口。

---

## 四、推荐落地路径（分阶段，每阶段可独立交付）

| 阶段 | 内容 | 风险 | 预计工作量 |
|------|------|------|-----------|
| **P0（本周）** | 方案 A 全部：清废弃、修占位@meta、修 91 的 bug、同步文档 | 极低 | 0.5 天 |
| **P1（2 周）** | 方案 B1+B3：建 common/、抽 DB_PATH/TQ init/_stock_code_to_tdx、写 lint_meta 挂 pre-commit | 低（纯抽公共，不改逻辑） | 2 天 |
| **P2（3 周）** | 方案 B2：BaseIngest 基类，逐个脚本迁移（先迁简单的 91/95/33，再迁复杂的） | 中（动 run() 契约，需回归测） | 3-4 天 |
| **P3（按需）** | 方案 B4：列名英文化，分表逐个 RENAME | 中（动表结构） | 1-2 天 |
| **P4（长期）** | 方案 C：声明式重构。**建议 P0-P2 稳定半年后再评估是否值得** | 高 | 2-3 天 |

---

## 五、需要你决策的点

1. **废弃目录 18 个脚本**：直接删 / 移到 archive / 保留参考？三者我推荐「移到 `archive/deprecated/` 并去掉 @meta」。
2. **列名中文化**：是设计选择（你故意要中文列名好查）还是历史遗留？这决定要不要做 P3。
3. **是否引入 BaseIngest 基类**：这是 P2 的核心。如果你希望脚本保持「平铺、一个文件能独立看懂」的风格，可以不抽基类，只抽公共函数（B1）。
4. **DB_PATH 等 49 处硬编码**：是否同意统一到 `common/config.py`？这是所有后续治理的前提。
5. **`run.py` 要不要瘦身**：现在 903 行，cmd_catalog/cmd_health/cmd_join 等其实可以拆到 `cli/` 子模块。

---

## 附：已确认的 Bug 清单（P0 顺带修）

| # | 文件:行 | Bug | 修法 |
|---|--------|-----|------|
| 1 | `1_入库/91_trading_calendar.py:70` | `pandas.DatetimeIndex` 未导入（只有 `pd`） | 改 `pd.DatetimeIndex` |
| 2 | `1_入库/91_trading_calendar.py:23-27` | TQ_PATHS 两个相同路径 | 去重 |
| 3 | `1_入库/33_sector_stocks.py:21` | `CREATE TABLE IF NOT EXISTS 表名` 字面中文 | 删脚本或实现 |
| 4 | `1_入库/34_t_bk5_19_.py` | @meta mode=increment vs MODE='full' | 二选一统一 |
| 5 | `3_策略/check_health.py:13` | `@meta table=-` 占位符 | 删 @meta |
| 6 | `4_工具/gen_skeleton.py:4` | `@meta table=skeleton` 误标 | 删 @meta |
| 7 | `4_工具/ingest_plan.py:2` | `@meta table=kline_ingest_plan` 误标 | 删 @meta |
| 8 | `1_入库/104_stock_financial_data.py:328` | `__main__` 里 `run(force=True)` 硬编码 force | 改 `run()` |
