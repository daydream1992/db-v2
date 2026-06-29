#!/usr/bin/env python3
"""tes_006_calendar — 交易日历
    用途:看交易日历 API 的返回结构 + 一段区间能拿到几个交易日。
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("get_trading_calendar")
    # 强制刷新行情缓存
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        cal = tq.get_trading_calendar(market='SH')
        print(f"[calendar SH] type={type(cal).__name__}")
        if isinstance(cal, list):
            print(f"  length={len(cal)}")
            print(f"  first 3: {cal[:3]}")
            print(f"  last 3:  {cal[-3:]}")
        elif isinstance(cal, dict):
            print(f"  keys={list(cal.keys())[:10]}")
        else:
            print(f"  {cal!r}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_trading_dates 区间 20240101-20240131")
    try:
        ds = tq.get_trading_dates(
            market='SH',
            start_date='20240101',
            end_date='20240131',
        )
        print(f"[trading_dates] type={type(ds).__name__}")
        if isinstance(ds, list):
            print(f"  length={len(ds)}")
            print(f"  first 5: {ds[:5]}")
            print(f"  last 3:  {ds[-3:]}")
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