---
name: kline-table-schema
description: K线表结构：股票/指数/ETF/板块的列名差异
metadata:
  type: project
---

# K线表架构总结

## 聚合脚本结构

### 2_计算/K线聚合
| 脚本 | 聚合内容 |
|------|----------|
| 17_stock_kline_weekly.py | 股票周K线 |
| 18_stock_kline_monthly.py | 股票月K线 |
| **38_stock_kline_aggregate.py** | 股票15m/30m/60m **（打包在一起）** |
| 37_sector_kline_60m.py | 板块 60m |
| 43_index_kline_60m.py | 指数 60m |
| 54_etf_kline_60m.py | ETF 60m |

### 关键模式
- 38 脚本聚合 15m/30m/60m 三种周期
- 依赖源表：stock_kline_5m / sector_kline_5m / index_kline_5m / etf_kline_5m
- 板块的 sector_kline_5m **源表不存在**，60m 聚合会失败

## 日K线表结构对比

| 字段 | 股票 | 指数 | ETF | 板块 |
|------|------|------|-----|------|
| code | ✅ | ✅ | ✅ | ✅ |
| date | ✅ | ✅ | ✅ | ✅ |
| open/high/low/close | ✅ | ✅ | ✅ | ✅ |
| volume | BIGINT | BIGINT | BIGINT | DOUBLE |
| amount | ✅ | ✅ | ✅ | ✅ |
| change_pct | ✅ | ✅ | ✅ | ✅ |
| turnover | ✅ | ❌ | ❌ | ❌ |
| forward_factor | ✅ | ❌ | ❌ | ❌ |

## 差异原因
- 股票独有 `turnover`（换手率）、`forward_factor`（前复权因子）— 股票需要复权计算
- 板块 `volume` 是 DOUBLE，其他是 BIGINT — 待确认是否合理

## 分钟K线
- 股票：stock_kline_1m/5m/15m/30m/60m（5个周期）
- 指数：index_kline_1m/5m/60m
- ETF：etf_kline_1m/5m/60m
- 板块：只有60m（sector_kline_60m），**5m源表不存在**

## 来源
- 数据源：通达信 `.day` 文件
- 通过 tdx_reader.read_daily() / read_1min_parallel() / read_5min_parallel() 读取
- 不同类型通过代码过滤：股票（全量）、指数（指定INDEX_CODES）、ETF（指定前缀）、板块（待探查）

## ⚠️ 踩坑记录
- 2026-06-09：memory 初始版本写错了板块K线
- 2026-06-09：忽略 2_计算/38_stock_kline_aggregate.py，没发现它打包了多种周期聚合
- 2026-06-09：板块/指数/ETF 的 K线聚合脚本已清理（37/43/54/56），源表缺失

## 当前 K线架构

### 1_入库/ — 入库脚本
| 脚本 | 表 | 状态 |
|------|------|------|
| 10_stock_daily_kline.py | stock_daily_kline | ✅ |
| 080_stock_kline_1m.py | stock_kline_1m | ✅ |
| 081_stock_kline_5m.py | stock_kline_5m | ✅ |

### 2_计算/ — 聚合脚本
| 脚本 | 表 | 状态 |
|------|------|------|
| 17_stock_kline_weekly.py | stock_kline_weekly | ✅ |
| 18_stock_kline_monthly.py | stock_kline_monthly | ✅ |
| 55_etf_derived_indicator.py | etf_derived_indicator | ✅ |
| 82_stock_kline_15m.py | stock_kline_15m | ✅ (聚合) |
| 83_stock_kline_30m.py | stock_kline_30m | ✅ (聚合) |
| 84_stock_kline_60m.py | stock_kline_60m | ✅ (聚合) |

### ⚠️ 已移除（源表缺失）
- 37_sector_kline_60m.py — 源表 sector_kline_5m 不存在
- 43_index_kline_60m.py — 源表 index_kline_5m 不存在
- 54_etf_kline_60m.py — 源表 etf_kline_5m 不存在
- 56_etf_share_scale.py — 未实现

**Why:** 避免重复核实表结构，每次都要读脚本
**How to apply:** 问K线架构时直接查此 memory，但必须先核实 2_计算/ 目录