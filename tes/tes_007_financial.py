#!/usr/bin/env python3
"""tes_007_financial — 财务 / 股本
    用途:get_financial_data / get_financial_data_by_date / get_gb_info_by_date
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


def show_df(label: str, df) -> None:
    print(f"[{label}] type={type(df).__name__}")
    if hasattr(df, 'shape'):
        print(f"  shape={df.shape}")
        if not df.empty:
            print(f"  columns={list(df.columns)}")
            print(df.head(2).to_string())
    elif isinstance(df, dict):
        print(f"  keys={list(df.keys())[:15]}")
    else:
        print(f"  {df!r}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("get_financial_data 财务数据")
    # 强制刷新行情缓存
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        df = tq.get_financial_data(stock_list=SAMPLE_CODES, start_time='20230101', end_time='20231231')
        show_df("financial", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_financial_data_by_date 截面")
    try:
        df = tq.get_financial_data_by_date(stock_list=SAMPLE_CODES, date='20231231')
        show_df("financial_by_date", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_gb_info_by_date 股本")
    try:
        df = tq.get_gb_info_by_date(
            stock_list=SAMPLE_CODES,
            start_date='20230101',
            end_date='20231231',
        )
        show_df("gb_info", df)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_more_info 综合资料")
    try:
        df = tq.get_more_info(stock_list=SAMPLE_CODES)
        show_df("more_info", df)
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