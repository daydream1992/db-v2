#!/usr/bin/env python3
"""tes_037_stock_sector_chain — 个股+所属881板块链路测试
    000070.SZ (个股) + 881337.SH 通信 + 881338.SH 通信设备 + 881339.SH 光纤光缆
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
TARGETS = ['000070.SZ', '881337.SH', '881338.SH', '881339.SH']


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
    print(f"\n  [{code}] 非空 {len(has)} 字段:")
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

    banner("step1: get_more_info 全字段 dump")
    for code in TARGETS:
        dump(code)

    banner("step2: get_relation(000070.SZ) 个股板块归属")
    try:
        rel = tq.get_relation(stock_code='000070.SZ')
        print(f"  type={type(rel).__name__}")
        if isinstance(rel, dict):
            for k, v in rel.items():
                print(f"  {k}: {v}")
        elif isinstance(rel, list):
            print(f"  条目数={len(rel)}")
            for item in rel[:20]:
                print(f"  {item}")
        else:
            print(f"  {rel!r}")
    except Exception as e:
        print(f"  异常: {e}")

    banner("step3: get_stock_list_in_sector(881337.SH) 通信成份股")
    try:
        members = tq.get_stock_list_in_sector(block_code='881337.SH', block_type=0, list_type=0)
        print(f"  成份股数={len(members) if hasattr(members,'__len__') else '?'}")
        if isinstance(members, list):
            print(f"  前 10: {members[:10]}")
            print(f"  000070.SZ 在列? {'000070.SZ' in members}")
    except Exception as e:
        print(f"  异常: {e}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())