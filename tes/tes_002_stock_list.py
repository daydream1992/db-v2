#!/usr/bin/env python3
"""tes_002_stock_list — 测试 get_stock_list / get_sector_list / get_stock_list_in_sector
    用途:确认股票池来源 + 板块元数据。
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def show_sample(name: str, lst, n: int = 5) -> None:
    print(f"[{name}] 返回类型={type(lst).__name__} 长度={len(lst) if hasattr(lst, '__len__') else '?'}")
    if isinstance(lst, list) and lst:
        for x in lst[:n]:
            print(f"  - {x}")
        if len(lst) > n:
            print(f"  ... (共 {len(lst)} 条)")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL initialize: {e}")
        return 1

    # market 参数:0=深A,1=沪A,5=全部? 具体看 get_stock_list 签名
    banner("get_stock_list market='5' 前 20")
    # 强制刷新行情缓存,避免拿陈旧快照
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        all_stocks = tq.get_stock_list(market='5') or []
        show_sample("market=5", all_stocks, n=10)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    # 单股信息
    sample_code = all_stocks[0] if all_stocks else '600000.SH'
    banner(f"get_stock_info {sample_code}")
    try:
        info = tq.get_stock_info(stock_code=sample_code)
        print(f"[stock_info] 返回类型={type(info).__name__}")
        if isinstance(info, dict):
            for k, v in list(info.items())[:20]:
                print(f"  {k} = {v!r}")
            if len(info) > 20:
                print(f"  ... 共 {len(info)} 字段")
        else:
            print(f"  {info!r}")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    # 板块列表
    banner("get_sector_list")
    try:
        sectors = tq.get_sector_list(list_type=0) or []
        show_sample("list_type=0", sectors, n=10)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_user_sector")
    try:
        user_sec = tq.get_user_sector() or []
        show_sample("user_sector", user_sec, n=10)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("done")
    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())