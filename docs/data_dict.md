# 数据字典 (自动生成)

> 生成时间: 2026-06-30T20:48:32
> 来源: 脚本@meta + DB DESCRIBE + 脚本FIELD_MAP(ast) + dim_*维度表

## 📊 正式表 (34 个)

### ? pianpao_daily_summary
- **中文**: [多表产物-70_pianpao_daily]
- **脚本**: `2_计算/70_pianpao_daily.py`

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| trade_date | DATE | 交易日期 | pianpao多表产物 |
| total_count | INTEGER | TODO | pianpao多表产物 |
| s_count | INTEGER | TODO | pianpao多表产物 |
| a_count | INTEGER | TODO | pianpao多表产物 |
| b_count | INTEGER | TODO | pianpao多表产物 |
| c_count | INTEGER | TODO | pianpao多表产物 |
| avg_gap_up | DOUBLE | TODO | pianpao多表产物 |
| avg_intraday_drop | DOUBLE | TODO | pianpao多表产物 |
| zt_rejected | INTEGER | TODO | pianpao多表产物 |
| sector_linked | INTEGER | TODO | pianpao多表产物 |

### ? pianpao_intraday
- **中文**: [多表产物-70_pianpao_daily]
- **脚本**: `2_计算/70_pianpao_daily.py`

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| trade_date | DATE | 交易日期 | pianpao多表产物 |
| stock_code | VARCHAR | TODO | pianpao多表产物 |
| total_bars | INTEGER | TODO | pianpao多表产物 |
| peak_time | VARCHAR | TODO | pianpao多表产物 |
| peak_price | DOUBLE | TODO | pianpao多表产物 |
| peak_idx | INTEGER | TODO | pianpao多表产物 |
| rise_bars | INTEGER | TODO | pianpao多表产物 |
| rise_pct | DOUBLE | TODO | pianpao多表产物 |
| rise_speed | DOUBLE | TODO | pianpao多表产物 |
| fall_bars | INTEGER | TODO | pianpao多表产物 |
| fall_pct | DOUBLE | TODO | pianpao多表产物 |
| fall_speed | DOUBLE | TODO | pianpao多表产物 |
| surge_count | INTEGER | TODO | pianpao多表产物 |
| crash_count | INTEGER | TODO | pianpao多表产物 |
| surge_vol_ratio | DOUBLE | TODO | pianpao多表产物 |
| crash_vol_ratio | DOUBLE | TODO | pianpao多表产物 |
| rise_fall_vol_ratio | DOUBLE | TODO | pianpao多表产物 |
| surge_vol_label | VARCHAR | TODO | pianpao多表产物 |
| crash_vol_label | VARCHAR | TODO | pianpao多表产物 |

### ? pianpao_intraday_events
- **中文**: [多表产物-70_pianpao_daily]
- **脚本**: `2_计算/70_pianpao_daily.py`

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| trade_date | DATE | 交易日期 | pianpao多表产物 |
| stock_code | VARCHAR | TODO | pianpao多表产物 |
| seq | INTEGER | TODO | pianpao多表产物 |
| event_type | VARCHAR | TODO | pianpao多表产物 |
| start_time | VARCHAR | TODO | pianpao多表产物 |
| end_time | VARCHAR | TODO | pianpao多表产物 |
| start_price | DOUBLE | TODO | pianpao多表产物 |
| end_price | DOUBLE | TODO | pianpao多表产物 |
| pct | DOUBLE | TODO | pianpao多表产物 |
| speed_label | VARCHAR | TODO | pianpao多表产物 |
| volume | BIGINT | 成交量 | pianpao多表产物 |

### ? pianpao_intraday_periods
- **中文**: [多表产物-70_pianpao_daily]
- **脚本**: `2_计算/70_pianpao_daily.py`

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| trade_date | DATE | 交易日期 | pianpao多表产物 |
| stock_code | VARCHAR | TODO | pianpao多表产物 |
| period_name | VARCHAR | TODO | pianpao多表产物 |
| change_pct | DOUBLE | TODO | pianpao多表产物 |
| max_gain | DOUBLE | TODO | pianpao多表产物 |
| max_loss | DOUBLE | TODO | pianpao多表产物 |
| vol_ratio | DOUBLE | TODO | pianpao多表产物 |
| bar_count | INTEGER | TODO | pianpao多表产物 |

### ? t_bk5_19_industry_labeled
- **中文**: 板块BK交易数据_打行业标签
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期 | 视图, 字段含义继承主表 |
| code | VARCHAR | 代码 | 视图, 字段含义继承主表 |
| bk_name | VARCHAR | 板块指标名 | 视图, 字段含义继承主表 |
| pe_ttm | DOUBLE | 市盈率TTM | 视图, 字段含义继承主表 |
| pb_mrq | DOUBLE | 市净率MRQ | 视图, 字段含义继承主表 |
| ps_ttm | DOUBLE | 市销率TTM | 视图, 字段含义继承主表 |
| pc_ttm | DOUBLE | 市现率TTM | 视图, 字段含义继承主表 |
| 涨跌数 | DOUBLE | 涨跌数 | 视图, 字段含义继承主表 |
| 总市值 | DOUBLE | 总市值 | 视图, 字段含义继承主表 |
| 流通市值 | DOUBLE | 流通市值 | 视图, 字段含义继承主表 |
| 涨停数 | DOUBLE | 涨停数 | 视图, 字段含义继承主表 |
| 跌停数 | DOUBLE | 跌停数 | 视图, 字段含义继承主表 |
| 涨停数据 | DOUBLE | 涨停数据 | 视图, 字段含义继承主表 |
| 融资融券 | DOUBLE | 融资融券 | 视图, 字段含义继承主表 |
| 陆股通流入 | DOUBLE | 陆股通流入 | 视图, 字段含义继承主表 |
| 开盘成交数 | DOUBLE | 开盘成交数 | 视图, 字段含义继承主表 |
| 股息率 | DOUBLE | 股息率 | 视图, 字段含义继承主表 |
| 自由流通市值 | DOUBLE | 自由流通市值 | 视图, 字段含义继承主表 |
| 级别 | VARCHAR | 级别 | 视图, 字段含义继承主表 |
| 行业一级代码 | VARCHAR | 行业一级代码 | 视图, 字段含义继承主表 |
| 行业一级名称 | VARCHAR | 行业一级名称 | 视图, 字段含义继承主表 |
| 行业二级代码 | VARCHAR | 行业二级代码 | 视图, 字段含义继承主表 |
| 行业二级名称 | VARCHAR | 行业二级名称 | 视图, 字段含义继承主表 |
| 行业三级代码 | VARCHAR | 行业三级代码 | 视图, 字段含义继承主表 |
| 行业三级名称 | VARCHAR | 行业三级名称 | 视图, 字段含义继承主表 |

### ? stock_gp1_46_indicators_labeled
- **中文**: [VIEW] 个股GP指标 - 带字段含义
- **脚本**: `1_入库/93_stock_gp1_46_indicators.py`

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期 | 视图, 字段同主表 |
| code | VARCHAR | 代码 | 视图, 字段同主表 |
| gp_code | VARCHAR | TODO | 视图, 字段同主表 |
| gp_name | VARCHAR | TODO | 视图, 字段同主表 |
| value_0 | DOUBLE | TODO | 视图, 字段同主表 |
| value_1 | DOUBLE | TODO | 视图, 字段同主表 |
| value_0_name | VARCHAR | TODO | 视图, 字段同主表 |
| value_0_unit | VARCHAR | TODO | 视图, 字段同主表 |
| value_1_name | VARCHAR | TODO | 视图, 字段同主表 |
| value_1_unit | VARCHAR | TODO | 视图, 字段同主表 |
| present | BOOLEAN | TODO | 视图, 字段同主表 |
| note | VARCHAR | 备注 | 视图, 字段同主表 |

### ? stock_block_relation_industry_labeled
- **中文**: 股票板块关系_打行业归属
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| stock_code | VARCHAR | TODO | 视图, 字段含义继承主表 |
| 板块代码 | VARCHAR | 板块代码 | 视图, 字段含义继承主表 |
| 板块名称 | VARCHAR | 板块名称 | 视图, 字段含义继承主表 |
| 板块类型 | VARCHAR | 板块类型 | 视图, 字段含义继承主表 |
| 成分股数 | INTEGER | 成分股数 | 视图, 字段含义继承主表 |
| fetch_time | TIMESTAMP | TODO | 视图, 字段含义继承主表 |
| 行业一级代码 | VARCHAR | 行业一级代码 | 视图, 字段含义继承主表 |
| 行业一级名称 | VARCHAR | 行业一级名称 | 视图, 字段含义继承主表 |
| 行业二级代码 | VARCHAR | 行业二级代码 | 视图, 字段含义继承主表 |
| 行业二级名称 | VARCHAR | 行业二级名称 | 视图, 字段含义继承主表 |
| 行业三级代码 | VARCHAR | 行业三级代码 | 视图, 字段含义继承主表 |
| 行业三级名称 | VARCHAR | 行业三级名称 | 视图, 字段含义继承主表 |

### ? dim_88field_indicator
- **中文**: [配套维度表]
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| field_en | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| field_cn | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| category | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| category_cn | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| unit | VARCHAR | 单位 | 维度表, 提供枚举/字段含义 |
| remark | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| source | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| created_at | TIMESTAMP | TODO | 维度表, 提供枚举/字段含义 |

### ? dim_gp_indicator
- **中文**: [配套维度表]
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| gp_code | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| gp_name | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| value_0_name | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| value_0_unit | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| value_1_name | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| value_1_unit | VARCHAR | TODO | 维度表, 提供枚举/字段含义 |
| note | VARCHAR | 备注 | 维度表, 提供枚举/字段含义 |
| present | BOOLEAN | TODO | 维度表, 提供枚举/字段含义 |

### ? auction_snapshot
- **中文**: [外部子系统-竞价监控]
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| hq_date | DATE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| code | VARCHAR | 代码 | 外部子系统表(竞价监控), 不参与run.py治理 |
| last_close | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| open_price | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| now_price | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| volume | BIGINT | 成交量 | 外部子系统表(竞价监控), 不参与run.py治理 |
| amount | DOUBLE | 成交额 | 外部子系统表(竞价监控), 不参与run.py治理 |
| fetch_time | TIMESTAMP | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| source | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |

### ? auction_labels
- **中文**: [外部子系统-竞价监控]
- **脚本**: ``

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| hq_date | DATE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| code | VARCHAR | 代码 | 外部子系统表(竞价监控), 不参与run.py治理 |
| phase | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| label | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| aux | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| confidence | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| open_pct | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| zjl_ratio | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| float_mcap | DOUBLE | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| trap_cnt | INTEGER | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| reason | VARCHAR | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |
| run_ts | TIMESTAMP | TODO | 外部子系统表(竞价监控), 不参与run.py治理 |

### 010 stock_daily_kline
- **中文**: 股票日K线
- **脚本**: `1_入库/10_stock_daily_kline.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| date | DATE | 日期（YYYYMMDD） |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |
| 涨跌幅 | DOUBLE | 涨跌幅 |  |
| 换手率 | INTEGER | 换手率 |  |
| 前复权因子 | INTEGER | 前复权因子 |  |

### 033 sector_stocks
- **中文**: 板块成份股
- **脚本**: `1_入库/33_sector_stocks.py`
- **schedule**: daily | **mode**: full
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| sector_code | VARCHAR | TODO |  |
| stock_code | VARCHAR | TODO |  |

### 034 t_bk5_19
- **中文**: 板块BK交易数据
- **脚本**: `1_入库/34_t_bk5_19_.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期（YYYYMMDD） |  |
| code | VARCHAR | 证券代码 |  |
| bk_name | VARCHAR | 板块指标名 |  |
| pe_ttm | DOUBLE | 市盈率TTM |  |
| pb_mrq | DOUBLE | 市净率（MRQ） |  |
| ps_ttm | DOUBLE | 市销率TTM |  |
| pc_ttm | DOUBLE | 市现率TTM |  |
| 涨跌数 | DOUBLE | 涨跌数 |  |
| 总市值 | DOUBLE | 总市值 |  |
| 流通市值 | DOUBLE | 流通市值 |  |
| 涨停数 | DOUBLE | 涨停数 |  |
| 跌停数 | DOUBLE | 跌停数 |  |
| 涨停数据 | DOUBLE | 涨停数据 |  |
| 融资融券 | DOUBLE | 融资融券 |  |
| 陆股通流入 | DOUBLE | 陆股通流入 |  |
| 开盘成交数 | DOUBLE | 开盘成交数 |  |
| 股息率 | DOUBLE | 股息率 |  |
| 自由流通市值 | DOUBLE | 自由流通市值 |  |

### 035 stock_industry_3level
- **中文**: 股票行业三级分类
- **脚本**: `1_入库/35_stock_industry_3level.py`
- **schedule**: weekly | **mode**: full
- **数据源**: API(TQ:get_stock_list+get_stock_list_in_sector)

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| stock_code | VARCHAR | 股票代码 |  |
| 行业一级代码 | VARCHAR | 行业一级代码 |  |
| 行业一级名称 | VARCHAR | 行业一级名称 |  |
| 行业二级代码 | VARCHAR | 行业二级代码 |  |
| 行业二级名称 | VARCHAR | 行业二级名称 |  |
| 行业三级代码 | VARCHAR | 行业三级代码 |  |
| 行业三级名称 | VARCHAR | 行业三级名称 |  |
| updated_at | TIMESTAMP | 本批刷新时间 |  |

### 080 stock_kline_1m
- **中文**: 股票分钟K线1m
- **脚本**: `1_入库/080_stock_kline_1m.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |
| trade_time | TIMESTAMP | 交易时间 |  |

### 081 stock_kline_5m
- **中文**: 股票分钟K线5m
- **脚本**: `1_入库/081_stock_kline_5m.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| trade_time | TIMESTAMP | 交易时间 |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |

### 091 trading_calendar
- **中文**: 交易日历
- **脚本**: `1_入库/91_trading_calendar.py`
- **schedule**: daily | **mode**: increment
- **数据源**: API(TQ)

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期（YYYYMMDD） |  |
| is_trading | BOOLEAN | 是否交易日 |  |
| market | VARCHAR | 所属市场 |  |

### 092 market_sc1_42
- **中文**: 市场SC宏观指标
- **脚本**: `1_入库/92_market_sc1_42.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期（YYYYMMDD） |  |
| 融资融券_融资余额 | DOUBLE | 融资融券_融资余额 |  |
| 融资融券_融券余额 | DOUBLE | 融资融券_融券余额 |  |
| 陆股通资金流入_沪股通流入 | DOUBLE | 陆股通资金流入_沪股通流入 |  |
| 陆股通资金流入_深股通流入 | DOUBLE | 陆股通资金流入_深股通流入 |  |
| 沪深京涨停股个数_涨停股个数 | DOUBLE | 沪深京涨停股个数_涨停股个数 |  |
| 沪深京涨停股个数_曾涨停股个数 | DOUBLE | 沪深京涨停股个数_曾涨停股个数 |  |
| 沪深京跌停股个数_跌停股个数 | DOUBLE | 沪深京跌停股个数_跌停股个数 |  |
| 沪深京跌停股个数_曾跌停股个数 | DOUBLE | 沪深京跌停股个数_曾跌停股个数 |  |
| 上证50股指期货_净持仓 | DOUBLE | 上证50股指期货_净持仓 |  |
| 沪深300股指期货_净持仓 | DOUBLE | 沪深300股指期货_净持仓 |  |
| 中证500股指期货_净持仓 | DOUBLE | 中证500股指期货_净持仓 |  |
| ETF基金规模份额_ETF规模 | DOUBLE | ETF基金规模份额_ETF规模 |  |
| ETF基金规模份额_ETF净申赎 | DOUBLE | ETF基金规模份额_ETF净申赎 |  |
| 沪月新开A股账户_新开账户 | DOUBLE | 沪月新开A股账户_新开账户 |  |
| 增减持统计_增持额 | DOUBLE | 增减持统计_增持额 |  |
| 增减持统计_减持额 | DOUBLE | 增减持统计_减持额 |  |
| 大宗交易_溢价交易额 | DOUBLE | 大宗交易_溢价交易额 |  |
| 大宗交易_折价交易额 | DOUBLE | 大宗交易_折价交易额 |  |
| 限售解禁_计划额 | DOUBLE | 限售解禁_计划额 |  |
| 限售解禁_实际上市 | DOUBLE | 限售解禁_实际上市 |  |
| 分红_总分红额 | DOUBLE | 分红_总分红额 |  |
| 募资_总募资额 | DOUBLE | 募资_总募资额 |  |
| 打板资金_封板成功 | DOUBLE | 打板资金_封板成功 |  |
| 打板资金_封板失败 | DOUBLE | 打板资金_封板失败 |  |
| 龙虎榜_买入总额 | DOUBLE | 龙虎榜_买入总额 |  |
| 龙虎榜_卖出总额 | DOUBLE | 龙虎榜_卖出总额 |  |
| 龙虎榜机构数据_机构买入 | DOUBLE | 龙虎榜机构数据_机构买入 |  |
| 龙虎榜机构数据_机构卖出 | DOUBLE | 龙虎榜机构数据_机构卖出 |  |
| 龙虎榜营业部数据_营业部买入 | DOUBLE | 龙虎榜营业部数据_营业部买入 |  |
| 龙虎榜营业部数据_营业部卖出 | DOUBLE | 龙虎榜营业部数据_营业部卖出 |  |
| 龙虎榜沪深股通数据_沪深股通买入 | DOUBLE | 龙虎榜沪深股通数据_沪深股通买入 |  |
| 龙虎榜沪深股通数据_沪深股通卖出 | DOUBLE | 龙虎榜沪深股通数据_沪深股通卖出 |  |
| 陆股通净买入_沪股通净买入 | DOUBLE | 陆股通净买入_沪股通净买入 |  |
| 陆股通净买入_深股通净买入 | DOUBLE | 陆股通净买入_深股通净买入 |  |
| 每周无限售质押率_深市质押率 | DOUBLE | 每周无限售质押率_深市质押率 |  |
| 每周无限售质押率_沪市质押率 | DOUBLE | 每周无限售质押率_沪市质押率 |  |
| 每周有限售质押率_深市质押率 | DOUBLE | 每周有限售质押率_深市质押率 |  |
| 每周有限售质押率_沪市质押率 | DOUBLE | 每周有限售质押率_沪市质押率 |  |
| 连板家数_含ST连板数 | DOUBLE | 连板家数_含ST连板数 |  |
| 连板家数_不含ST连板数 | DOUBLE | 连板家数_不含ST连板数 |  |
| 沪深京涨跌停_涨停 | DOUBLE | 沪深京涨跌停_涨停 |  |
| 沪深京涨跌停_跌停 | DOUBLE | 沪深京涨跌停_跌停 |  |
| 融资融券_融资买入额 | DOUBLE | 融资融券_融资买入额 |  |
| 融资融券_融券卖出量 | DOUBLE | 融资融券_融券卖出量 |  |
| 每周市场质押比_质押比例 | DOUBLE | 每周市场质押比_质押比例 |  |
| 央行公开市场净投放_净投放 | DOUBLE | 央行公开市场净投放_净投放 |  |
| 历史A股新高新低_历史新高 | DOUBLE | 历史A股新高新低_历史新高 |  |
| 历史A股新高新低_历史新低 | DOUBLE | 历史A股新高新低_历史新低 |  |
| 120天A股新高新低_120天新高 | DOUBLE | 120天A股新高新低_120天新高 |  |
| 120天A股新高新低_120天新低 | DOUBLE | 120天A股新高新低_120天新低 |  |
| 涨停数据_市场高度 | DOUBLE | 涨停数据_市场高度 |  |
| 涨停数据_2板以上涨停 | DOUBLE | 涨停数据_2板以上涨停 |  |
| 涨跌家数_涨家数 | DOUBLE | 涨跌家数_涨家数 |  |
| 涨跌家数_跌家数 | DOUBLE | 涨跌家数_跌家数 |  |
| 20天A股新高新低_20天新高 | DOUBLE | 20天A股新高新低_20天新高 |  |
| 20天A股新高新低_20天新低 | DOUBLE | 20天A股新高新低_20天新低 |  |
| 市场总封单金额_涨停封单 | DOUBLE | 市场总封单金额_涨停封单 |  |
| 市场总封单金额_跌停封单 | DOUBLE | 市场总封单金额_跌停封单 |  |
| 涨跌股成交量_上涨成交量 | DOUBLE | 涨跌股成交量_上涨成交量 |  |
| 涨跌股成交量_下跌成交量 | DOUBLE | 涨跌股成交量_下跌成交量 |  |
| 涨停数据_换手板家数 | DOUBLE | 涨停数据_换手板家数 |  |
| 涨停数据_回封率 | DOUBLE | 涨停数据_回封率 |  |
| 曾涨跌停股个数_曾涨停 | DOUBLE | 曾涨跌停股个数_曾涨停 |  |
| 曾涨跌停股个数_曾跌停 | DOUBLE | 曾涨跌停股个数_曾跌停 |  |
| 转融券_融出市值 | DOUBLE | 转融券_融出市值 |  |
| 转融券_期末余额 | DOUBLE | 转融券_期末余额 |  |
| ETF基金规模金额_ETF规模 | DOUBLE | ETF基金规模金额_ETF规模 |  |
| ETF基金规模金额_ETF净申赎 | DOUBLE | ETF基金规模金额_ETF净申赎 |  |
| 涨跌5%家数_涨超5 | DOUBLE | 涨跌5%家数_涨超5 |  |
| 涨跌5%家数_跌超5 | DOUBLE | 涨跌5%家数_跌超5 |  |
| 陆股通成交_陆股通总额 | DOUBLE | 陆股通成交_陆股通总额 |  |
| 陆股通成交_陆股通总笔 | DOUBLE | 陆股通成交_陆股通总笔 |  |
| 中证1000股指期货_净持仓 | DOUBLE | 中证1000股指期货_净持仓 |  |
| 沪深股通成交金额_沪股通总额 | DOUBLE | 沪深股通成交金额_沪股通总额 |  |
| 沪深股通成交金额_深股通总额 | DOUBLE | 沪深股通成交金额_深股通总额 |  |

### 093 stock_gp1_46_indicators
- **中文**: 个股GP指标
- **脚本**: `1_入库/93_stock_gp1_46_indicators.py`
- **schedule**: daily | **mode**: increment
- **数据源**: 二进制

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| date | DATE | 日期（YYYYMMDD） |  |
| code | VARCHAR | 证券代码 |  |
| gp_code | VARCHAR | 指标代码 |  |
| gp_name | VARCHAR | 指标名称 |  |
| value_0 | DOUBLE | 指标值1 |  |
| value_1 | DOUBLE | 指标值2 |  |

### 101 sjb_api_plhqL2kz_88zd
- **中文**: L2快照88字段
- **脚本**: `1_入库/101_jb_api_plhqL2kz_88zd.py`
- **schedule**: daily | **mode**: increment
- **数据源**: tqcenter

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| MainBusiness | VARCHAR | 主营构成 |  |
| SafeValue | VARCHAR | 安全值 |  |
| ShineValue | VARCHAR | 发光值 |  |
| ShapeValue | VARCHAR | 形状值 |  |
| TPFlag | VARCHAR | T+0标志 |  |
| ZTPrice | VARCHAR | 涨停价 |  |
| DTPrice | VARCHAR | 跌停价 |  |
| HqDate | VARCHAR | 行情日期 |  |
| fHSL | VARCHAR | 换手率% |  |
| fLianB | VARCHAR | 连板天数 |  |
| Wtb | VARCHAR | 委比 |  |
| Zsz | VARCHAR | 总市值_万 |  |
| Ltsz | VARCHAR | 流通市值_万 |  |
| vzangsu | VARCHAR | 涨速 |  |
| Fzhsl | VARCHAR | 振幅% |  |
| FzAmo | VARCHAR | 成交金额_万 |  |
| VOpenZAF | VARCHAR | 抢筹涨幅% |  |
| ZAF | VARCHAR | 日涨跌幅% |  |
| ZAFYesterday | VARCHAR | 昨日涨跌幅% |  |
| ZAFPre2D | VARCHAR | 前2日涨跌幅% |  |
| ZAFPre5 | VARCHAR | 近5日涨跌幅% |  |
| ZAFPre10 | VARCHAR | 近10日涨跌幅% |  |
| ZAFPre20 | VARCHAR | 近20日涨跌幅% |  |
| ZAFPre30 | VARCHAR | 近30日涨跌幅% |  |
| ZAFPre60 | VARCHAR | 近60日涨跌幅% |  |
| ZAFYear | VARCHAR | 近一年涨跌幅% |  |
| ZAFPreMyMonth | VARCHAR | 近一月涨跌幅% |  |
| ZAFPreOneYear | VARCHAR | 近一年涨幅2% |  |
| Zjl | VARCHAR | 主买净额_万 |  |
| Zjl_HB | VARCHAR | 主力净流入_万 |  |
| TotalBVol | VARCHAR | 总买量 |  |
| TotalSVol | VARCHAR | 总卖量 |  |
| BCancel | VARCHAR | 买撤单笔数 |  |
| SCancel | VARCHAR | 卖撤单笔数 |  |
| L2TicNum | VARCHAR | L2逐笔成交数 |  |
| L2OrderNum | VARCHAR | L2逐笔委托数 |  |
| FCAmo | VARCHAR | 主买成交额_万 |  |
| FCb | VARCHAR | 封单比 |  |
| OpenZAF | VARCHAR | 开盘涨跌幅% |  |
| OpenAmo | VARCHAR | 开盘金额 |  |
| OpenZTBuy | VARCHAR | 开盘涨停买入 |  |
| OpenAmoPre1 | VARCHAR | 昨日开盘金额 |  |
| OpenVolPre1 | VARCHAR | 昨日开盘量 |  |
| CJJEPre1 | VARCHAR | 昨日成交金额 |  |
| CJJEPre3 | VARCHAR | 前3日成交金额 |  |
| FDEPre1 | VARCHAR | 昨日封单额 |  |
| FDEPre2 | VARCHAR | 前2日封单额 |  |
| ZTGPNum | VARCHAR | 板块内涨停个股数 |  |
| LastStartZT | VARCHAR | 首次涨停时间 |  |
| LastZTHzNum | VARCHAR | 连板数 |  |
| EverZTCount | VARCHAR | 历史涨停次数 |  |
| ConZAFDateNum | VARCHAR | 连涨天数 |  |
| YearZTDay | VARCHAR | 近一年涨停天数 |  |
| MA5Value | VARCHAR | MA5均线值 |  |
| HisHigh | VARCHAR | 历史最高价 |  |
| HisLow | VARCHAR | 历史最低价 |  |
| IPO_Price | VARCHAR | IPO发行价 |  |
| More_YJL | VARCHAR | 业绩预告 |  |
| BetaValue | VARCHAR | Beta系数 |  |
| DynaPE | VARCHAR | 动态市盈率 |  |
| MorePE | VARCHAR | 更多PE |  |
| StaticPE_TTM | VARCHAR | 静态PE_TTM |  |
| DYRatio | VARCHAR | 股息率 |  |
| PB_MRQ | VARCHAR | 市净率 |  |
| IsT0Fund | VARCHAR | 是否T+0基金 |  |
| IsZCZGP | VARCHAR | 是否中概股 |  |
| IsKzz | VARCHAR | 是否可转债 |  |
| Kzz_HSCode | VARCHAR | 可转债沪市代码 |  |
| QHMainYYMM | VARCHAR | 期货主力合约月份 |  |
| FreeLtgb | VARCHAR | 自由流通股本 |  |
| Yield | VARCHAR | 收益率 |  |
| KfEarnMoney | VARCHAR | 可赚钱 |  |
| RDInputFee | VARCHAR | 研发投入费用 |  |
| CashZJ | VARCHAR | 现金资金 |  |
| PreReceiveZJ | VARCHAR | 预收资金 |  |
| OtherQYJzc | VARCHAR | 其他权益净资产 |  |
| StaffNum | VARCHAR | 员工人数 |  |
| RecentGGJYDate | VARCHAR | 最近股权激励日期 |  |
| RecentHGDate | VARCHAR | 最近回购日期 |  |
| RecentIncentDate | VARCHAR | 最近激励日期 |  |
| NoticeDate_Recent | VARCHAR | 最近公告日期 |  |
| RecentReleaseDate | VARCHAR | 最近解禁日期 |  |
| RecentDZDate | VARCHAR | 最近大宗交易日期 |  |
| ReportDate | VARCHAR | 报告期 |  |
| ZTDate_Recent | VARCHAR | 最近涨停日期 |  |
| DTDate_Recent | VARCHAR | 最近跌停日期 |  |
| TopDate_Recent | VARCHAR | 最近创新高日期 |  |
| StopJYDate_Recent | VARCHAR | 最近停牌日期 |  |
| code | VARCHAR | 股票代码 |  |
| stock_type | VARCHAR | 标的类型 |  |
| fetch_time | VARCHAR | 查询时间 |  |

### 104 stock_financial_data
- **中文**: 股票专业财务数据(2026季度)
- **脚本**: `1_入库/104_stock_financial_data.py`
- **schedule**: daily | **mode**: increment
- **数据源**: API(TQ:get_financial_data)

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| announce_time | BIGINT | TODO |  |
| tag_time | BIGINT | TODO |  |
| FN1 | DOUBLE | 基本每股收益 |  |
| FN2 | DOUBLE | 扣非每股收益 |  |
| FN3 | DOUBLE | 每股未分配利润 |  |
| FN4 | DOUBLE | 每股净资产 |  |
| FN5 | DOUBLE | 每股资本公积金 |  |
| FN6 | DOUBLE | 净资产收益率 |  |
| FN7 | DOUBLE | 每股经营现金流量 |  |
| FN8 | DOUBLE | 货币资金 |  |
| FN17 | DOUBLE | 存货 |  |
| FN21 | DOUBLE | 流动资产合计 |  |
| FN27 | DOUBLE | 固定资产 |  |
| FN28 | DOUBLE | 在建工程 |  |
| FN33 | DOUBLE | 无形资产 |  |
| FN35 | DOUBLE | 商誉 |  |
| FN39 | DOUBLE | 非流动资产合计 |  |
| FN40 | DOUBLE | 资产总计 |  |
| FN41 | DOUBLE | 短期借款 |  |
| FN54 | DOUBLE | 流动负债合计 |  |
| FN55 | DOUBLE | 长期借款 |  |
| FN62 | DOUBLE | 非流动负债合计 |  |
| FN63 | DOUBLE | 负债合计 |  |
| FN64 | DOUBLE | 实收资本 |  |
| FN65 | DOUBLE | 资本公积 |  |
| FN66 | DOUBLE | 盈余公积 |  |
| FN68 | DOUBLE | 未分配利润 |  |
| FN72 | DOUBLE | 所有者权益合计 |  |
| FN134 | DOUBLE | 净利润 |  |
| FN207 | DOUBLE | 息税前利润EBIT |  |
| FN208 | DOUBLE | 息税折旧摊销前利润EBITDA |  |
| FN230 | DOUBLE | 营业收入 |  |
| FN231 | DOUBLE | 营业利润 |  |
| FN232 | DOUBLE | 归母净利润 |  |
| FN233 | DOUBLE | 扣非净利润 |  |
| FN304 | DOUBLE | 研发费用 |  |
| FN234 | DOUBLE | 经营活动现金流量净额 |  |
| FN235 | DOUBLE | 投资活动现金流量净额 |  |
| FN236 | DOUBLE | 筹资活动现金流量净额 |  |
| FN133 | DOUBLE | 期末现金及现金等价物余额 |  |
| FN219 | DOUBLE | 每股经营性现金流 |  |
| FN225 | DOUBLE | 每股现金流量净额 |  |
| FN238 | DOUBLE | 总股本 |  |
| FN281 | DOUBLE | 加权净资产收益率 |  |
| FN311 | DOUBLE | 基本每股收益_单季度 |  |
| FN312 | DOUBLE | 营业总收入_单季度 |  |
| FN324 | DOUBLE | 净利润_单季度 |  |
| fetch_time | VARCHAR | TODO |  |

### 105 market_snapshot
- **中文**: 市场快照数据
- **脚本**: `1_入库/105_market_snapshot.py`
- **schedule**: intraday | **mode**: increment
- **数据源**: tqcenter

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| snapshot_time | TIMESTAMP | 快照时间 |  |
| LastClose | DOUBLE | 前收盘价 |  |
| Open | DOUBLE | 开盘价 |  |
| Max | DOUBLE | 最高价 |  |
| Min | DOUBLE | 最低价 |  |
| Now | DOUBLE | 现价 |  |
| Volume | INTEGER | 总手 |  |
| NowVol | INTEGER | 现手 |  |
| Amount | DOUBLE | 总成交金额 |  |
| Inside | INTEGER | 内盘 |  |
| Outside | INTEGER | 外盘 |  |
| TickDiff | DOUBLE | 笔涨跌 |  |
| InOutFlag | INTEGER | 内外盘标志 |  |
| Jjjz | DOUBLE | 基金净值 |  |
| Buyp1 | DOUBLE | 买一价 |  |
| Buyp2 | DOUBLE | 买二价 |  |
| Buyp3 | DOUBLE | 买三价 |  |
| Buyp4 | DOUBLE | 买四价 |  |
| Buyp5 | DOUBLE | 买五价 |  |
| Buyv1 | INTEGER | 买一量 |  |
| Buyv2 | INTEGER | 买二量 |  |
| Buyv3 | INTEGER | 买三量 |  |
| Buyv4 | INTEGER | 买四量 |  |
| Buyv5 | INTEGER | 买五量 |  |
| Sellp1 | DOUBLE | 卖一价 |  |
| Sellp2 | DOUBLE | 卖二价 |  |
| Sellp3 | DOUBLE | 卖三价 |  |
| Sellp4 | DOUBLE | 卖四价 |  |
| Sellp5 | DOUBLE | 卖五价 |  |
| Sellv1 | INTEGER | 卖一量 |  |
| Sellv2 | INTEGER | 卖二量 |  |
| Sellv3 | INTEGER | 卖三量 |  |
| Sellv4 | INTEGER | 卖四量 |  |
| Sellv5 | INTEGER | 卖五量 |  |
| UpHome | INTEGER | 上涨家数 |  |
| DownHome | INTEGER | 下跌家数 |  |
| Before5MinNow | DOUBLE | 5分钟前价格 |  |
| Average | DOUBLE | 均价 |  |
| XsFlag | INTEGER | 小数位数 |  |
| Zangsu | DOUBLE | 涨速 |  |
| ZAFPre3 | DOUBLE | 3日涨幅 |  |

### 137 capital_info
- **中文**: 股本数据(近1年)
- **脚本**: `1_入库/137_capital_info.py`
- **schedule**: daily | **mode**: increment
- **数据源**: tqcenter

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 股票代码(带交易所后缀) |  |
| date | DATE | 日期 |  |
| zgb | DOUBLE | 总股本(股) |  |
| ltgb | DOUBLE | 流通股本(股) |  |
| updated_at | TIMESTAMP | 入库时间 |  |

### 262 stock_block_relation
- **中文**: 股票板块关系
- **脚本**: `1_入库/262_stock_block_relation.py`
- **schedule**: daily | **mode**: increment
- **数据源**: API(TQ:get_relation)

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| stock_code | VARCHAR | 股票代码 |  |
| 板块代码 | VARCHAR | 板块代码 |  |
| 板块名称 | VARCHAR | 板块名称 |  |
| 板块类型 | VARCHAR | 板块类型 |  |
| 成分股数 | INTEGER | 成分股数 |  |
| fetch_time | TIMESTAMP | 采集时间 |  |

### 001 dim_security_type
- **中文**: 证券类型维表
- **脚本**: `2_计算/001_dim_security_type_sync.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL派生

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| type | VARCHAR | 证券类型 |  |
| market | VARCHAR | 所属市场 |  |
| prefix | VARCHAR | TODO |  |
| is_active | BOOLEAN | TODO |  |
| created_at | TIMESTAMP | TODO |  |
| updated_at | TIMESTAMP | TODO |  |

### 017 stock_kline_weekly
- **中文**: 股票周K线
- **脚本**: `2_计算/17_stock_kline_weekly.py`
- **schedule**: weekly | **mode**: full
- **数据源**: SQL聚合

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| date | DATE | 日期（YYYYMMDD） |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |
| 涨跌幅 | DOUBLE | 涨跌幅 |  |

### 018 stock_kline_monthly
- **中文**: 股票月K线
- **脚本**: `2_计算/18_stock_kline_monthly.py`
- **schedule**: monthly | **mode**: full
- **数据源**: SQL聚合

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| date | DATE | 日期（YYYYMMDD） |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |
| 涨跌幅 | DOUBLE | 涨跌幅 |  |

### 019 stock_daily_turnover
- **中文**: 日换手率涨跌幅
- **脚本**: `2_计算/19_stock_daily_turnover.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL派生(stock_daily_kline+capital_info

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 股票代码(带后缀) |  |
| date | DATE | 日期 |  |
| turnover | DOUBLE | 换手率%(成交量/流通股本*100) |  |
| pct_chg | DOUBLE | 涨跌幅%((close-前日close)/前日close*100) |  |

### 036 dim_industry_code
- **中文**: 研究行业代码维度表
- **脚本**: `2_计算/36_dim_industry_code.py`
- **schedule**: weekly | **mode**: full
- **数据源**: SQL派生(stock_industry_3level)

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| 名称 | VARCHAR | 名称 |  |
| 级别 | VARCHAR | 级别 |  |
| 行业一级代码 | VARCHAR | 行业一级代码 |  |
| 行业一级名称 | VARCHAR | 行业一级名称 |  |
| 行业二级代码 | VARCHAR | 行业二级代码 |  |
| 行业二级名称 | VARCHAR | 行业二级名称 |  |
| 行业三级代码 | VARCHAR | 行业三级代码 |  |
| 行业三级名称 | VARCHAR | 行业三级名称 |  |

### 070 pianpao_daily
- **中文**: 骗炮每日明细
- **脚本**: `2_计算/70_pianpao_daily.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL派生

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| trade_date | DATE | 交易日期 |  |
| stock_code | VARCHAR | TODO |  |
| stock_name | VARCHAR | TODO |  |
| level | VARCHAR | TODO |  |
| severity | DOUBLE | TODO |  |
| prev_close | DOUBLE | TODO |  |
| open_price | DOUBLE | TODO |  |
| close_price | DOUBLE | TODO |  |
| high_price | DOUBLE | TODO |  |
| low_price | DOUBLE | TODO |  |
| volume | BIGINT | 成交量 |  |
| gap_up_pct | DOUBLE | TODO |  |
| open_to_close_pct | DOUBLE | TODO |  |
| day_change_pct | DOUBLE | TODO |  |
| upper_shadow_ratio | DOUBLE | TODO |  |
| zt_price | DOUBLE | TODO |  |
| zt_distance | DOUBLE | TODO |  |
| touched_zt | BOOLEAN | TODO |  |
| prev1_change | DOUBLE | TODO |  |
| prev3_trend | VARCHAR | TODO |  |
| prev3_total_change | DOUBLE | TODO |  |
| scenario | VARCHAR | TODO |  |
| sectors | VARCHAR | TODO |  |
| trap_direction | VARCHAR | TODO |  |
| trap_type | VARCHAR | TODO |  |
| lifecycle_stage | VARCHAR | TODO |  |
| trap_confirmed | BOOLEAN | TODO |  |
| turnover | DOUBLE | TODO |  |
| vol_ratio_5d | DOUBLE | TODO |  |
| consecutive_zt | INTEGER | TODO |  |
| break_count | INTEGER | TODO |  |
| seal_ratio | DOUBLE | TODO |  |
| ma5 | DOUBLE | 5日均线 |  |
| ma10 | DOUBLE | 10日均线 |  |
| ma20 | DOUBLE | 20日均线 |  |
| ma60 | DOUBLE | 60日均线 |  |
| dev_ma20 | DOUBLE | TODO |  |

### 082 stock_kline_15m
- **中文**: 股票15分钟K线
- **脚本**: `2_计算/82_stock_kline_15m.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL聚合

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| trade_time | TIMESTAMP | 交易时间 |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |

### 083 stock_kline_30m
- **中文**: 股票30分钟K线
- **脚本**: `2_计算/83_stock_kline_30m.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL聚合

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| trade_time | TIMESTAMP | 交易时间 |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |

### 084 stock_kline_60m
- **中文**: 股票60分钟K线
- **脚本**: `2_计算/84_stock_kline_60m.py`
- **schedule**: daily | **mode**: increment
- **数据源**: SQL聚合

| 字段 | 类型 | 中文 | 备注 |
|------|------|------|------|
| code | VARCHAR | 证券代码 |  |
| trade_time | TIMESTAMP | 交易时间 |  |
| open | DOUBLE | 今开 |  |
| high | DOUBLE | 最高 |  |
| low | DOUBLE | 最低 |  |
| close | DOUBLE | 收盘价 |  |
| volume | BIGINT | 成交量 |  |
| amount | DOUBLE | 成交额 |  |
