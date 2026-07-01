# DataOps 管理台 · 使用方法

> 项目库 DB数据库_v2 的 DataOps 管理台 UI。
> 技术栈：Next.js 16 (App Router) + React 19 + TypeScript 5 + Tailwind CSS 4 + shadcn/ui
> 当前版本：见 [`package.json`](package.json) `version` 字段（v0.2.0）

---

## 📌 现状须知（先读）

| 项 | 说明 |
|----|------|
| **定位** | 系统化 DataOps 方案的 **UI 原型 / 探索稿 v1**，侧栏明确标注"数据为 mock" |
| **数据来源** | **10 个视图全部接真实数据**（Python sidecar [`scripts/dataops.py`](scripts/dataops.py) + [`scripts/sql_query.py`](scripts/sql_query.py)，read-only）。`cn`/`dir`/`schedule` 等元数据仍从 [`mock-data.ts`](src/lib/dataops/mock-data.ts) 合并（库里没有）；运行历史/趋势图等无数据源的部分保留 mock，详见下方「真实 vs 保留 mock」 |
| **执行 daily** | 点击「执行 daily」触发的是 [log-streamer](mini-services/log-streamer/index.ts) 的 **模拟剧本**（18 张表预设步骤），**不会真的调用根目录 `python run.py`** |
| **DuckDB 连接指示** | 顶栏"DuckDB 已连接"为静态展示，[`src/lib/db.ts`](src/lib/db.ts) 实际只接 Prisma/SQLite 沙箱 |
| **Prisma** | [`prisma/schema.prisma`](prisma/schema.prisma) 仍是脚手架默认 `User/Post`，DataOps 功能**尚未实际使用** |
| **快捷键 ⌘B** | 切换侧边栏标注"待实现"，未生效 |

> 真正的数据治理执行仍走根目录 `python run.py`（`sync-dict` / `integrity` / `all` 等），本 UI 目前用于方案演示与交互原型。

---

## 🚀 启动

所有命令在 [`dataops-ui/`](.) 目录下执行，包管理器用 **bun**。

### 1. 首次准备

```bash
bun install              # 安装依赖
cp .env.example .env.local   # 复制环境配置（见下方「配置」）
```

### 2. 开发模式（日常用）

```bash
bun run dev              # 启动 → http://localhost:3000
bun run dev:log          # 同上，额外把输出 tee 到 dev.log
```

### 3. 生产模式（可选）

```bash
bun run build            # 构建 standalone 产物 → .next/standalone/server.js
bun run start            # 生产启动（NODE_ENV=production）
bun run start:log        # 同上，输出 tee 到 server.log
```

> [`next.config.ts`](next.config.ts) 已设 `output: "standalone"`，build 后产物自包含。

### 4. 实时日志流服务（让「执行 daily」有动效）

这是独立的 WebSocket 服务（端口 **3003**），模拟 daily 全量执行进度与日志推送。**只在需要演示执行动效时启动**：

```bash
cd mini-services/log-streamer
bun install              # 首次
bun run dev              # bun --hot index.ts → ws://localhost:3003
```

前端通过 [`use-log-streamer`](src/hooks/use-log-streamer.ts) 连接它，订阅 `execution:progress` / `log:line` / `execution:complete` 等事件。

---

## ⚙️ 配置（`.env.local`）

模板见 [`.env.example`](.env.example)。所有 `NEXT_PUBLIC_*` 变量会被 [`src/lib/dataops/config.ts`](src/lib/dataops/config.ts) 读入 `APP_CONFIG`。

| 变量 | 默认 | 说明 |
|------|------|------|
| `NEXT_PUBLIC_DB_PATH` | `db/profit_radar.duckdb` | DuckDB 文件路径（仅展示用） |
| `NEXT_PUBLIC_PROJECT_ROOT` | `.` | 项目根目录 |
| `NEXT_PUBLIC_BACKUP_DIR` | `./archive` | 备份目录 |
| `NEXT_PUBLIC_LOG_STREAMER_PORT` | `3003` | log-streamer 端口 |
| `NEXT_PUBLIC_GITHUB_REPO` | `https://github.com/daydream1992/db-v2` | 同步用仓库 |
| `NEXT_PUBLIC_GITHUB_BRANCH` | `master` | 同步分支 |
| `GITHUB_TOKEN` | （空） | **仅在 push 同步时**才需配置（非 NEXT_PUBLIC，不暴露前端） |
| `DATABASE_URL` | `file:./dev.db` | Prisma/SQLite 沙箱库 |
| `DUCKDB_PATH` | `K:\DB数据库_v2\db\profit_radar.duckdb`（默认上级 `../db/profit_radar.duckdb`） | SQL Playground 真实库路径（服务端，非 NEXT_PUBLIC） |
| `DATAOPS_PYTHON` | `python` | SQL sidecar 用的 python 命令 |

---

## 🧭 视图导览（10 个）

导航见 [`src/app/page.tsx`](src/app/page.tsx) 的 `NAV` / `VIEW_TITLES`。

| 视图 | 功能 | 备注 |
|------|------|------|
| **Dashboard** | 全局健康度、今日执行、告警总览、KPI 钻取 | 首页 |
| **脚本目录** | 所有数据表与入库脚本的注册中心 | 顶栏可触发单表执行（mock） |
| **健康度** | 红绿灯矩阵、新鲜度、一致性 | |
| **编排** | DAG 依赖、调度计划、执行历史、Gantt 时序 | 「执行 daily」进度在此 |
| **血缘** | 表 ↔ 脚本 ↔ 上游关系图 | |
| **规范校验** | 12 条可机器校验的编码规则（Lint） | 可导出 Python linter |
| **日志** | 按表 / 级别 / 时间筛选 | |
| **数据字典** | 字段级元数据 SSOT | 可导出 |
| **SQL Playground** | 在线查询、Ctrl+Enter 执行、EXPLAIN 可视化 | 多 Tab |
| **设置** | DB 连接、调度、数据源、集成、多环境 Profile | ⌘S 保存 |

### 真实 vs 保留 mock（逐视图）

后端经 Python sidecar 只读连 DuckDB / 只读扫脚本与日志（[`scripts/dataops.py`](scripts/dataops.py)）。库里没有的元数据（cn/目录/调度）从 mock 合并；无数据源的历史类内容保留 mock：

| 视图 | ✅ 已接真 | ⬜ 保留 mock（无数据源） |
|------|----------|------------------------|
| Dashboard | 表总数、总行数、新鲜/滞后计数（聚合自 catalog） | 行数趋势/入库趋势/告警流等历史图 |
| 脚本目录 | 真实行数、列数、maxDate（新鲜度） | cn/目录/类型等元数据 |
| 健康度 | max(date) → 真实红黄绿新鲜度、真实行数 | 7 日趋势矩阵、批量补数动画 |
| 编排 | 真实 @meta 调度/分层 DAG、最近数据日期 | 运行历史/Gantt/触发动画（库无运行记录） |
| 血缘 | 源码静态扫描的表↔脚本图（writes/reads） | 失败时回退 mock 图谱 |
| 规范校验 | 真实扫脚本 AST 的违规（R001/R002/R005/R009/R010 等） | 12 条规则目录文案（仅 5 条可机器校验） |
| 日志 | 真实读 `logs/` 最近 500 行（解析级别/时间） | 触发 daily 的 WebSocket 实时流 |
| 数据字典 | 真实列名/类型/nullable（information_schema） | 字段中文描述 |
| SQL Playground | 真实查询 + EXPLAIN（read-only，白名单+LIMIT+超时） | — |
| 设置 | 真实连接测试（版本/大小/延迟）、库版本/大小 | 调度/YAML/Profile 等配置项 |

---

## ⌨️ 键盘快捷键

完整列表见 [`src/components/dataops/keyboard-help.tsx`](src/components/dataops/keyboard-help.tsx)，按 `?` 可在界面内呼出帮助面板。

| 快捷键 | 作用 | 分类 |
|--------|------|------|
| `⌘/Ctrl + K` | 打开命令面板（输入表名可快速跳转） | 全局 |
| `?` | 显示快捷键帮助 | 全局 |
| `Esc` | 关闭对话框/抽屉 | 全局 |
| `⌘/Ctrl + B` | 切换侧边栏 | **待实现** |
| `⌘/Ctrl + S` | 保存当前页配置（设置页） | 设置 |
| `⌘/Ctrl + Enter` | 执行 SQL | SQL Playground |
| `⌘/Ctrl + T` / `⌘/Ctrl + W` | 新建 / 关闭查询 Tab | SQL Playground |
| `g d` / `g c` / `g h` / `g l` / `g s` | 跳转 Dashboard / 目录 / 健康度 / 血缘 / SQL | 导航 |

---

## 🔌 后端 API 路由

源码在 [`src/app/api/`](src/app/api/)。

| 路由 | 方法 | 作用 |
|------|------|------|
| `/api` | GET | 健康/信息探针 |
| `/api/sql` | POST | **真实查询 DuckDB**（只读）：白名单 + LIMIT 注入 + 30s 超时，body `{sql, explain?, limit?}` → `{columns,rows,rowCount,truncated,elapsedMs}` 或 `{explainText}` |
| `/api/dataops` | GET `?op=` / POST `{op}` | **元数据后端**（Python sidecar 只读）：`dbinfo`/`catalog`/`health`/`dictionary`/`lint`/`lineage`/`logs`/`orchestration` |
| `/api/config` | GET / PUT / POST | 读 / 更新 / 重置配置 |
| `/api/scheduler` | GET / POST / DELETE | 调度计划增删查 |
| `/api/github-sync` | GET / POST | 拉取 / 触发 GitHub 元数据同步 |
| `/api/github-sync/push` | POST | 推送元数据到远端（需 `GITHUB_TOKEN`） |
| `/api/lint/export` | GET | 导出 Python linter 脚本 |
| `/api/dictionary/export` | GET | 导出数据字典 |

> 同步逻辑见 [`src/hooks/use-github-sync.ts`](src/hooks/use-github-sync.ts)；实时告警见 [`src/hooks/use-realtime-alerts.ts`](src/hooks/use-realtime-alerts.ts)。

---

## 🛠️ 常用命令速查

```bash
# 开发
bun run dev                 # UI :3000
cd mini-services/log-streamer && bun run dev   # 日志流 :3003

# 质量与构建
bun run lint                # ESLint
bun run build               # 生产构建（standalone）
bun run start               # 生产启动

# Prisma 沙箱库（脚手架，当前 DataOps 未实际使用）
bun run db:generate         # 生成 client
bun run db:push             # 推 schema 到 SQLite
bun run db:migrate          # 建迁移
bun run db:reset            # 重置
```

---

## 🗂️ 关键目录

```
dataops-ui/
├── src/
│   ├── app/
│   │   ├── page.tsx              # 主壳：顶栏 + 侧栏 + 视图路由
│   │   ├── layout.tsx / globals.css
│   │   └── api/                  # 后端路由（见上表）
│   ├── components/
│   │   ├── dataops/              # 10 个视图 + 命令面板/通知中心/调度面板等
│   │   └── ui/                   # shadcn/ui 组件库
│   ├── lib/
│   │   ├── dataops/config.ts     # APP_CONFIG（环境变量聚合）
│   │   ├── dataops/mock-data.ts  # mock 数据源
│   │   ├── dataops/real-data.ts  # 真实数据接入（部分）
│   │   └── db.ts                 # Prisma client
│   └── hooks/                    # log-streamer / 告警 / github-sync 等
├── mini-services/log-streamer/   # 独立 WS 服务 :3003（执行模拟）
├── scripts/sql_query.py          # SQL Playground 的只读查询 sidecar（duckdb read_only）
├── scripts/dataops.py            # 元数据后端 sidecar（op 分发：dbinfo/catalog/health/dictionary/lint/lineage/logs/orchestration）
├── prisma/schema.prisma          # SQLite 沙箱（脚手架）
├── .env.example                  # 环境变量模板
└── next.config.ts                # output: standalone
```

---

## ❓ 常见问题

**Q：页面打开是空白 / Chrome 限制本地文件？**
A：本 UI 走 `bun run dev`（http://localhost:3000），不走 `start-dataops.bat`（那是给根目录 `0_weihuxiezuo/` 下另一份**静态导出版**用的，需先 `bun run build:static`）。

**Q：点了「执行 daily」没反应？**
A：先确认 log-streamer 已在 3003 端口运行；它是模拟剧本，非真实入库。

**Q：要真正跑数据入库怎么办？**
A：回到项目根目录 `K:\DB数据库_v2\`，用 `python run.py all`（详见根 [`CLAUDE.md`](../CLAUDE.md)）。本 UI 不执行真实入库。

**Q：页面打不开 / 一直转圈 / dev server 没反应？**
A：极可能是 **Turbopack 把父目录 `K:\DB数据库_v2` 误判为 workspace root**（因父目录有 `bun.lock`），首次请求时去爬整个父项目（DuckDB 大文件 + 海量脚本），CPU 占满、内存涨到 GB 级却不响应。**已修复**：[`next.config.ts`](next.config.ts) 设了 `turbopack.root = path.resolve(__dirname)` 锁定 dataops-ui。若改过该配置后出现 `500` / `Could not find the module ... in the React Client Manifest` / `Cannot find module '@swc/helpers-xxxxx'`，是 `.next` 缓存与新 root 不一致——**停服务后 `rm -rf .next` 再重启**即可。
