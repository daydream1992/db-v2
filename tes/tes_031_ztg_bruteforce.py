#!/usr/bin/env python3
"""tes_031_ztg_bruteforce — 改 ZTG 公式,加 TOTALHQINFO(1~20) 暴力扫
    公式:在客户端 GUI 把 ZTG 公式源码改成下面这段,保存:
        公式名: ZTG
        源码:
        UP_CNT: TOTALHQINFO(1);
        DOWN_CNT: TOTALHQINFO(2);
        ZT_CNT: TOTALHQINFO(3);
        DT_CNT: TOTALHQINFO(4);
        T5: TOTALHQINFO(5);
        T6: TOTALHQINFO(6);
        T7: TOTALHQINFO(7);
        T8: TOTALHQINFO(8);
        T9: TOTALHQINFO(9);
        T10: TOTALHQINFO(10);
        T11: TOTALHQINFO(11);
        T12: TOTALHQINFO(12);
        T13: TOTALHQINFO(13);
        T14: TOTALHQINFO(14);
        T15: TOTALHQINFO(15);
        T16: TOTALHQINFO(16);
        T17: TOTALHQINFO(17);
        T18: TOTALHQINFO(18);
        T19: TOTALHQINFO(19);
        T20: TOTALHQINFO(20);
        UP_CNT;
        DOWN_CNT;
        ZT_CNT;
        DT_CNT;
        T5; T6; T7; T8; T9; T10; T11; T12; T13; T14; T15; T16; T17; T18; T19; T20;
    然后跑本探针,看每个 T5~T20 的真实值,反推"连板/炸板"是哪个
"""
from __future__ import annotations
import sys
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

    banner("step1: formula_process_mul_zb ZTG (新版含 1~20) on 999999.SH")
    res = tq.formula_process_mul_zb(
        formula_name='ZTG',
        formula_arg='',
        return_count=1,
        return_date=True,
        stock_list=['999999.SH'],
        stock_period='1d',
        start_time='20260701',
        end_time='20260701',
        count=1,
        dividend_type=0,
    )
    print(f"  顶层 keys={list(res.keys())[:5] if isinstance(res, dict) else type(res)}")
    if 'ErrorId' in res:
        print(f"  ErrorId={res['ErrorId']}")
    if '999999.SH' in res:
        blk = res['999999.SH']
        if isinstance(blk, dict):
            for k, v in blk.items():
                if isinstance(v, list) and v:
                    print(f"  {k}: last={v[-1]!r}")
                else:
                    print(f"  {k}: {v!r}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())