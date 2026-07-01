#!/usr/bin/env python3
"""tes_027_formula_ztg — 验客户端公式 ZTG 拿全市场情绪
    1 次 formula_process_mul_zb 拿 TOTALHQINFO(1~4) + DYNAINFO(60/61/22/23)
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
TEST_STOCK = '999999.SH'  # 上证指数


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] {str(rc)[:80]}")
    except Exception as e:
        print(f"refresh_cache 失败: {e}")

    banner("step1: formula_process_mul_zb 炸板连板 on 上证指数")
    t0 = time.time()
    try:
        res = tq.formula_process_mul_zb(
            formula_name='炸板连板',
            formula_arg='',  # 客户端已建,这里不传源码
            return_count=1,
            return_date=True,
            stock_list=[TEST_STOCK],
            stock_period='1d',
            start_time='20260701',
            end_time='20260701',
            count=1,
            dividend_type=0,
        )
        print(f"  耗时 {time.time()-t0:.2f}s")
        print(f"  顶层 type={type(res).__name__}")
        if isinstance(res, dict):
            print(f"  顶层 keys={list(res.keys())[:8]}")
            for k, v in res.items():
                if k == 'ErrorId':
                    print(f"  ErrorId={v}")
                    continue
                if isinstance(v, dict):
                    print(f"  [{k}]:")
                    for kk, vv in v.items():
                        if isinstance(vv, list) and vv:
                            print(f"    {kk}: list[len={len(vv)}] first={vv[0]!r}")
                        else:
                            print(f"    {kk}: {vv!r}")
                else:
                    print(f"  [{k}]: {v!r}")
        else:
            print(f"  返回: {res!r}")
    except Exception as e:
        print(f"  异常: {e}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())