#!/usr/bin/env python3
"""tes_000_all — 顺序跑完 001~010,汇总各脚本退出码
    用途:一次性看哪些 API 通了,哪些报错。
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SCRIPTS = [
    "tes_001_init.py",
    "tes_002_stock_list.py",
    "tes_003_market_data.py",
    "tes_004_indicator.py",
    "tes_005_account.py",
    "tes_006_calendar.py",
    "tes_007_financial.py",
    "tes_008_gpjy.py",
    "tes_009_order.py",
    "tes_010_misc.py",
]


def main() -> int:
    print(f"=== 批量跑 {' / '.join(SCRIPTS)} ===\n")
    results: list[tuple[str, int]] = []
    for s in SCRIPTS:
        path = HERE / s
        if not path.exists():
            print(f"[SKIP] {s} (不存在)")
            results.append((s, -1))
            continue
        print(f"\n========== RUN {s} ==========")
        rc = subprocess.call([sys.executable, str(path)])
        results.append((s, rc))
        print(f"========== END {s} (rc={rc}) ==========")

    print("\n=== 汇总 ===")
    for s, rc in results:
        mark = "OK" if rc == 0 else "FAIL"
        print(f"  [{mark}] {s}  rc={rc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())