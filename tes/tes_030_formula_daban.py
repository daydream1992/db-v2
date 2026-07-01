#!/usr/bin/env python3
"""tes_030_formula_daban — 测 '打板资金' 公式(client 端可能没建)
    重点:TQ 公式网关能否翻译 SCJYVALUE / GPJYVALUE / FINANCE
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


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

    banner("step1: formula_process_mul_zb 打板资金 on 单只股 600635.SH")
    t0 = time.time()
    try:
        res = tq.formula_process_mul_zb(
            formula_name='打板资金',
            formula_arg='',
            return_count=1,
            return_date=True,
            stock_list=['600635.SH'],
            stock_period='1d',
            start_time='20260701',
            end_time='20260701',
            count=20,
            dividend_type=0,
        )
        print(f"  耗时 {time.time()-t0:.2f}s")
        print(f"  顶层 type={type(res).__name__}")
        if isinstance(res, dict):
            print(f"  顶层 keys={list(res.keys())[:8]}")
            if 'ErrorId' in res:
                print(f"  ErrorId={res['ErrorId']}")
            for k, v in res.items():
                if k == 'ErrorId':
                    continue
                if isinstance(v, dict):
                    print(f"  [{k}]:")
                    for kk, vv in v.items():
                        if isinstance(vv, list) and vv:
                            print(f"    {kk}: list[len={len(vv)}] first={vv[0]!r} last={vv[-1]!r}")
                        else:
                            print(f"    {kk}: {vv!r}")
                else:
                    print(f"  [{k}]: {v!r}")
        else:
            print(f"  返回: {res!r}")
    except Exception as e:
        print(f"  异常: {e}")

    banner("step2: formula_zb 单股 600635.SH")
    t0 = time.time()
    try:
        # 先设数据
        tq.formula_set_data_info(
            stock_code='600635.SH',
            stock_period='1d',
            start_time='20260701',
            end_time='20260701',
            count=20,
            dividend_type=0,
        )
        res = tq.formula_zb(formula_name='打板资金', formula_arg='', xsflag=2)
        print(f"  耗时 {time.time()-t0:.2f}s")
        print(f"  返回: {res!r}")
    except Exception as e:
        print(f"  异常: {e}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())