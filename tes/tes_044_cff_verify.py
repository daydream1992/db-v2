#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tes_044_cff_verify — 锁定期指真伪
    tes_043 发现 IF300.CFF snapshot.Now == 000300.SH 现 指(基差0),疑似 .CFF
    回退现指而非真期价。本探针做铁证:
      1. 当月/次月合约代码(IF2607/IF2608.CFF)snapshot.Now + more_info 非空数
      2. get_market_data(IF300.CFF, period='1d', count=3) 日K Close(看 K 线接口是否接真期货行情)
      3. IH/IC 现指 vs .CFF 对比:000016↔IH50 / 000905↔IC500(若全等=现指别名)
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

CONTRACTS = ['IF2607.CFF', 'IF2608.CFF', 'IF2606.CFF', 'IF2506.CFF']
PAIRS = [('IH50.CFF', '000016.SH'), ('IC500.CFF', '000905.SH'), ('IM1000.CFF', '000852.SH')]


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def snap_now(code: str) -> float | None:
    try:
        s = tq.get_market_snapshot(stock_code=code, field_list=[])
        v = s.get('Now')
        return float(v) if v not in (None, '', 'None') else None
    except Exception as e:
        print(f"  [{code}] snap FAIL: {e}")
        return None


def more_cnt(code: str) -> int:
    try:
        info = tq.get_more_info(stock_code=code, field_list=[])
        return sum(1 for k, v in info.items()
                   if k != 'ErrorId' and str(v).strip() not in ('', '0', '0.00', 'None'))
    except Exception:
        return -1


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(os.path.abspath(__file__))
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1
    try:
        tq.refresh_cache(market='AG', force=True)
    except Exception:
        pass

    banner("step1: 当月/次月合约代码 snapshot.Now + 非空数")
    for c in CONTRACTS:
        print(f"  [{c}] Now={snap_now(c)!r}  非空={more_cnt(c)}")

    banner("step2: get_market_data(IF300.CFF, '1d', count=3) 日K Close")
    try:
        dm = tq.get_market_data(stock_list=['IF300.CFF'], period='1d', count=3)
        print(f"  type={type(dm).__name__}")
        if isinstance(dm, dict):
            print(f"  keys={list(dm.keys())}")
            close = dm.get('Close') or dm.get('close')
            print(f"  Close:\n{close}")
        else:
            print(f"  {dm!r}")
    except Exception as e:
        print(f"  FAIL: {e}")

    banner("step3: IH/IC/IM 现指 vs .CFF Now(全等=现指别名)")
    for fut, spot in PAIRS:
        fn, sn = snap_now(fut), snap_now(spot)
        eq = '相等(别名)' if fn is not None and fn == sn else f'差{None if fn is None or sn is None else round(sn-fn,2)}'
        print(f"  {fut}={fn}  {spot}={sn}  → {eq}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
