# tes/ — TQ Center API 脚本集

> TQ(tqcenter) 客户端 API 探索 + 实用脚本。
> 真实路径 `K:\txdlianghua\PYPlugins\user\tqcenter.py`(文章里的 `C:/new_tdx_test2025` 不存在,别照抄)。

## 跑法

```bash
python tes/tes_011_zlje.py --abs --limit 200 --top 20   # 主力净额盘后选股(最常用)
python tes/tes_000_all.py                                # TQ 连通性体检
python tes/tes_012_subscribe_warn.py                     # 实时预警(长驻,Ctrl+C)
```

## 根目录脚本

### ⭐ 核心
| 脚本 | 作用 |
|------|------|
| tes_011_zlje.py | **主力净额(ZLJE)盘后选股**(`--abs`排序/盘中差额),纯选股不下单 |
| tes_012_subscribe_warn.py | 订阅行情+涨幅突破实时预警(长驻,含防抖/批量订阅/DRY_RUN) |
| tes_000_all.py | 顺序跑根目录探针,TQ 连通性体检 |

### 🔧 参考(查 API 签名 / 返回结构)
| 脚本 | 作用 |
|------|------|
| tes_003_market_data.py | get_market_data K线(返回 `{字段:DataFrame}`) |
| tes_004_indicator.py | formula_process_mul_zb 指标公式(ZLMM 等内置可用) |
| tes_007_financial.py | get_financial_data / 股本 / get_more_info 88字段 |
| tes_008_gpjy.py | 估值 / 板块 / 市场宏观指标 |
| tes_009_order.py | order_stock 下单签名 **dry-run**(⚠️别去掉 dry-run) |

### tes_013_zjl.py
Zjl 盘中实时选股。⚠️ **盘后归零**,盘后场景必须用 tes_011。详见 memory `zlje-vs-zjl-capital-flow`。

## archive/ — 已归档探针(TQ API 字典)

早期单接口探针,使命已完成(结论入 memory `tqcenter-api-signatures`),保留作 TQ API 字典:

| 归档脚本 | 探的 API |
|---|---|
| tes_001_init.py | initialize / 列 tq 公共方法 |
| tes_002_stock_list.py | get_stock_list / get_stock_info / get_sector_list |
| tes_005_account.py | stock_account / asset / positions / orders(本机未登录返-1) |
| tes_006_calendar.py | get_trading_calendar / get_trading_dates |
| tes_010_misc.py | 模糊搜股 / 跟踪ETF / 板块内股票 / 公式元信息 |
| tes_014_verify.py | 异常票全字段+K线核对(定位"L2历史只存近期") |

单跑:`python tes/archive/tes_001_init.py`

## tes_011 跑之前必读

`ZLJE` 非通达信内置公式,必须先在客户端 `Ctrl+F` 手动建,步骤见
[ZLJE公式安装说明.md](ZLJE公式安装说明.md)。需 Level-2 数据权限(专业研究版 V7.73+)。

## 已知要点(实测)

- **强制刷新**:`tq.refresh_cache(market='AG', force=True)`(非 `refresh_cache(true)`)
- **签名坑**:大量用 `start_time` 非 `start_date`;`get_more_info` 单股不收 `stock_list`;
  `formula_process_mul_zb` 返回 `{code:{指标名:[{Date,Value}]}}`。详见 memory `tqcenter-api-signatures`
- **主力净额**:盘后用 ZLJE(不归零,但 L2 只存近 1-2 月);盘中可用 Zjl(盘后归零)。
  详见 memory `zlje-vs-zjl-capital-flow`
- ZLMM 内置可用,ZLJE 需自建,MACD/KDJ/BOLL 用 `formula_process_mul_zb` 返回空(公式名/类型待查)
