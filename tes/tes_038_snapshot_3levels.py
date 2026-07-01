#!/usr/bin/env python3
"""tes_038_snapshot_3levels — get_market_snapshot 三层 dump
    大盘 999999.SH + 三级板块 881337/881338/881339 + 个股 000070.SZ
    重点看 UpHome/DownHome/Outside/Inside 在每层分别是啥语义
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
TARGETS = ['999999.SH', '881337.SH', '881338.SH', '881339.SH', '000070.SZ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def dump(code: str) -> None:
    snap = tq.get_market_snapshot(stock_code=code, field_list=[])
    has, empty = [], []
    for k, v in snap.items():
        if k == 'ErrorId':
            continue
        sv = str(v).strip()
        if sv and sv != '0' and sv != '0.00' and sv != 'None' and sv != '[]':
            has.append((k, v))
        else:
            empty.append(k)
    print(f"\n  [{code}] 非空 {len(has)} 字段:")
    for k, v in has:
        print(f"    {k} = {v}")
    print(f"  空/0 字段: {empty}")


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

    banner("get_market_snapshot 三层 dump")
    for code in TARGETS:
        dump(code)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())