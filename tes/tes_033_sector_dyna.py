#!/usr/bin/env python3
"""tes_033_sector_dyna — 验 DYNAINFO(18/19/22/23) 在板块指数上是否返真值
    依赖客户端已建公式 BK_SENTIMENT (源码见本对话)
    在多个板块指数(880301 煤炭 等)上 1 次调用拿实时 涨/跌/涨停/跌停
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
# 候选板块指数(从 get_sector_list 前 5 个 + 煤炭 880301)
TEST_SECTORS = ['880301.SH', '880081.SH', '880082.SH', '880201.SH', '880202.SH']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}"); return 1
    try:
        tq.refresh_cache(market='AG', force=True)
    except Exception:
        pass

    banner("step1: formula_process_mul_zb BK_SENTIMENT on 5 板块指数")
    t0 = time.time()
    res = tq.formula_process_mul_zb(
        formula_name='BK_SENTIMENT',
        formula_arg='',
        return_count=1, return_date=True,
        stock_list=TEST_SECTORS,
        stock_period='1d',
        start_time='20260701', end_time='20260701', count=1, dividend_type=0,
    )
    print(f"  耗时 {time.time()-t0:.2f}s  ErrorId={res.get('ErrorId')}")
    for code in TEST_SECTORS:
        blk = res.get(code, {})
        if not isinstance(blk, dict):
            print(f"  [{code}]: {blk!r}")
            continue
        out = {}
        for k, v in blk.items():
            if isinstance(v, list) and v:
                val = v[-1].get('Value')
                if val is not None:
                    out[k] = val
        print(f"  [{code}]: {out}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())