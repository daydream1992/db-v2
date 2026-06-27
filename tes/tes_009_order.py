#!/usr/bin/env python3
"""tes_009_order — 下单接口签名演练(DRY-RUN,绝不真实下单)
    用途:把 order_stock / cancel_order_stock 需要的入参 + tqconst 常量
         全部列清楚;真正下单时手填即可。

    注意:本脚本只导入符号 + 构造 JSON payload,不调用 tq.order_stock。
"""
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq, tqconst  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def main() -> int:
    banner("initialize(不连交易)")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("tqconst 下单方向 / 价格方式 / 委托状态")
    consts = {
        "STOCK_BUY": tqconst.STOCK_BUY,
        "STOCK_SELL": tqconst.STOCK_SELL,
        "CREDIT_BUY": tqconst.CREDIT_BUY,
        "CREDIT_FIN_BUY": tqconst.CREDIT_FIN_BUY,
        "CREDIT_SLO_SELL": tqconst.CREDIT_SLO_SELL,
        "CREDIT_COV_BUY": tqconst.CREDIT_COV_BUY,
        "CREDIT_STK_REPAY": tqconst.CREDIT_STK_REPAY,
        "ETF_PURCHASE": tqconst.ETF_PURCHASE,
        "ETF_REDEMPTION": tqconst.ETF_REDEMPTION,
        "PRICE_MY": tqconst.PRICE_MY,
        "PRICE_SJ": tqconst.PRICE_SJ,
        "PRICE_ZTJ": tqconst.PRICE_ZTJ,
        "PRICE_DTJ": tqconst.PRICE_DTJ,
        "WTSTATUS_NOCJ": tqconst.WTSTATUS_NOCJ,
        "WTSTATUS_PARTCJ": tqconst.WTSTATUS_PARTCJ,
        "WTSTATUS_ALLCJ": tqconst.WTSTATUS_ALLCJ,
    }
    for k, v in consts.items():
        print(f"  tqconst.{k:<18} = {v}")

    banner("构造 order_stock 入参示例(DRY-RUN,不会发出)")
    # 列出账户 ID(只读)
    try:
        accts = tq.stock_account()
        if isinstance(accts, list) and accts:
            sample_account = accts[0] if not isinstance(accts[0], dict) else accts[0].get('account_id', -1)
        elif isinstance(accts, dict):
            sample_account = accts.get('account_id', -1)
        else:
            sample_account = -1
    except Exception as e:  # noqa: BLE001
        print(f"stock_account 失败(可忽略): {e}")
        sample_account = -1

    samples = [
        {
            "name": "市价买入 100 股 600000.SH",
            "payload": {
                "account_id": sample_account,
                "stock_code": "600000.SH",
                "order_type": tqconst.STOCK_BUY,
                "order_volume": 100,
                "price_type": tqconst.PRICE_SJ,
                "price": 0.0,
            },
        },
        {
            "name": "限价买入 200 股 600000.SH @ 10.50",
            "payload": {
                "account_id": sample_account,
                "stock_code": "600000.SH",
                "order_type": tqconst.STOCK_BUY,
                "order_volume": 200,
                "price_type": tqconst.PRICE_MY,
                "price": 10.50,
            },
        },
        {
            "name": "涨停价卖出 300 股 600000.SH",
            "payload": {
                "account_id": sample_account,
                "stock_code": "600000.SH",
                "order_type": tqconst.STOCK_SELL,
                "order_volume": 300,
                "price_type": tqconst.PRICE_ZTJ,
                "price": 0.0,
            },
        },
    ]
    for s in samples:
        print(f"--- {s['name']} ---")
        print(json.dumps(s['payload'], ensure_ascii=False, indent=2))
        # 真实下单取消下一行注释:
        # tq.order_stock(**s['payload'])

    banner("cancel_order_stock 入参示例(DRY-RUN)")
    print("  cancel_order_stock 需要:account_id + entrust_no(原委托号)")
    print("  示例:")
    print("    tq.cancel_order_stock(account_id=%d, entrust_no='12345')" % sample_account)

    banner("done")
    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())