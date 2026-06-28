# DataOps 管理台 — 真实数据同步报告

> 生成时间: 2026-06-28  
> 来源: config/tables.json + config/data_dictionary.json + 脚本行数统计  
> 目标: Next.js DataOps 管理台 mock-data.ts 对齐

## 一、仓库元数据概览

| 维度 | 数量 |
|------|------|
| 注册表数 (tables.json) | 33 |
| 字典表数 (data_dictionary.json) | 34 |
| 活跃入库脚本 (1_入库/) | 14 |
| 活跃计算脚本 (2_计算/) | 10 |
| 废弃脚本 | 16 |
| 视图 (_labeled) | 3 |
| 维度表 (dim_) | 4 |
| 总脚本行数 | 3,813 |

## 二、表分类统计

### 按目录
| 目录 | 活跃表数 | 脚本行数 |
|------|---------|---------|
| 1_入库 | 14 | 2,734 |
| 2_计算 | 10 | 1,079 |
| 视图(无脚本) | 3 | 0 |

### 按调度
| schedule | 表数 |
|----------|------|
| daily | 24 |
| weekly | 3 |
| monthly | 1 |
| once | 2 |
| intraday | 1 |
| 空(视图) | 3 |

### 按入库模式
| mode | 表数 |
|------|------|
| increment | 24 |
| full | 8 |
| 空(视图) | 3 |

### 按数据源
| source | 表数 |
|--------|------|
| 二进制(TDX) | 7 |
| API(TQ) | 6 |
| SQL派生/聚合 | 8 |
| pianpao_engine | 6 |
| 文档 | 2 |
| 文本(T0002) | 1 |
| 视图(SQL派生) | 3 |

## 三、中文列名违规 (Lint R004)

以下 8 张表存在中文列名，不符合 R004 规范：

| 表名 | 中文列名示例 |
|------|-------------|
| stock_daily_kline | 涨跌幅, 换手率, 前复权因子 |
| t_bk5_19 | bk_name, pe_ttm, pb_mrq... |
| stock_industry_3level | 行业一级代码, 行业一级名称, 行业二级代码... |
| market_sc1_42 | 融资融券_融资余额, 陆股通资金流入_沪股通流入... (76列) |
| stock_block_relation | 板块代码, 板块名称, 板块类型, 成分股数 |
| stock_kline_weekly | 涨跌幅, 换手率 |
| stock_kline_monthly | 涨跌幅, 换手率 |
| dim_industry_code | 名称, 级别, 行业一级代码... |

## 四、sort 编号冲突 (Lint R005)

| sort | 重复表 |
|------|--------|
| 070 | pianpao_daily, pianpao_daily_summary, pianpao_intraday, pianpao_intraday_events, pianpao_intraday_periods, pianpao_trap_stats (6表) |
| 036 | dim_industry_code, t_bk5_19_industry_labeled, stock_block_relation_industry_labeled (3表) |
| 093 | stock_gp1_46_indicators, stock_gp1_46_indicators_labeled (2表) |

## 五、DataOps 管理台同步状态

| 项目 | 状态 |
|------|------|
| 表清单 (34→34) | ✅ 已对齐 |
| 字段定义 | ✅ 从 data_dictionary.json 同步 |
| 脚本行数 | ✅ 从实际脚本 wc -l 统计 |
| 依赖关系 | ✅ 从 source_detail 解析 |
| 数据量/行数 | ⚠️ 估算值，需 run.py scan 实际数据 |
| 健康度/红绿 | ⚠️ 估算值，需 run.py scan 实际数据 |
| maxDate | ⚠️ 估算值，需 run.py check 实际数据 |
