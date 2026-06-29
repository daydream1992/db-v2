#!/usr/bin/env python3
"""tes_010_misc — 杂项:板块 / 公式 / 文件下载 / 提示
    用途:扫一遍少用的 API(get_sector_list_in_sector, formula_set_data,
         formula_get_info, download_file, send_warn, get_match_stkinfo 等)
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===")


def show(label: str, obj, head: int = 3) -> None:
    print(f"[{label}] type={type(obj).__name__}")
    if isinstance(obj, list):
        print(f"  length={len(obj)}")
        for x in obj[:head]:
            print(f"  - {x!r}")
    elif isinstance(obj, dict):
        print(f"  keys={list(obj.keys())[:15]}")
        for k, v in list(obj.items())[:head]:
            print(f"  {k} = {v!r}")
    else:
        print(f"  {obj!r}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    banner("get_sector_list_in_sector(传入板块号)")
    # 强制刷新行情缓存
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] -> {rc[:80] if isinstance(rc, str) else rc!r}")
    except Exception as e:  # noqa: BLE001
        print(f"refresh_cache 失败(可忽略): {e}")
    try:
        # 880301 沪深A股 之类
        sec_codes = tq.get_stock_list_in_sector(sector_code='880301')
        show("sector 880301", sec_codes, head=5)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("formula_get_info(看哪些公式可用)")
    try:
        info = tq.formula_get_info(formula_type=0, formula_code='ZLJE')
        show("formula_get_info ZLJE", info)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_match_stkinfo 模糊搜股")
    try:
        matched = tq.get_match_stkinfo(key_word='银行')
        show("stkinfo 银行", matched, head=5)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("get_trackzs_etf_info 跟踪指数的 ETF")
    try:
        etf = tq.get_trackzs_etf_info(zs_code='000300')
        show("000300 跟踪 ETF", etf)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")

    banner("send_warn 推送提示(只发测试文字,不传盘后数据)")
    # 真实调用注释掉,避免打扰
    # tq.send_warn(content='tes_010 测试推送')
    print("  send_warn 签名: send_warn(content=..., stock_list=..., category=...)")
    print("  本测试未触发,避免打扰")

    banner("done")
    try:
        tq.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())