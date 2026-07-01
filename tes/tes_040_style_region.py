#!/usr/bin/env python3
"""tes_040_style_region — 风格/地域 板块字段验证
    880531.SH 低安全分(风格) + 880218.SH 深圳板块(地区, via 000032.SZ)
    补齐 tes_039 没测到的 风格/地域/指数
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
TARGETS = ['880531.SH', '880218.SH']  # 风格 / 地区


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


def dump(code: str) -> None:
    info = tq.get_more_info(stock_code=code, field_list=[]) or {}
    snap = tq.get_market_snapshot(stock_code=code, field_list=[]) or {}
    mi, sn = nonempty(info), nonempty(snap)
    print(f"\n  [{code}] more_info {len(mi)} 字段, snapshot {len(sn)} 字段")
    key = ['ZTGPNum', 'UpHome', 'DownHome', 'Outside', 'Inside', 'ZAF', 'Zjl',
           'ZAFPre5', 'ZAFPre20', 'ZAFPre60', 'OpenAmo', 'Now', 'Amount']
    line = []
    for kf in key:
        src = 'mi' if kf in mi else ('sn' if kf in sn else '—')
        line.append(f"{kf}={src}")
    print(f"    {', '.join(line)}")
    # 额外字段(不在 key 里的非空)
    extra_mi = mi - set(key)
    if extra_mi:
        print(f"    mi 其他: {sorted(extra_mi)[:15]}")


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

    banner("step1: get_relation(000032.SZ) 看 880218 标啥类型")
    rel = tq.get_relation(stock_code='000032.SZ')
    if isinstance(rel, list):
        for item in rel:
            if isinstance(item, dict) and item.get('BlockCode') == '880218.SH':
                print(f"  880218.SH -> {item}")
                break
        # 顺便看 000032 的风格/地域归属
        print("  000032 全部板块类型分布:")
        from collections import Counter
        c = Counter(item.get('BlockType', '?') for item in rel if isinstance(item, dict))
        for bt, n in c.items():
            print(f"    {bt}: {n}")

    banner("step2: 风格 880531 + 地区 880218 字段 dump")
    for code in TARGETS:
        dump(code)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())