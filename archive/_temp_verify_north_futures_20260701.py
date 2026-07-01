#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_temp_verify_north_futures_20260701 — 一次性验证 index_monitor 补的北向/期指 stub
    调 collect_north_money / collect_futures_basis / detect_divergence 打印返回值。
    验证完即可删(archive 一次性)。"""
from __future__ import annotations
import sys
from pathlib import Path

MONITOR_DIR = Path(r'k:\DB数据库_v2\00_大盘情绪监控')
sys.path.insert(0, str(MONITOR_DIR))

import _common  # noqa: E402
import index_monitor  # noqa: E402


def main() -> int:
    if not _common.init_tq(__file__):
        return 1
    tq = _common.get_tq()

    print("\n=== collect_north_money ===")
    north = index_monitor.collect_north_money(tq)
    tag = '净流出' if (north is not None and north < 0) else ('净流入' if north else '空')
    print(f"  north = {north}  ({tag})")

    print("\n=== collect_futures_basis ===")
    basis = index_monitor.collect_futures_basis(tq)
    btag = '升水' if (basis is not None and basis > 0) else ('贴水' if (basis is not None and basis < 0) else '平/空')
    print(f"  basis = {basis}  ({btag})")

    print("\n=== detect_divergence(伪帧只验北向/期指分支) ===")
    fake_idx = {'999999.SH': {'zaf': 1.0, 'up': 100, 'down': 100, 'zjl': 50.0,
                              'amount': 100, 'cjje_pre1': 100}}
    sigs = index_monitor.detect_divergence(fake_idx, north, basis)
    print(f"  sigs = {sigs}")

    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
