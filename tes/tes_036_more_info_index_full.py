#!/usr/bin/env python3
"""tes_036_more_info_index_full — dump 大盘指数全字段,看哪些非空
    tes_022 只测了 8 个字段就下结论(全None),这次全量看,找惊喜
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
INDICES = ['999999.SH', '399001.SZ', '000300.SH', '000688.SH', '399006.SZ', '899050.BJ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def dump(code: str) -> None:
    info = tq.get_more_info(stock_code=code, field_list=[])
    has = []
    for k, v in info.items():
        if k == 'ErrorId':
            continue
        sv = str(v).strip()
        if sv and sv != '0' and sv != '0.00' and sv != 'None':
            has.append((k, v))
    print(f"\n  [{code}] 非空字段 {len(has)} 个:")
    for k, v in has:
        print(f"    {k} = {v}")


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

    banner("6 个大盘指数全字段 dump")
    for code in INDICES:
        dump(code)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())