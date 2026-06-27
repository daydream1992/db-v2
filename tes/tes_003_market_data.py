#!/usr/bin/env python3
"""tes_003_market_data — get_market_data K线 + get_market_snapshot 快照
    用途:看 K 线/分时/盘口 三类行情的返回结构。
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
SAMPLE_CODES = ['300911.SZ', '600635.SH', '000890.SZ', '603155.SZ', '301448.SZ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def show_kline(label: str, df) -> None:
    print(f"[{label}] type={type(df).__name__}")
    if hasattr(df, 'shape'):
        print(f"  shape={df.shape}")
        if not df.empty:
            print(f"  columns={list(df.columns)}")
            print(df.head(3).to_string())
    elif isinstance(df, dict):
        print(f"  keys={list(df.keys())[:10]}")
        for k, v in list(df.items())[:3]:
            print(f"  {k} -> {v!r}")
    else:
        print(f"  {df!r}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("get_market_data 日K 5 只")
    # 强制刷新行情缓存(全市场 AG)
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        df = tq.get_market_data(
            stock_list=SAMPLE_CODES,
            period='1d',
            start_time='20240601',
            end_time='20240630',
            dividend_type=1,  # 前复权
        )
        show_kline("日K", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_market_data 5分K 1 只")
    try:
        df = tq.get_market_data(
            stock_list=['600635.SH'],
            period='5m',
            start_time='20240603',
            end_time='20240607',
            dividend_type=1,
        )
        show_kline("5分K", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_market_snapshot 当前快照")
    try:
        snap = tq.get_market_snapshot(stock_list=SAMPLE_CODES)
        print(f"[snapshot] type={type(snap).__name__}")
        if hasattr(snap, 'shape'):
            print(f"  shape={snap.shape}")
            if not snap.empty:
                print(f"  columns={list(snap.columns)}")
                print(snap.head(3).to_string())
        elif isinstance(snap, dict):
            for k, v in list(snap.items())[:2]:
                print(f"  {k} -> {v!r}")
        else:
            print(f"  {snap!r}")
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