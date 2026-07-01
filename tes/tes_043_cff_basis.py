#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tes_043_cff_basis — 验期指升贴水(IF/IH/IC/IM 基差)
    .CFF 中金所期货后缀已确认(IF300.CFF 88字段,memory tqcenter-api-signatures)。
    本探针:
      1. get_more_info('IF300.CFF') 全 dump → 找 Now/基差/现货字段
      2. get_market_snapshot('IF300.CFF') → Now 期指现价
      3. 暴力试 IH/IC/IM 代码(看哪些非空)
      4. IF 基差 = 沪深300现指 - IF300期指(正=升水 / 负=贴水)
"""
from __future__ import annotations
import os
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# 中金所股指期货连续代码候选(IF沪深300 / IH上证50 / IC中证500 / IM中证1000)
FUTURES = ['IF300.CFF', 'IH50.CFF', 'IC500.CFF', 'IM1000.CFF', 'IF.CFF', 'IH.CFF', 'IC.CFF', 'IM.CFF']
SPOT_IF = ['000300.SH', '000300.CSI']  # 沪深300现指候选


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def dump_more(code: str) -> dict:
    try:
        info = tq.get_more_info(stock_code=code, field_list=[])
    except Exception as e:
        print(f"  [{code}] FAIL: {e}")
        return {}
    has = []
    for k, v in info.items():
        if k == 'ErrorId':
            continue
        sv = str(v).strip()
        if sv and sv not in ('0', '0.00', 'None'):
            has.append((k, v))
    print(f"  [{code}] 非空 {len(has)} 字段")
    for k, v in has:
        print(f"    {k} = {v}")
    return info


def get_now(code: str) -> float | None:
    """从 snapshot.Now 拿现价"""
    try:
        snap = tq.get_market_snapshot(stock_code=code, field_list=[])
        v = snap.get('Now')
        return float(v) if v not in (None, '', 'None') else None
    except Exception as e:
        print(f"  [{code}] snapshot FAIL: {e}")
        return None


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

    banner("step1: IF300.CFF 全字段 dump(找 Now/基差/现货)")
    dump_more('IF300.CFF')

    banner("step2: 暴力试 IH/IC/IM + 无数字代码(看哪些非空)")
    alive = {}
    for code in FUTURES:
        if code == 'IF300.CFF':
            continue
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            cnt = sum(1 for k, v in info.items()
                      if k != 'ErrorId' and str(v).strip() not in ('', '0', '0.00', 'None'))
            now = info.get('Now')
            print(f"  [{code}] 非空{cnt:>2} Now={now!r}")
            if cnt > 0:
                alive[code] = now
        except Exception as e:
            print(f"  [{code}] FAIL: {e}")

    banner("step3: IF 基差 = 沪深300现指 - IF300期指")
    f_now = get_now('IF300.CFF')
    print(f"  IF300.CFF snapshot.Now = {f_now}")
    spot_ok = None
    for spot in SPOT_IF:
        s_now = get_now(spot)
        print(f"  {spot} Now = {s_now}", end='')
        if f_now and s_now:
            basis = s_now - f_now
            print(f" → 基差={basis:.2f} ({'升水' if basis > 0 else '贴水' if basis < 0 else '平水'})")
            spot_ok = spot
        else:
            print()

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
