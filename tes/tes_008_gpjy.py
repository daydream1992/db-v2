#!/usr/bin/env python3
"""tes_008_gpjy — 估值/技术指标截面
    用途:get_gpjy_value / get_gpjy_value_by_date / get_bkjy_value / get_scjy_value
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
SAMPLE_CODES = ['600519.SH', '000001.SZ', '300750.SZ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def show(label: str, df) -> None:
    print(f"[{label}] type={type(df).__name__}")
    if hasattr(df, 'shape'):
        print(f"  shape={df.shape}")
        if not df.empty:
            print(f"  columns={list(df.columns)}")
            print(df.head(2).to_string())
    elif isinstance(df, dict):
        print(f"  keys={list(df.keys())[:15]}")
        first = next(iter(df.keys()), None)
        if first:
            v = df[first]
            print(f"  {first} -> {v!r}")
    else:
        print(f"  {df!r}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("get_gpjy_value_by_date 截面估值")
    # 强制刷新行情缓存
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        df = tq.get_gpjy_value_by_date(stock_list=SAMPLE_CODES, date='20240614')
        show("gpjy_by_date", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_gpjy_value 区间")
    try:
        df = tq.get_gpjy_value(stock_list=SAMPLE_CODES, start_date='20240601', end_date='20240614')
        show("gpjy_range", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_bkjy_value 板块指标")
    try:
        df = tq.get_bkjy_value(stock_list=['881101'], start_date='20240601', end_date='20240614')
        show("bkjy", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_scjy_value 市场宏观")
    try:
        df = tq.get_scjy_value(start_date='20240601', end_date='20240614')
        show("scjy", df)
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