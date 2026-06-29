#!/usr/bin/env python3
"""tes_000_all — 顺序跑根目录剩余探针,汇总退出码
    用途:TQ 连通性体检(初始化/K线/指标/财务/估值/下单签名)。
    已归档探针(001/002/005/006/010)在 archive/,需单独跑。
"""
from __future__ import annotations
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
SCRIPTS = [
    "tes_003_market_data.py",
    "tes_004_indicator.py",
    "tes_007_financial.py",
    "tes_008_gpjy.py",
    "tes_009_order.py",   # dry-run, 不真实下单
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