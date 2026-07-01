#!/usr/bin/env python3
"""tes_028_scjy_extra — 验 get_scjy_value 拿 SC15(封板成功/失败资金) + SC23(连板率分母?)
    同时验 SC24 字段全解(可能含 2 板以上数)
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# 目标字段
SC_FIELDS = ['SC15', 'SC23', 'SC24', 'SC03', 'SC04', 'SC31']


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

    banner("step1: 一次拿 SC15/SC23/SC24/SC03/SC04/SC31")
    res = tq.get_scjy_value(field_list=SC_FIELDS)
    print(f"  顶层 type={type(res).__name__}")
    if not isinstance(res, dict):
        print(f"  返回: {res!r}")
        tq.close(); return 1
    print(f"  顶层 keys={list(res.keys())[:10]}")
    if 'ErrorId' in res:
        print(f"  ErrorId={res['ErrorId']}")
    for fid in SC_FIELDS:
        if fid not in res:
            print(f"  [{fid}]: 字段缺失")
            continue
        v = res[fid]
        if isinstance(v, list) and v:
            last = v[-1]
            print(f"  [{fid}]: list[len={len(v)}] last={last!r}")
        else:
            print(f"  [{fid}]: {v!r}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
