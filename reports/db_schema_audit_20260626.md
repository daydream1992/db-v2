# Database Schema Audit Report

- Generated: 2026-06-26 22:14
- Database: `K:\DB数据库_v2\db\profit_radar.duckdb`
- Total tables: 35
- Mode: read-only snapshot via DuckDB `information_schema`

---

## 1. Full Schema (English column names preserved; Chinese fields shown as-is in the "field" column)

| # | Table | Rows | Cols | Fields (name : type) |
|---|-------|------|------|----------------------|
| 1 | `capital_info` | 2,176,571 | 5 | `code` VARCHAR, `date` DATE, `zgb` DOUBLE, `ltgb` DOUBLE, `updated_at` TIMESTAMP |
| 2 | `dim_88field_indicator` | 91 | 8 | `field_en`, `field_cn`, `category`, `category_cn`, `unit`, `remark`, `source`, `created_at` |
| 3 | `dim_gp_indicator` | 48 | 8 | `gp_code`, `gp_name`, `value_0_name`, `value_0_unit`, `value_1_name`, `value_1_unit`, `note`, `present` |
| 4 | `dim_industry_code` | 466 | 9 | `code`, `名称`, `层数`, `行业一级名称`, `行业一级代码`, `行业二级名称`, `行业二级代码`, `行业三级名称`, `行业三级代码` |
| 5 | `dim_security_type` | 12,091 | 7 | `code`, `type`, `market`, `prefix`, `is_active`, `created_at`, `updated_at` |
| 6 | `dwd_stock_capital_flow` | 906,797 | 10 | `code`, `trade_date` DATE, `主力净流入`, `主动买入净额`, `封单金额`, `是否涨停`, `攻击波`, `回撤波`, `vwap`, `首次涨停时间` |
| 7 | `market_sc1_42` | 5,644 | 76 | `date` + 75 SC indicator columns (Chinese) |
| 8 | `market_snapshot` | **0** | 42 | `code`, `snapshot_time`, `LastClose`, `Open`, `Max`, `Min`, `Now`, `Volume`, `NowVol`, `Amount`, `Inside`, `Outside`, `TickDiff`, `InOutFlag`, `Jjjz`, `Buyp1..5`, `Buyv1..5`, `Sellp1..5`, `Sellv1..5`, `UpHome`, `DownHome`, `Before5MinNow`, `Average`, `XsFlag`, `Zangsu`, `ZAFPre3` |
| 9 | `pianpao_daily` | 134,026 | 37 | `trade_date`, `stock_code`, `stock_name`, `level`, `severity`, `prev_close`, `open_price`, `close_price`, `high_price`, `low_price`, `volume`, `gap_up_pct`, `open_to_close_pct`, `day_change_pct`, `upper_shadow_ratio`, `zt_price`, `zt_distance`, `touched_zt`, `prev1_change`, `prev3_trend`, `prev3_total_change`, `scenario`, `sectors`, `trap_direction`, `trap_type`, `lifecycle_stage`, `trap_confirmed`, `turnover`, `vol_ratio_5d`, `consecutive_zt`, `break_count`, `seal_ratio`, `ma5`, `ma10`, `ma20`, `ma60`, `dev_ma20` |
| 10 | `pianpao_daily_summary` | 355 | 10 | `trade_date`, `total_count`, `s_count`, `a_count`, `b_count`, `c_count`, `avg_gap_up`, `avg_intraday_drop`, `zt_rejected`, `sector_linked` |
| 11 | `pianpao_intraday` | 355,437 | 19 | `trade_date`, `stock_code`, `total_bars`, `peak_time`, `peak_price`, `peak_idx`, `rise_bars`, `rise_pct`, `rise_speed`, `fall_bars`, `fall_pct`, `fall_speed`, `surge_count`, `crash_count`, `surge_vol_ratio`, `crash_vol_ratio`, `rise_fall_vol_ratio`, `surge_vol_label`, `crash_vol_label` |
| 12 | `pianpao_intraday_events` | 2,675,705 | 11 | `trade_date`, `stock_code`, `seq`, `event_type`, `start_time`, `end_time`, `start_price`, `end_price`, `pct`, `speed_label`, `volume` |
| 13 | `pianpao_intraday_periods` | 1,415,741 | 8 | `trade_date`, `stock_code`, `period_name`, `change_pct`, `max_gain`, `max_loss`, `vol_ratio`, `bar_count` |
| 14 | `pianpao_trap_stats` | 20 | 9 | `stat_date`, `trap_type`, `trap_direction`, `sample_n`, `avg_t1_open_chg`, `avg_t1_max_gain`, `avg_t1_close_chg`, `win_rate`, `median_t1_close_chg` |
| 15 | `sector_stocks` | 91,564 | 2 | `sector_code`, `stock_code` |
| 16 | `sjb_api_plhqL2kz_88zd` | 60,366 | 91 | snapshot of 88 TQ fields + `code`, `stock_type`, `fetch_time` (mixed-case English + CamelCase TQ names) |
| 17 | `stock_block_relation` | 330,232 | 6 | `stock_code`, `板块代码`, `板块名称`, `成份比例`, `fetch_time` |
| 18 | `stock_block_relation_industry_labeled` | 330,232 | 12 | `stock_code` + 3 Chinese block cols + `成份比例`, `fetch_time` + 6 industry level cols (Chinese) |
| 19 | `stock_daily_kline` | 28,931,466 | 11 | `code`, `date`, `open`, `high`, `low`, `close`, `volume`, `amount`, `涨跌幅`, `换手率`, `前权因子` |
| 20 | `stock_daily_turnover` | 1,336,955 | 4 | `code`, `date`, `turnover`, `pct_chg` |
| 21 | `stock_financial_data` | 5,522 | 49 | `code`, `announce_time` BIGINT, `tag_time` BIGINT, `fetch_time`, plus 46 `FN1..FN324` DOUBLE financial fields |
| 22 | `stock_gp1_46_indicators` | 118,722,855 | 6 | `date`, `code`, `gp_code`, `gp_name`, `value_0`, `value_1` |
| 23 | `stock_gp1_46_indicators_labeled` | 118,722,855 | 12 | base 6 + `value_0_name`, `value_0_unit`, `value_1_name`, `value_1_unit`, `present`, `note` |
| 24 | `stock_industry_3level` | 5,534 | 8 | `stock_code` + 6 Chinese industry level cols + `updated_at` |
| 25 | `stock_kline_1m` | 291,635,990 | 8 | `code`, `open`, `high`, `low`, `close`, `volume`, `amount`, `trade_time` |
| 26 | `stock_kline_5m` | 201,794,122 | 8 | same as 1m |
| 27 | `stock_kline_15m` | 67,265,833 | 8 | same as 1m |
| 28 | `stock_kline_30m` | 33,633,720 | 8 | same as 1m |
| 29 | `stock_kline_60m` | 16,817,663 | 8 | same as 1m |
| 30 | `stock_kline_weekly` | 6,135,204 | 9 | `code`, `date`, `open`, `high`, `low`, `close`, `volume`, `amount`, `涨跌幅` |
| 31 | `stock_kline_monthly` | 1,461,585 | 9 | same as weekly |
| 32 | `stock_signals_20001_20011` | 7,091,070 | 5 | `code`, `date`, `value`, `signal_code`, `signal_name` |
| 33 | `t_bk5_19` | 2,171,182 | 18 | `date`, `code`, `bk_name`, `pe_ttm`, `pb_mrq`, `ps_ttm`, `pc_ttm`, `涨跌数`, `总市值`, `流通市值`, `涨停数`, `跌停数`, `涨停数据`, `融资融券`, `陆股通流入`, `开盘成交数`, `股息率`, `自由流通市值` |
| 34 | `t_bk5_19_industry_labeled` | 2,171,182 | 25 | 18 from `t_bk5_19` + 7 industry level cols (Chinese) |
| 35 | `trading_calendar` | 6,415 | 3 | `date`, `is_trading`, `market` |

---

## 2. Data Quality Alerts

### 2.1 Empty tables (red flag)

| Table | Rows | Note |
|-------|------|------|
| `market_snapshot` | 0 | Schema exists, never populated. Schema name suggests real-time intraday L2 snapshot. |

### 2.2 Sparse / partly populated tables

| Table | Rows | Concern |
|-------|------|---------|
| `dwd_stock_capital_flow` | 906,797 | Script `120_dwd_stock_capital_flow.py` `fetch_data()` is a placeholder returning empty DataFrame. Data is sourced from elsewhere (legacy?). 9 of 10 columns are >99% NULL — only `主力净流入` is populated. |
| `sjb_api_plhqL2kz_88zd` | 60,366 | All numeric fields stored as VARCHAR (per TQ raw payload). Type-cast needed at consumer side. |
| `stock_financial_data` | 5,522 | 46 columns named `FN1..FN324` (non-contiguous). No human-readable mapping inside this table — relies on `dim_88field_indicator` for semantics. |

### 2.3 Naming inconsistencies (likely bugs)

#### 2.3.1 Time column naming drift
| Table | Time column | Type |
|-------|-------------|------|
| `dwd_stock_capital_flow` | `trade_date` | DATE |
| `stock_daily_kline` | `date` | DATE |
| `stock_kline_weekly/monthly` | `date` | DATE |
| `stock_kline_1m/5m/15m/30m/60m` | `trade_time` | TIMESTAMP |
| `market_snapshot` | `snapshot_time` | TIMESTAMP |
| `sjb_api_plhqL2kz_88zd` | `HqDate` | VARCHAR |
| `market_sc1_42` | `date` | DATE |

→ Three naming conventions for "the trading timestamp" coexist (`date` / `trade_date` / `trade_time` / `snapshot_time` / `HqDate`). Not a bug, but JOINs need explicit AS.

#### 2.3.2 Code field type drift
- All `*_kline*` tables: `code` is VARCHAR WITHOUT exchange suffix (e.g. `002791`)
- `dim_industry_code` / `dim_security_type`: `code` is VARCHAR WITHOUT suffix
- `dwd_stock_capital_flow` / `sjb_api_plhqL2kz_88zd`: `code` includes `.SZ` / `.SH` suffix
- `t_bk5_19`: `code` is sector code (880xxx.SH)

→ JOIN between kline and capital_flow requires suffix concatenation.

#### 2.3.3 Field name casing drift
- `sjb_api_plhqL2kz_88zd` uses **CamelCase** TQ raw names (`ZAF`, `Zjl`, `HqDate`, `LastStartZT`)
- All other tables use **snake_case** or **English identifier** style (`zgb`, `pe_ttm`, `trade_date`)

→ Cross-table joins involving TQ fields need explicit rename.

#### 2.3.4 Unit ambiguity
- `dwd_stock_capital_flow.主力净流入`: unit unknown (yuan? wan yuan? percent?)
- `t_bk5_19.总市值` / `流通市值` / `自由流通市值`: comment says "亿元" (100M yuan)
- `sjb_api_plhqL2kz_88zd.FzAmo` ("封单金额" raw): TQ returns yuan
- `pianpao_daily.turnover`: same English name as `stock_daily_turnover.turnover` but pipeline may store decimals vs %

→ `dwd_stock_capital_flow.封单金额` and `sjb_api_plhqL2kz_88zd.FzAmo` likely represent the same thing with different units. Verify before any cross-table aggregation.

#### 2.3.5 Inconsistent kline coverage
- `stock_daily_kline` has 11 columns including `涨跌幅` and `换手率`, but `换手率` is ALL NULL (per prior probe on `turnover-source.md`) — `stock_daily_turnover` is the source of truth for turnover.
- `stock_kline_1m/5m/15m/30m/60m`: 8 columns, no `涨跌幅` (computed from prev close consumer-side)
- `stock_kline_weekly/monthly`: 9 columns, includes `涨跌幅`

---

## 3. Field-Level Cross-Reference (suspected duplicates)

| Concept | Table A | Field A | Table B | Field B | Risk |
|---------|---------|---------|---------|---------|------|
| Total share capital | `capital_info` | `zgb` | — | — | SSOT confirmed via memory/capital-info-api.md |
| Free-float shares | `capital_info` | `ltgb` | `sjb_api_plhqL2kz_88zd` | `FreeLtgb` | TQ raw value, VARCHAR |
| Total market cap | `t_bk5_19` | `总市值` (亿) | `sjb_api_plhqL2kz_88zd` | `Zsz` (raw) | Unit mismatch (亿 vs 元) |
| Free-float mcap | `t_bk5_19` | `流通市值` (亿) | `sjb_api_plhqL2kz_88zd` | `Ltsz` (raw) | Unit mismatch |
| 主力净流入 | `dwd_stock_capital_flow` | `主力净流入` | `sjb_api_plhqL2kz_88zd` | `Zjl` | Confirmed same concept per memory/zjl-mainflow-shortcut.md |
| 封单金额 | `dwd_stock_capital_flow` | `封单金额` | `sjb_api_plhqL2kz_88zd` | `FzAmo` | Same concept, different units likely |
| 涨停数 | `t_bk5_19` | `涨停数` | `pianpao_daily` | `touched_zt` (count per day per stock) | Different granularity: sector vs stock |
| 换手率 | `stock_daily_turnover` | `turnover` | `stock_daily_kline` | `换手率` | memory/turnover-source.md confirms kline column is NULL; turnover table is SSOT |
| 行业 | `stock_block_relation_industry_labeled` | 6 行业 cols | `stock_industry_3level` | 6 行业 cols | Same dimension, two source tables — verify consistency |
| 板块 | `stock_block_relation` | `板块代码/名称` | `t_bk5_19` | `code/bk_name` (sector) | Sector vs 板块 may differ; verify join key |

---

## 4. Recommendations

1. **Lock down `dwd_stock_capital_flow` source**: 906k rows not coming from `120_dwd_stock_capital_flow.py` (placeholder). Either kill the table, or document the real ingestion script and align `fetch_data()` with it.
2. **Drop or document `market_snapshot`**: empty table with 42 columns is a maintenance liability.
3. **Standardize time column naming**: pick `trade_date` (DATE) for daily grain and `trade_time` (TIMESTAMP) for intraday grain. Migrate `date` → `trade_date` where it represents a trading day.
4. **Standardize code suffix policy**: pick one — either `002791` (no suffix, join via `dim_security_type`) or `002791.SZ` (with suffix). Currently mixed.
5. **Add a `unit` column or comment** on monetary fields (`dwd_stock_capital_flow.主力净流入`, `t_bk5_19.总市值`, etc.) to prevent cross-table unit confusion.
6. **Resolve duplicate "industry" tables**: `stock_block_relation_industry_labeled` and `stock_industry_3level` carry the same 6 industry levels. Pick one as SSOT.
7. **Run `python run.py sync-dict && python run.py integrity`** after any rename to refresh `docs/data_dict.md` and surface orphans.

---

## 5. Source of Truth Files

- `config/data_dictionary.json` — generated, not hand-edited
- `docs/data_dict.md` — human-readable render
- `config/tables.json` — table-level metadata (status, dependencies, schedule, mode)
- `config/gen_data_dict.py --sync` — generator
- `config/check_integrity.py` — orphan/duplicate detector
