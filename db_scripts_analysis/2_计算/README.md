# 2_计算

| 编号 | 脚本 | 中文名 | 来源 | 周期 | 模式 |
|------|------|--------|------|------|------|
| 001 | 001_dim_security_type_sync.py | 证券类型维表 | SQL派生 | 一次性 | full |
| 11 | 11_stock_extended_info.py | 股票扩展信息 | SQL派生 | 每日盘后 | increment |
| 17 | 17_stock_kline_weekly.py | 股票周K线 | SQL聚合 | 每周 | full |
| 18 | 18_stock_kline_monthly.py | 股票月K线 | SQL聚合 | 每月 | full |
| 55 | 55_etf_derived_indicator.py | ETF衍生指标 | SQL派生 | 每日盘后 | increment |

## ⚠️ 已移除
- 37_sector_kline_60m.py — 源表 sector_kline_5m 不存在
- 43_index_kline_60m.py — 源表 index_kline_5m 不存在
- 54_etf_kline_60m.py — 源表 etf_kline_5m 不存在
- 56_etf_share_scale.py — 未实现
