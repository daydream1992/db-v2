#!/usr/bin/env python3
"""tes_004_indicator — formula_process_mul_zb 批量指标
    用途:看 ZLJE 主力净额 / 其它常见指标(ZLMM 主力买卖/MACD/KDJ) 的返回结构。
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


def probe(formula_name: str, formula_arg: str = '') -> None:
    print(f"--- formula={formula_name} arg='{formula_arg}' ---")
    try:
        res = tq.formula_process_mul_zb(
            formula_name=formula_name,
            formula_arg=formula_arg,
            return_count=2,
            return_date=True,
            xsflag=6,
            stock_list=SAMPLE_CODES,
            stock_period='1d',
            start_time='20240601',
            end_time='20240630',
            dividend_type=1,
        )
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return

    if not res:
        print("(空返回)")
        return

    print(f"[{formula_name}] 顶层 type={type(res).__name__}")
    if isinstance(res, dict):
        print(f"  顶层 keys={list(res.keys())[:8]}")
        first_code = next((k for k in res if k != 'ErrorId'), None)
        if first_code and isinstance(res[first_code], dict):
            print(f"  示例 {first_code}:")
            for k, v in res[first_code].items():
                if isinstance(v, list) and v:
                    print(f"    {k}: list[len={len(v)}] first={v[0]!r}")
                else:
                    print(f"    {k}: {type(v).__name__} = {v!r}")
        if 'ErrorId' in res:
            print(f"  ErrorId={res['ErrorId']}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    # 用户示例里的核心:ZLJE 主力净额
    # 先强制刷新行情缓存
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    probe('ZLJE')
    # 主力买卖
    probe('ZLMM')
    # MACD(参数需要填,否则可能拒参)
    probe('MACD', 'SHORT=12,LONG=26,MID=9')
    # KDJ
    probe('KDJ', 'N=9,M1=3,M2=3')
    # BOLL
    probe('BOLL', 'N=20')

    banner("done")
    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())