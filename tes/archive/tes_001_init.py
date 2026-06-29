#!/usr/bin/env python3
"""tes_001_init — tqcenter 初始化 + 健康检查 + 列出 tq 公共方法
    用途:确认 TQ 客户端能连上,拿到可调 API 全清单。
"""
from __future__ import annotations
import sys
import inspect
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def main() -> int:
    banner("initialize")
    # 注意:官方用法是传 __file__,会去找对应插件路径
    try:
        tq.initialize(__file__)
        print("OK initialize")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL initialize: {e}")
        return 1

    banner("tq public methods")
    methods = sorted(
        name for name, _ in inspect.getmembers(tq, predicate=inspect.isfunction)
        if not name.startswith("_")
    )
    for m in methods:
        print(f"  - {m}")
    print(f"\n共 {len(methods)} 个公共方法")

    banner("done")
    try:
        tq.close()
    except Exception as e:  # noqa: BLE001
        print(f"close 异常(可忽略): {e}")
    return 0


if __name__ == "__main__":
    sys.exit(main())