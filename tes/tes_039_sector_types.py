#!/usr/bin/env python3
"""tes_039_sector_types — 行业/概念/风格/地域/指数 板块字段对比
    重点:ZTGPNum(涨停家数)/UpHome/DownHome 是否每种板块都有
    决定板块层要不要按类型拆脚本
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def nonempty(d: dict) -> set:
    out = set()
    for k, v in d.items():
        if k == 'ErrorId':
            continue
        sv = str(v).strip()
        if sv and sv != '0' and sv != '0.00' and sv != 'None' and sv != '[]':
            out.add(k)
    return out


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

    # step1: get_relation 拿每种 BlockType 一个代表
    banner("step1: get_relation(000070.SZ) 按 BlockType 分组")
    rel = tq.get_relation(stock_code='000070.SZ')
    by_type: dict[str, str] = {}  # BlockType -> 第一个 code
    if isinstance(rel, list):
        for item in rel:
            if isinstance(item, dict):
                bt = item.get('BlockType', '?')
                bc = item.get('BlockCode', '')
                if bt not in by_type and bc:
                    by_type[bt] = bc
    for bt, bc in by_type.items():
        print(f"  [{bt}] {bc}")

    # step2: 每种类型对比 more_info + snapshot 非空字段
    banner("step2: 每种板块类型 字段对比")
    key_fields = ['ZTGPNum', 'UpHome', 'DownHome', 'Outside', 'Inside',
                  'ZAF', 'Zjl', 'ZAFPre5', 'ZAFPre20', 'ZAFPre60', 'OpenAmo', 'Now', 'Amount']
    results = {}
    for bt, bc in by_type.items():
        info = tq.get_more_info(stock_code=bc, field_list=[]) or {}
        snap = tq.get_market_snapshot(stock_code=bc, field_list=[]) or {}
        mi_ne = nonempty(info)
        sn_ne = nonempty(snap)
        results[bt] = (bc, mi_ne, sn_ne)
        print(f"\n  [{bt}] code={bc}")
        print(f"    more_info 非空 {len(mi_ne)} 字段")
        print(f"    snapshot 非空 {len(sn_ne)} 字段")
        # 关键字段是否在
        line = []
        for kf in key_fields:
            src = 'more_info' if kf in mi_ne else ('snapshot' if kf in sn_ne else '—')
            line.append(f"{kf}={src}")
        print(f"    关键字段: {', '.join(line)}")

    # step3: 字段集是否一致
    banner("step3: 各类型字段集一致性")
    types = list(results.keys())
    if len(types) >= 2:
        base_mi = results[types[0]][1]
        base_sn = results[types[0]][2]
        for t in types[1:]:
            mi, sn = results[t][1], results[t][2]
            same_mi = (mi == base_mi)
            same_sn = (sn == base_sn)
            print(f"  {types[0]} vs {t}: more_info{'一致' if same_mi else '不一致(差'+str(len(mi^base_mi))+'字段)'}  snapshot{'一致' if same_sn else '不一致'}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())