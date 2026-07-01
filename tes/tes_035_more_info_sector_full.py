#!/usr/bin/env python3
"""tes_035_more_info_sector_full — dump 板块指数全部字段,看哪些非空
    之前 tes_034 只测 8 个字段,这次全量看
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
        print(f"FAIL init: {e}"); return 1
    try:
        tq.refresh_cache(market='AG', force=True)
    except Exception:
        pass

    banner("step1: 板块指数 880202.SH 全字段 dump(只显示非空/非0)")
    info = tq.get_more_info(stock_code='880202.SH', field_list=[])
    has, empty = [], []
    for k, v in info.items():
        if k == 'ErrorId':
            continue
        sv = str(v).strip()
        if sv and sv != '0' and sv != '0.00' and sv != 'None':
            has.append((k, v))
        else:
            empty.append(k)
    print(f"  非空字段 {len(has)} 个:")
    for k, v in has:
        print(f"    {k} = {v}")
    print(f"\n  空/0 字段 {len(empty)} 个: {empty}")

    banner("step2: 对照个股 600635.SH 拿 ZTPrice/DTPrice/FCAmo")
    info2 = tq.get_more_info(stock_code='600635.SH', field_list=[])
    for k in ['ZTPrice', 'DTPrice', 'FCAmo', 'ZAF', 'Now', 'LastClose', 'High' if 'High' in info2 else 'ZAF']:
        if k in info2:
            print(f"    {k} = {info2[k]}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())