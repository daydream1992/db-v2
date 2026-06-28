# tes/ — TQ Center API 探针脚本集

> 临时探索用:看 `K:\txdlianghua\PYPlugins\user\tqcenter.py` 里 tq 客户端能干啥。
> 跑完一次就明确每个 API 的返回结构,后续真正业务写起来不用再翻源码。
> **tes_009 / tes_011 都不做真实下单。**

## 跑法

```bash
# 单跑一个
python K:/DB数据库_v2/tes/tes_001_init.py

# 全部探针顺序跑一遍
python K:/DB数据库_v2/tes/tes_000_all.py

# 主力净额选股(需先建 ZLJE 公式,见下)
python K:/DB数据库_v2/tes/tes_011_zlje.py --codes 600519.SH,000001.SZ --rounds 2 --interval 5
```

## 索引

| 脚本 | 探索的 API | 是否连 TQ |
|------|-----------|----------|
| tes_001_init.py | initialize / 列出 tq 公共方法 | 是 |
| tes_002_stock_list.py | get_stock_list / get_stock_info / get_sector_list / get_user_sector | 是 |
| tes_003_market_data.py | get_market_data (K线) / get_market_snapshot (快照) | 是 |
| tes_004_indicator.py | formula_process_mul_zb (ZLJE/ZLMM/MACD/KDJ/BOLL) | 是 |
| tes_005_account.py | stock_account / query_stock_asset / positions / orders (只读) | 是 |
| tes_006_calendar.py | get_trading_calendar / get_trading_dates | 是 |
| tes_007_financial.py | get_financial_data / _by_date / get_gb_info_by_date / get_more_info | 是 |
| tes_008_gpjy.py | get_gpjy_value / get_bkjy_value / get_scjy_value | 是 |
| tes_009_order.py | order_stock / cancel_order_stock 入参 + tqconst 常量 | **dry-run** |
| tes_010_misc.py | 板块内股票 / 公式元信息 / 模糊搜股 / 跟踪 ETF | 是 |
| tes_011_zlje.py | **主力净额(ZLJE)变化选股**(纯选股,不下单) | 是 |
| tes_012_subscribe_warn.py | subscribe_hq 订阅回调 / get_market_snapshot 取价 / send_warn 预警(DRY_RUN 默认不实推) | **长驻,Ctrl+C** |
| tes_000_all.py | 顺序跑 001-010 并汇总(不含 011/012 长驻脚本) | 是 |

## tes_011 跑之前必读

`ZLJE` 不是通达信内置公式,必须**先在客户端公式管理器手动建好**(快捷键 Ctrl+F),
源码和步骤见 [ZLJE公式安装说明.md](ZLJE公式安装说明.md)。
否则报 `获取公式失败或公式不存在`。且需要 Level-2 数据权限(专业研究版 V7.73+)。

## 已知要点(实测)

- **tqcenter 真实路径**:`K:\txdlianghua\PYPlugins\user\tqcenter.py`
  - 微信文章里的 `C:/new_tdx_test2025/...` 是作者电脑的路径,**不能照抄**
  - 旧文档 `I:/new_tdx_mock` 同样废弃
- 调用前必须 `tq.initialize(__file__)`,结束时 `tq.close()`
- **强制刷新缓存**:`tq.refresh_cache(market='AG', force=True)` —— 签名是关键字参数,
  不是 `tq.refresh_cache(true)`(那个会 NameError)
- `tqconst` 用 metaclass 锁死,改常量直接 `AttributeError`
- `order_stock` 默认 `account_id=-1` 会拒,需先 `tq.stock_account()` 拿 ID(本机未登录交易,返 -1)
- `formula_process_mul_zb` 一次批量执行,返回 dict[code, dict[name, list[dict]]]
- **参数名陷阱**:TQ 大量用 `start_time/end_time`,不是 `start_date`;
  `get_more_info` / `get_gb_info_by_date` 不收 `stock_list`;
  `get_trading_calendar` 必传 `start_time+end_time`(具体见各脚本 FAIL 记录)
- **ZLJE 是自定义公式**不是内置,需手动建;ZLMM/MML/MMM/MMS 是内置可用
