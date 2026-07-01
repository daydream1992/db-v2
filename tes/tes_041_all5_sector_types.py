#!/usr/bin/env python3
"""tes_041_all5_sector_types — 从 000032.SZ 抽 5 类板块各 1 个,全量字段对比
    000032 已知归属:行业1/地域1/概念34/风格10/指数10 (tes_040)
    目标:行业/地域/概念/风格/指数 字段集是否一致
"""
from __future__ import annotations
import sys
from collections import defaultdict
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

    banner("step1: get_relation(000032.SZ) 每类抽 1 个代表")
    rel = tq.get_relation(stock_code='000032.SZ')
    by_type = defaultdict(list)
    if isinstance(rel, list):
        for item in rel:
            if isinstance(item, dict):
                bt = item.get('BlockType', '?')
                bc = item.get('BlockCode', '')
                bn = item.get('BlockName', '')
                if bc and bc != '0':
                    by_type[bt].append((bc, bn))
    rep = {}
    for bt, items in by_type.items():
        rep[bt] = items[0]  # 每类第一个
        print(f"  [{bt}] 共{len(items)}个, 代表: {items[0]}")

    banner("step2: 5 类代表 字段对比")
    key = ['ZTGPNum', 'UpHome', 'DownHome', 'Outside', 'Inside', 'ZAF', 'Zjl',
           'ZAFPre5', 'ZAFPre20', 'ZAFPre60', 'OpenAmo', 'Now', 'Amount']
    results = {}
    for bt, (bc, bn) in rep.items():
        info = tq.get_more_info(stock_code=bc, field_list=[]) or {}
        snap = tq.get_market_snapshot(stock_code=bc, field_list=[]) or {}
        mi, sn = nonempty(info), nonempty(snap)
        results[bt] = (bc, bn, mi, sn)
        print(f"\n  [{bt}] {bc} {bn}: mi={len(mi)} sn={len(sn)}")
        line = []
        for kf in key:
            src = 'mi' if kf in mi else ('sn' if kf in sn else '—')
            line.append(f"{kf}={src}")
        print(f"    {', '.join(line)}")

    banner("step3: 字段集一致性(以第一类为基准)")
    types = list(results.keys())
    if len(types) >= 2:
        base_mi = results[types[0]][2]
        for t in types:
            mi = results[t][2]
            diff = mi ^ base_mi
            print(f"  [{t}] mi {len(mi)}字段  vs 基准{types[0]}: {'一致' if not diff else '差'+str(len(diff))+' '+str(sorted(diff)[:8])}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())