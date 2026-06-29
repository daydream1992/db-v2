#!/usr/bin/env python3
"""tes_014_verify — 异常票核对: get_more_info 全字段 + 近期K线
    用途: 核验 Zjl 量级异常的票, 看是真异动还是字段口径问题。
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
TARGETS = ['001309.SZ', '600522.SH', '000100.SZ', '600667.SH']  # 异常 + 对比基准


def banner(msg: str) -> None:
    print(f"\n{'=' * 60}\n=== {THIS} :: {msg} ===\n{'=' * 60}")


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: {e}")
        return 1

    # 重点资金相关字段(从 88 字段里挑)
    focus = [
        'Name', 'Price', 'LastClose', 'RiseFall', 'RFPercent',
        'Volume', 'Amount', 'Turnover',
        'Zjl',           # 主力净流(万元)
        'Zjlp5',         # 5日主力净流
        'Zjlb',          # 主力净流比
        'FzAmo',         # 防御金额?
        'TotalBVol', 'TotalSVol',  # 总买/卖量
        'Lb', 'Wlb',     # 量比/委比
        'Pe', 'Pb', 'FloatValue', 'TotalValue',
    ]

    for code in TARGETS:
        banner(f"get_more_info {code}")
        try:
            info = tq.get_more_info(stock_code=code)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL: {e}")
            continue
        if not info:
            print("(空)")
            continue
        print(f"  Name = {info.get('Name', '?')}")
        for f in focus:
            if f in info:
                print(f"  {f:<12} = {info[f]!r}")

        # 近 10 日 K 线看趋势
        banner(f"get_market_data {code} 近10日")
        try:
            res = tq.get_market_data(
                stock_list=[code], period='1d',
                start_time='20260601', end_time='20260629',
                count=10, dividend_type=1,
            )
            if isinstance(res, dict) and 'Close' in res:
                df = res['Close']
                print(f"  收盘价:\n{df.tail(10).to_string()}")
                if 'Amount' in res:
                    print(f"  成交额:\n{res['Amount'].tail(10).to_string()}")
            else:
                print(f"  返回: {list(res.keys()) if isinstance(res, dict) else res!r}")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL K线: {e}")

    banner("done")
    try:
        tq.close()
    except Exception:  # noqa: BLE001
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())