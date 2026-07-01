#!/usr/bin/env python3
"""tes_034_more_info_sector — get_more_info 套板块指数,看涨跌停字段
    之前 tes_022 测大盘指数(999999)全 None,这次测 880xxx 板块指数
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
SECTORS = ['880301.SH', '880081.SH', '880082.SH', '880201.SH', '880202.SH', '880203.SH']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


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

    banner("step1: get_more_info 套 6 个板块指数")
    keys = ['UpHome', 'DownHome', 'Outside', 'Inside', 'ZTGPNum', 'Now', 'LastClose', 'Name']
    for code in SECTORS:
        info = tq.get_more_info(stock_code=code, field_list=[])
        out = {k: info.get(k) for k in keys}
        print(f"  [{code}] {out}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())