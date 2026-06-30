---
name: dbv2-skeleton
description: K:\DB数据库_v2 项目骨架 - 核心文件 + 70 个脚本清单表，接续前先看
metadata: 
  node_type: memory
  type: project
  originSessionId: 4af06b71-8c36-4d56-ab9c-53d84d25ee70
---

# DB数据库_v2 项目骨架

> ⚠️ **使用规则**：接续 DB数据库_v2 工作时**先看本文件**。骨架够用就不要 Read 全文。
> 项目根：`K:\DB数据库_v2\`，项目规范见 `K:\DB数据库_v2\CLAUDE.md`

## 🏗️ 架构速览

| 目录 | 文件数 | 用途 |
|------|-------|------|
| `1_入库/` | 31 个 .py | 采集入库（外部数据源 → DuckDB） |
| `2_计算/` | 8 个 .py | SQL 派生（已有表 → 新表） |
| `3_策略/` | 0 个 | 预留 |
| `4_工具/` | 2 个 | tdx_reader 等工具 |
| `config/` | 2 个 + json/md | 模板和表注册 |
| `legacy/` | 旧代码 | **禁止 import** |

---

## 📜 核心文件骨架（4 个 + 3 个 config）

### run.py (486 行)
- **路径**：`K:/DB数据库_v2/run.py`
- **作用**：CLI 入口，管理 70 个表的入库/计算/导出/备份
- **关键函数**：
  - `cmd_all(tables, tier)` [line 125] — 按周/月/日运行指定层
  - `cmd_run_tables(tables, keywords, force)` [line 159] — 按关键词执行表
  - `cmd_scan(tables)` [line 188] — 健康扫描
  - `cmd_check(tables, name)` [line 242] — 深度检查
  - `cmd_get(tables, name, code, days)` [line 281] — 导出数据
  - `cmd_add(tables, name)` [line 317] — 添加表
  - `cmd_remove(tables, name)` [line 341] — 删除表
  - `cmd_fix(tables, name)` [line 362] — 强制重跑
  - `cmd_backup()` [line 380] — 备份 DB
- **依赖**：duckdb, pandas, loguru, rich, argparse
- **核心常量**：`DB_PATH=r'K:\DB数据库_v2\db\profit_radar.duckdb'` | `DIR_ORDER=['1_入库','2_计算']`

**CLI 子命令**：
| 命令 | 作用 |
|------|------|
| `all [--weekly] [--full]` | 入库运行 |
| `scan` | 健康扫描 |
| `check <table>` | 深度检查 |
| `get <table> [--code X --days N]` | 导出 |
| `add <table>` | 添加 |
| `remove <table>` | 删除 |
| `fix <table> [--date X]` | 强制重跑 |
| `backup` | 备份 |
| 直接关键词如 `1`/`2`/`kline` | 快速执行 |

### config/template_ingestion.py (57 行)
- **作用**：增量/全量入库脚本模板
- **必填常量**：`DB_PATH`, `TABLE`, `MODE='increment'|'full'`, `SCHEDULE='daily'|'weekly'|'monthly'|'once'`
- **必填函数**：
  ```python
  def fetch_data():       return pd.DataFrame()
  def ensure_table(con):  con.execute(CREATE TABLE...)
  def save_data(con, df): con.execute(DELETE+INSERT)
  def run(force=False):   主入口 → bool
  ```

### config/template_compute.py (45 行)
- **作用**：SQL 派生脚本模板
- **与入库模板差异**：`fetch_data(con)` 多一个 `con` 参数；`MODE` 默认为 `full`

### 4_工具/tdx_reader.py (~1000 行)
- **路径**：`K:/DB数据库_v2/4_工具/tdx_reader.py`
- **作用**：读取通达信二进制文件（K线/财务/板块等）
- **K线读取**：
  - `read_daily(market, batch_size)` — 日K，流式
  - `read_daily_parallel(market)` — 日K，并行全量
  - `read_5min_parallel(min_date, max_date)` — 5分钟K，并行+时间过滤
  - `read_1min_parallel(min_date, max_date)` — 1分钟K，并行+时间过滤
- **基础数据读取**：
  - `read_base_dbf()` — 股票基础财务数据（base.dbf，40字段）
  - `read_csi_block()` — CSI板块成分股
  - `read_blocknew()` — 自定义板块 (*.blk + blocknew.cfg)
  - `read_broker()` — 营业部数据
  - `read_financial()` — 财务数据 (gpcw*.dat)
  - `read_sc()` — 市场宏观指标SC1-42 (gpsh999999.dat)
  - `read_gp()` — 个股指标GP1-46 (gpsz*.dat,gpsh*.dat,gpbj*.dat)
- **独立解析函数**：
  - `_parse_single_day_file(path)` — 解析单个.day文件
  - `_parse_single_lc_file(path, min_date, max_date)` — 解析单个.lc1/.lc5文件
- **核心常量**：`DEFAULT_VIPDOC=r'K:\txdlianghua\vipdoc'`

### config/tables_format.md
字段规范：`cn / source / period / schedule / mode / dir / sort`
schedule 映射：每日→daily | 每周→weekly | 每月→monthly | 一次性→once
**不加** `last_run` 和 `priority`

### config/tables.json
70 个表注册。首条目结构示例：
```json
"stock_daily_kline": {cn, source, period, schedule:"daily", mode:"increment", dir:"1_入库", sort:10}
```

### requirements.txt
`duckdb, pandas, loguru, typer, rich, numpy, mootdx`

---

## 📊 1_入库 脚本清单（32 个）

| 编号 | 脚本名 | TABLE | 数据源 | MODE | 行数 |
|------|--------|-------|--------|------|------|
| 10 | stock_daily_kline | stock_daily_kline | 二进制 | increment | 105 |
| 33 | sector_stocks | sector_stocks | 二进制 | full | 61 |
| 34 | sector_trading_data | sector_trading_data | API(TQ) | increment | 176 |
| 35 | stock_industry_3level | stock_industry_3level | API(TQ) | full | 200 |
| 80 | stock_kline_1m | stock_kline_1m | 二进制 | increment | 108 |
| 81 | stock_kline_5m | stock_kline_5m | 二进制 | increment | 108 |
| 91 | trading_calendar | trading_calendar | API(TQ) | increment | 133 |
| 92 | market_sc1_42_trading | market_sc1_42_trading | 二进制 | increment | 85 |
| 93 | stock_gp1_46_indicators | stock_gp1_46_indicators | 二进制 | increment | 104 |
| 94 | dim_gp_indicator | dim_gp_indicator | 文档 | full | 135 |
| 待定 | sector_bk05_19_indicators | sector_bk05_19_indicators | 二进制 | increment | 86 |
| 120 | dwd_stock_capital_flow | dwd_stock_capital_flow | API(TDX) | increment | 78 |
| 131 | sector_constituent | sector_constituent | API(TQ:get_stock_list_in_sector) | full | 117 |
| 132 | user_sector | user_sector | API(TQ:get_user_sector) | full | 94 |
| 133 | stock_basic_info | stock_basic_info | API(TQ:get_stock_info) | full | 117 |
| 134 | match_stkinfo | match_stkinfo | API(TQ:get_match_stkinfo) | full | 95 |
| 135 | market_snapshot | market_snapshot | API(TQ:get_market_snapshot) | increment | 128 |
| 136 | price_volume_batch | price_volume_batch | API(TQ:price-vol batch) | increment | 120 |
| 137 | capital_info | capital_info | API(TQ:get_gb_info_by_date) | increment | 108 |
| 138 | ipo_info | ipo_info | API(TQ:get_ipo_info) | full | 99 |
| 139 | stock_more_info | stock_more_info | API(TQ:get_more_info) | full | 116 |
| 140 | stock_relation | stock_relation | API(TQ:get_relation) | full | 114 |
| 141 | financial_data | financial_data | API(TQ:get_financial_data) | increment | 105 |
| 142 | scjy_value | scjy_value | API(TQ:get_scjy_value_by_date) | increment | 91 |
| 143 | gpjy_value | gpjy_value | API(TQ:get_gpjy_value_by_date) | increment | 106 |
| 144 | bkjy_value | bkjy_value | API(TQ:get_bkjy_value_by_date) | increment | 112 |
| 145 | kzz_info | kzz_info | API(TQ:get_kzz_info) | full | 106 |
| 146 | etf_trackzs | etf_trackzs | API(TQ:get_trackzs_etf_info) | full | 104 |
| 147 | formula_list | formula_list | API(TQ:formula) | full | 103 |
| 148 | gp_one_data | gp_one_data | API(TQ:get_gp_one_data) | increment | 98 |
| 160 | data_sync_log | data_sync_log | 自动记录 | full | 67 |
| 101 | 101_jb_api_plhqL2kz_88zd | sjb_api_plhqL2kz_88zd | API(TQ:get_more_info) | increment | ~310 |
| 102 | dim_88field_indicator | dim_88field_indicator | 文档 | full | ~280 |
| 262 | stock_block_relation | stock_block_relation | API(TQ:get_relation) | increment | ~150 |

> ⚠️ **sort=094 撞号 → 待定**: 按决定不分配新号；已从 `94_sector_bk05_19_indicators.py` 的 @meta 移除 sort（编号待定，run.py 无 sort 时默认 999，不再撞 `dim_gp_indicator` 的 094）。注：run.py 用 `int(sort)` 解析，@meta 不能直接写"待定"。

> 💡 **GP指标含义映射**: `dim_gp_indicator`(sort=94) 是 GP1-46 的官方字段维度表，源自通达信说明书 `get_gpjy_value`，含 value_0/value_1 的名称+单位+备注。视图 `stock_gp1_46_indicators_labeled` = 主表 `stock_gp1_46_indicators` LEFT JOIN 该维度表，**查询/导出即带含义**。GP27(人气排名)曾因 GP_MAPPING 字节映射 bug(0x2b↔0x1b 与GP43冲突)丢失 0x1b 的 982万条数据, 已修正, 待全量重跑恢复; 另 GP47(0x2f)/GP48(0x30) 二进制实测存在但官方未公开语义, 已占位纳入。

> 💡 **88字段含义映射**: `dim_88field_indicator`(sort=102) 是 get_more_info 88字段的维度表，含英文字段名/中文字段名/分类/单位/备注。视图 `sjb_api_plhqL2kz_88zd_labeled` = 主表 LEFT JOIN 该维度表。**去重键为 HqDate+code**（按行情日期去重保留最新）。脚本文件名含前缀 `101_jb_`，实际表名去掉前缀。

## 📊 2_计算 脚本清单（9 个）

| 编号 | 脚本名 | TABLE | 数据源 | MODE | 行数 |
|------|--------|-------|--------|------|------|
| 001 | dim_security_type_sync | dim_security_type | SQL:stock_daily_kline | increment | 106 |
| 36 | dim_industry_code | dim_industry_code | SQL:stock_industry_3level | full | 106 |
| 17 | stock_kline_weekly | stock_kline_weekly | SQL:stock_daily_kline | full | 78 |
| 18 | stock_kline_monthly | stock_kline_monthly | SQL:stock_daily_kline | full | 78 |
| 70 | pianpao_daily | pianpao_daily等5表 | SQL:stock_daily_kline,stock_kline_1m | increment | 124 |
| 71 | pianpao_batch | pianpao_daily等5表 | SQL:stock_daily_kline,stock_kline_1m | increment | 172 |
| 82 | stock_kline_15m | stock_kline_15m | SQL:stock_kline_5m | increment | 119 |
| 83 | stock_kline_30m | stock_kline_30m | SQL:stock_kline_5m | increment | 119 |
| 84 | stock_kline_60m | stock_kline_60m | SQL:stock_kline_5m | increment | 119 |

> 💡 **骗炮5表=1脚本**: `pianpao_daily / pianpao_daily_summary / pianpao_intraday / pianpao_intraday_events / pianpao_intraday_periods` 全部由 `70_pianpao_daily`(单日最新) 或 `71_pianpao_batch`(按 `--start/--end` 范围) 经 `4_工具/pianpao_engine.py` 的 `save_to_db()` 一次写入，**不是5个独立脚本**；intraday 三表依赖 `stock_kline_1m`(仅S/A级拉1分钟)。详见 memory `pianpao-tables-script-mapping.md`。

---

> 🔄 **更新时机**：
> - 增删脚本/表 → 在上面表格里加一行/删一行（不用全表扫）
> - 模板文件变化 → 更新对应骨架
> - run.py 加新命令 → 更新 CLI 子命令表

> 相关：[[token-saving-rules]] [[tqcenter-file-skeletons]] [[default-yes-rules]]
