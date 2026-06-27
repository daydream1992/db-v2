# 数据健康度审核报告

> **生成时间**: 2026-06-09 08:37:12
> **数据库**: profit_radar.duckdb

---

## 一、汇总

| 健康度 | 数量 | 说明 |
|--------|------|------|
| ✅ 健康 (>=80) | 34 | 数据质量良好 |
| ⚠️ 警告 (50-79) | 6 | 存在轻微问题 |
| ❌ 危险 (<50) | 6 | 存在严重问题 |

---

## 二、问题汇总

### 2.1 严重问题 (Issues) - 41条

| 表 | 列 | 问题描述 |
|----|----|----------|
| data_sync_log | - | start_date: 94.9% 空值 |
| data_sync_log | - | end_date: 94.9% 空值 |
| data_sync_log | - | error_message: 100.0% 空值 |
| dwd_stock_intraday_feature | - | first_limit_up_time: 100.0% 空值 |
| dwd_stock_intraday_feature | - | limit_up_count: 98.9% 空值 |
| dwd_stock_intraday_feature | - | open_limit_count: 98.9% 空值 |
| dws_sector_emotion | - | flow_mv: 100.0% 空值 |
| etf_daily_kline | - | change_pct: 32.8% 负值 |
| etf_derived_indicator | - | tracking_error_20d: 89.5% 空值 |
| etf_derived_indicator | - | tracking_error_60d: 89.5% 空值 |
| etf_derived_indicator | - | excess_return_1d: 89.5% 空值 |
| etf_derived_indicator | - | excess_return_5d: 89.5% 空值 |
| etf_derived_indicator | - | excess_return_20d: 89.5% 空值 |
| etf_derived_indicator | - | excess_return_1d: 45.9% 负值 |
| etf_derived_indicator | - | excess_return_5d: 39.0% 负值 |
| etf_derived_indicator | - | excess_return_20d: 31.5% 负值 |
| etf_product | - | management_fee: 100.0% 空值 |
| etf_product | - | custody_fee: 100.0% 空值 |
| etf_product | - | delist_date: 100.0% 空值 |
| lhb_broker_detail | - | net_amount: 49.2% 负值 |
| lhb_daily_summary | - | change_pct: 35.9% 负值 |
| lhb_daily_summary | - | net_buy: 48.8% 负值 |
| lhb_daily_summary | - | net_buy_ratio: 48.8% 负值 |
| lhb_daily_summary | - | after_1d: 52.0% 负值 |
| lhb_daily_summary | - | after_2d: 56.4% 负值 |
| lhb_daily_summary | - | after_5d: 60.0% 负值 |
| lhb_daily_summary | - | after_10d: 62.1% 负值 |
| lhb_daily_summary_sina | - | change_pct: 21.4% 负值 |
| lhb_institution_increase | - | net_amount: 46.6% 负值 |
| lhb_stock_stat | - | net_amount: 40.7% 负值 |
| lhb_yyb_activity | - | net_total: 51.8% 负值 |
| market_trading_data | - | value_0: 14.1% 负值 |
| stock_daily_kline | - | change_pct: 100.0% 空值 |
| stock_daily_kline | - | turnover: 100.0% 空值 |
| stock_daily_kline | - | forward_factor: 100.0% 空值 |
| stock_dividend_data | - | record_date: 100.0% 空值 |
| stock_extended_info | - | pe_ttm: 26.9% 负值 |
| stock_extended_info | - | zaf: 25.3% 负值 |
| stock_kline_monthly | - | change_pct: 33.3% 负值 |
| stock_kline_weekly | - | change_pct: 16.1% 负值 |
| stock_technical_indicators | - | value: 11.1% 负值 |

### 2.2 警告信息 (Warnings) - 26条

| 表 | 列 | 问题描述 |
|----|----|----------|
| dim_sector_tree | - | parent_sector_code: 52.9% 空值 |
| dwd_stock_capital_flow | - | attack_wave: 65.4% 空值 |
| dwd_stock_capital_flow | - | pullback_wave: 65.4% 空值 |
| dwd_stock_intraday_feature | - | limit_up_count: 96.0% 零值 |
| dwd_stock_intraday_feature | - | open_limit_count: 99.1% 零值 |
| dws_sector_emotion | - | up_ratio: 100.0% 零值 |
| dws_sector_emotion | - | sector_turnover: 100.0% 零值 |
| etf_derived_indicator | - | bid_ask_spread: 100.0% 零值 |
| fact_finance_report | - | eps_adjusted: 98.4% 零值 |
| fact_finance_report | - | net_profit_parent2: 99.0% 零值 |
| fact_finance_report | - | total_revenue_wan: 98.7% 零值 |
| financial_data | - | 主键重复: 1562条 |
| lhb_broker_detail | - | 主键重复: 1694条 |
| lhb_daily | - | buy_connect: 56.2% 空值 |
| lhb_daily | - | sell_connect: 56.2% 空值 |
| lhb_daily | - | list_days: 100.0% 零值 |
| sector_daily_data | - | change_pct: 100.0% 零值 |
| sector_daily_data | - | turnover: 100.0% 零值 |
| sector_daily_data | - | total_stocks: 100.0% 零值 |
| stock_dividend_data | - | right_issue_price: 95.9% 零值 |
| stock_dividend_data | - | right_issue_ratio: 95.9% 零值 |
| stock_extended_info | - | beta_value: 100.0% 零值 |
| stock_kline_1m | - | '>' not supported between instances of 'datetime.datetime' and 'datetime.date' |
| stock_kline_1m | - | 主键重复: 101条 |
| stock_kline_5m | - | '>' not supported between instances of 'datetime.datetime' and 'datetime.date' |
| stock_technical_indicators | - | 主键重复: 2520条 |

---

## 三、详细分析

### ❌ dwd_stock_intraday_feature

- **中文名**: dwd_stock_intraday_feature
- **行数**: 471,676
- **列数**: 9
- **健康度评分**: 0

-**❌ 严重问题**:
  - first_limit_up_time: 100.0% 空值
  - limit_up_count: 98.9% 空值
  - open_limit_count: 98.9% 空值
- **⚠️ 警告**:
  - limit_up_count: 96.0% 零值
  - open_limit_count: 99.1% 零值

### ❌ etf_derived_indicator

- **中文名**: etf_derived_indicator
- **行数**: 131,395
- **列数**: 11
- **健康度评分**: 0

-**❌ 严重问题**:
  - tracking_error_20d: 89.5% 空值
  - tracking_error_60d: 89.5% 空值
  - excess_return_1d: 89.5% 空值
  - excess_return_5d: 89.5% 空值
  - excess_return_20d: 89.5% 空值
  - excess_return_1d: 45.9% 负值
  - excess_return_5d: 39.0% 负值
  - excess_return_20d: 31.5% 负值
- **⚠️ 警告**:
  - bid_ask_spread: 100.0% 零值

### ❌ lhb_daily_summary

- **中文名**: lhb_daily_summary
- **行数**: 16,764
- **列数**: 21
- **健康度评分**: 0

-**❌ 严重问题**:
  - change_pct: 35.9% 负值
  - net_buy: 48.8% 负值
  - net_buy_ratio: 48.8% 负值
  - after_1d: 52.0% 负值
  - after_2d: 56.4% 负值
  - after_5d: 60.0% 负值
  - after_10d: 62.1% 负值

### ❌ data_sync_log

- **中文名**: data_sync_log
- **行数**: 18,995
- **列数**: 8
- **健康度评分**: 10

-**❌ 严重问题**:
  - start_date: 94.9% 空值
  - end_date: 94.9% 空值
  - error_message: 100.0% 空值

### ❌ etf_product

- **中文名**: etf_product
- **行数**: 2,017
- **列数**: 15
- **健康度评分**: 10

-**❌ 严重问题**:
  - management_fee: 100.0% 空值
  - custody_fee: 100.0% 空值
  - delist_date: 100.0% 空值

### ❌ stock_daily_kline

- **中文名**: 股票日K线
- **行数**: 28,810,370
- **列数**: 11
- **健康度评分**: 10

- **日期范围**: 1990-12-19 ~ 2026-06-08
- **代码前缀**: 00(7,924,324), 60(7,279,037), 88(3,590,096), 30(2,864,535), 39(1,730,327)
-**❌ 严重问题**:
  - change_pct: 100.0% 空值
  - turnover: 100.0% 空值
  - forward_factor: 100.0% 空值

### ⚠️ lhb_daily

- **中文名**: 龙虎榜日常
- **行数**: 43,943
- **列数**: 14
- **健康度评分**: 55

- **日期范围**: 2023-07-17 ~ 2026-06-01
- **代码前缀**: 60(15,428), 00(14,660), 30(7,705), 92(3,871), 68(2,277)
- **⚠️ 警告**:
  - buy_connect: 56.2% 空值
  - sell_connect: 56.2% 空值
  - list_days: 100.0% 零值

### ⚠️ dws_sector_emotion

- **中文名**: dws_sector_emotion
- **行数**: 259,604
- **列数**: 11
- **健康度评分**: 60

-**❌ 严重问题**:
  - flow_mv: 100.0% 空值
- **⚠️ 警告**:
  - up_ratio: 100.0% 零值
  - sector_turnover: 100.0% 零值

### ⚠️ stock_dividend_data

- **中文名**: stock_dividend_data
- **行数**: 60,901
- **列数**: 7
- **健康度评分**: 60

-**❌ 严重问题**:
  - record_date: 100.0% 空值
- **⚠️ 警告**:
  - right_issue_price: 95.9% 零值
  - right_issue_ratio: 95.9% 零值

### ⚠️ stock_extended_info

- **中文名**: stock_extended_info
- **行数**: 565,521
- **列数**: 14
- **健康度评分**: 60

-**❌ 严重问题**:
  - pe_ttm: 26.9% 负值
  - zaf: 25.3% 负值
- **⚠️ 警告**:
  - beta_value: 100.0% 零值

### ⚠️ lhb_broker_detail

- **中文名**: lhb_broker_detail
- **行数**: 24,224
- **列数**: 11
- **健康度评分**: 75

-**❌ 严重问题**:
  - net_amount: 49.2% 负值
- **⚠️ 警告**:
  - 主键重复: 1694条

### ⚠️ stock_technical_indicators

- **中文名**: stock_technical_indicators
- **行数**: 1,004,986
- **列数**: 5
- **健康度评分**: 75

-**❌ 严重问题**:
  - value: 11.1% 负值
- **⚠️ 警告**:
  - 主键重复: 2520条

### ✅ dwd_stock_capital_flow

- **中文名**: 资金流向
- **行数**: 906,797
- **列数**: 10
- **健康度评分**: 80

- **日期范围**: 2025-05-26 ~ 2026-05-28
- **代码前缀**: 60(255,820), 30(229,088), 00(210,710), 68(142,789), 92(68,390)
- **⚠️ 警告**:
  - attack_wave: 65.4% 空值
  - pullback_wave: 65.4% 空值

### ✅ lhb_daily_summary_sina

- **中文名**: lhb_daily_summary_sina
- **行数**: 6,829
- **列数**: 8
- **健康度评分**: 80

-**❌ 严重问题**:
  - change_pct: 21.4% 负值

### ✅ etf_daily_kline

- **中文名**: ETF日K线
- **行数**: 1,616,864
- **列数**: 9
- **健康度评分**: 85

- **日期范围**: 2020-01-02 ~ 2026-06-02
- **代码前缀**: 51(521,379), 15(479,506), 16(399,076), 56(128,156), 58(57,168)
-**❌ 严重问题**:
  - change_pct: 32.8% 负值

### ✅ fact_finance_report

- **中文名**: fact_finance_report
- **行数**: 298,614
- **列数**: 19
- **健康度评分**: 85

- **⚠️ 警告**:
  - eps_adjusted: 98.4% 零值
  - net_profit_parent2: 99.0% 零值
  - total_revenue_wan: 98.7% 零值

### ✅ lhb_institution_increase

- **中文名**: lhb_institution_increase
- **行数**: 174
- **列数**: 8
- **健康度评分**: 85

-**❌ 严重问题**:
  - net_amount: 46.6% 负值

### ✅ lhb_stock_stat

- **中文名**: lhb_stock_stat
- **行数**: 268
- **列数**: 9
- **健康度评分**: 85

-**❌ 严重问题**:
  - net_amount: 40.7% 负值

### ✅ lhb_yyb_activity

- **中文名**: lhb_yyb_activity
- **行数**: 1,028
- **列数**: 10
- **健康度评分**: 85

-**❌ 严重问题**:
  - net_total: 51.8% 负值

### ✅ market_trading_data

- **中文名**: 市场交易数据
- **行数**: 53,678
- **列数**: 5
- **健康度评分**: 85

- **日期范围**: 2016-01-26 ~ 2026-05-29
-**❌ 严重问题**:
  - value_0: 14.1% 负值

### ✅ sector_daily_data

- **中文名**: sector_daily_data
- **行数**: 259,604
- **列数**: 16
- **健康度评分**: 85

- **⚠️ 警告**:
  - change_pct: 100.0% 零值
  - turnover: 100.0% 零值
  - total_stocks: 100.0% 零值

### ✅ stock_kline_monthly

- **中文名**: stock_kline_monthly
- **行数**: 1,467,263
- **列数**: 9
- **健康度评分**: 85

-**❌ 严重问题**:
  - change_pct: 33.3% 负值

### ✅ stock_kline_weekly

- **中文名**: stock_kline_weekly
- **行数**: 6,156,416
- **列数**: 9
- **健康度评分**: 85

-**❌ 严重问题**:
  - change_pct: 16.1% 负值

### ✅ dim_sector_tree

- **中文名**: dim_sector_tree
- **行数**: 925
- **列数**: 5
- **健康度评分**: 90

- **⚠️ 警告**:
  - parent_sector_code: 52.9% 空值

### ✅ financial_data

- **中文名**: financial_data
- **行数**: 826,760
- **列数**: 5
- **健康度评分**: 90

- **⚠️ 警告**:
  - 主键重复: 1562条

### ✅ stock_kline_1m

- **中文名**: 股票1分钟K线
- **行数**: 202,332,261
- **列数**: 8
- **健康度评分**: 90

- **代码前缀**: 60(37,524,720), 00(34,354,539), 30(30,732,960), 88(24,610,599), 15(13,879,032)
- **⚠️ 警告**:
  - '>' not supported between instances of 'datetime.datetime' and 'datetime.date'
  - 主键重复: 101条

### ✅ lhb_institution_detail

- **中文名**: lhb_institution_detail
- **行数**: 264
- **列数**: 6
- **健康度评分**: 95


### ✅ dim_fn_meta

- **中文名**: dim_fn_meta
- **行数**: 584
- **列数**: 5
- **健康度评分**: 100


### ✅ dim_security_type

- **中文名**: dim_security_type
- **行数**: 12,078
- **列数**: 7
- **健康度评分**: 100


### ✅ dwd_stock_limit_up_feature

- **中文名**: dwd_stock_limit_up_feature
- **行数**: 382,549
- **列数**: 7
- **健康度评分**: 100


### ✅ etf_index_tracking

- **中文名**: etf_index_tracking
- **行数**: 1,209
- **列数**: 4
- **健康度评分**: 100


### ✅ go_data

- **中文名**: go_data
- **行数**: 259,816
- **列数**: 5
- **健康度评分**: 100


### ✅ gpsz_daily

- **中文名**: gpsz_daily
- **行数**: 48,114,666
- **列数**: 6
- **健康度评分**: 100


### ✅ lhb_broker_stat

- **中文名**: lhb_broker_stat
- **行数**: 716
- **列数**: 8
- **健康度评分**: 100


### ✅ sector_hierarchy

- **中文名**: sector_hierarchy
- **行数**: 925
- **列数**: 6
- **健康度评分**: 100


### ✅ sector_list

- **中文名**: sector_list
- **行数**: 925
- **列数**: 5
- **健康度评分**: 100


### ✅ sector_stocks

- **中文名**: sector_stocks
- **行数**: 91,564
- **列数**: 2
- **健康度评分**: 100


### ✅ sector_trading_data

- **中文名**: sector_trading_data
- **行数**: 4,964,469
- **列数**: 6
- **健康度评分**: 100


### ✅ stock_kline_15m

- **中文名**: stock_kline_15m
- **行数**: 73,386,633
- **列数**: 8
- **健康度评分**: 100


### ✅ stock_kline_30m

- **中文名**: stock_kline_30m
- **行数**: 40,769,561
- **列数**: 8
- **健康度评分**: 100


### ✅ stock_kline_5m

- **中文名**: 股票5分钟K线
- **行数**: 195,995,567
- **列数**: 8
- **健康度评分**: 100

- **代码前缀**: 60(37,842,192), 00(35,010,668), 30(30,827,616), 88(24,756,848), 68(13,227,552)
- **⚠️ 警告**:
  - '>' not supported between instances of 'datetime.datetime' and 'datetime.date'

### ✅ stock_kline_60m

- **中文名**: stock_kline_60m
- **行数**: 24,463,237
- **列数**: 8
- **健康度评分**: 100


### ✅ stock_sector_relation

- **中文名**: stock_sector_relation
- **行数**: 91,564
- **列数**: 3
- **健康度评分**: 100


### ✅ stock_trading_data

- **中文名**: stock_trading_data
- **行数**: 5,964,214
- **列数**: 6
- **健康度评分**: 100


### ✅ trading_calendar

- **中文名**: trading_calendar
- **行数**: 6,401
- **列数**: 3
- **健康度评分**: 100


### ✅ v_stock_list

- **中文名**: v_stock_list
- **行数**: 12,078
- **列数**: 4
- **健康度评分**: 100



---

## 四、修复建议

### 4.1 高优先级（健康度<50）

#### data_sync_log
- 问题: start_date: 94.9% 空值, end_date: 94.9% 空值, error_message: 100.0% 空值

#### dwd_stock_intraday_feature
- 问题: first_limit_up_time: 100.0% 空值, limit_up_count: 98.9% 空值, open_limit_count: 98.9% 空值

#### etf_derived_indicator
- 问题: tracking_error_20d: 89.5% 空值, tracking_error_60d: 89.5% 空值, excess_return_1d: 89.5% 空值, excess_return_5d: 89.5% 空值, excess_return_20d: 89.5% 空值, excess_return_1d: 45.9% 负值, excess_return_5d: 39.0% 负值, excess_return_20d: 31.5% 负值

#### etf_product
- 问题: management_fee: 100.0% 空值, custody_fee: 100.0% 空值, delist_date: 100.0% 空值

#### lhb_daily_summary
- 问题: change_pct: 35.9% 负值, net_buy: 48.8% 负值, net_buy_ratio: 48.8% 负值, after_1d: 52.0% 负值, after_2d: 56.4% 负值, after_5d: 60.0% 负值, after_10d: 62.1% 负值

#### stock_daily_kline
- 问题: change_pct: 100.0% 空值, turnover: 100.0% 空值, forward_factor: 100.0% 空值


### 4.2 中优先级（健康度50-79）

#### dws_sector_emotion
-警告: up_ratio: 100.0% 零值, sector_turnover: 100.0% 零值

#### lhb_broker_detail
-警告: 主键重复: 1694条

#### lhb_daily
-警告: buy_connect: 56.2% 空值, sell_connect: 56.2% 空值, list_days: 100.0% 零值

#### stock_dividend_data
-警告: right_issue_price: 95.9% 零值, right_issue_ratio: 95.9% 零值

#### stock_extended_info
-警告: beta_value: 100.0% 零值

#### stock_technical_indicators
-警告: 主键重复: 2520条


---

## 五、数据质量指标

| 指标 | 值 |
|------|-----|
| 分析表数 | 46 |
| 健康表数 | 34 (73%) |
| 警告表数 | 6 (13%) |
| 危险表数 | 6 (13%) |
| 严重问题总数 | 41 |
| 警告总数 | 26 |

---

*报告生成: data_health_audit.py*
