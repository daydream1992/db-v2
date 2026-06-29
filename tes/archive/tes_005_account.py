#!/usr/bin/env python3
"""tes_005_account — 账户/持仓/委托查询(只读)
    用途:看账户列表、资产、持仓、委托的返回结构。不会触发下单。
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def show(label: str, obj) -> None:
    print(f"[{label}] type={type(obj).__name__}")
    if isinstance(obj, dict):
        print(f"  keys={list(obj.keys())[:15]}")
        for k in list(obj.keys())[:5]:
            print(f"  {k} = {obj[k]!r}")
    elif isinstance(obj, list):
        print(f"  length={len(obj)}")
        for x in obj[:3]:
            print(f"  - {x!r}")
    else:
        print(f"  {obj!r}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    # 账户/资产数据不强依赖缓存,这里跳过 refresh_cache

    banner("stock_account 列出账户")
    # 不传参,看是否返回所有账户
    try:
        accts = tq.stock_account()
        show("stock_account()", accts)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("query_stock_asset 账户资产")
    try:
        asset = tq.query_stock_asset()
        show("query_stock_asset()", asset)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("query_stock_positions 持仓")
    try:
        pos = tq.query_stock_positions()
        show("query_stock_positions()", pos)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("query_stock_orders 当日委托")
    try:
        orders = tq.query_stock_orders()
        show("query_stock_orders()", orders)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("done")
    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())