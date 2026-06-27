#!/usr/bin/env python3
"""tes_013_zjl — 主力净额(Zjl)变化选股(纯选股,不下单,无需建公式)

数据源: get_more_info(code)['Zjl'] —— TQ 直接给的主力资金净流入字段(万元)
       不像 tes_011 的 ZLJE 需要手动建公式,这个现在就能跑。

核心: 定时取每只票的 Zjl, 算 (本次 - 上次) 差额, 排序找资金流入加速的票。

⚠️ Zjl 是"当日累计主力净流", 非交易时段/盘后值为当日收盘累计;
   分钟级变化在开盘后才明显, 盘后测只看排序是否有意义。

跑法:
  python tes/tes_013_zjl.py                                          # 默认 50只/2轮/间隔30s/前5
  python tes/tes_013_zjl.py --codes 600519.SH,000001.SZ,601318.SH --interval 5 --rounds 2
  python tes/tes_013_zjl.py --limit 200 --top 10 --interval 60
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
# get_more_info 88字段里跟资金/主力相关的几个, Zjl 为主力净流(万元)
CAPITAL_FIELDS = ['Zjl', 'FzAmo', 'TotalBVol', 'TotalSVol']


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="主力净额(Zjl)变化选股 — 无需建公式,纯选股不下单")
    p.add_argument('--limit', type=int, default=50, help='从全市场取前N只(默认50; get_more_info单股调用,别开太大)')
    p.add_argument('--codes', default='', help='指定股票池,逗号分隔(如 600519.SH,000001.SZ)')
    p.add_argument('--rounds', type=int, default=2, help='循环轮数(≥2才能算差额)')
    p.add_argument('--interval', type=int, default=30, help='每轮间隔秒数')
    p.add_argument('--top', type=int, default=5, help='输出前N名')
    p.add_argument('--abs', dest='abs_mode', action='store_true',
                   help='绝对值模式:单轮取数,按当前Zjl降序(盘后也能用,看谁主力净流入最多)')
    return p.parse_args()


def banner(msg: str) -> None:
    print(f"\n{'=' * 60}\n=== {THIS} :: {msg} ===\n{'=' * 60}")


def fetch_zjl(stocks: list[str]) -> dict:
    """逐股取 Zjl(主力净流,万元), 返回 {code: zjl_float or None}"""
    out: dict = {}
    for code in stocks:
        try:
            info = tq.get_more_info(stock_code=code)
            raw = info.get('Zjl')
            out[code] = float(raw) if raw not in (None, '') else None
        except Exception as e:  # noqa: BLE001
            out[code] = None
    return out


def compute_diff(curr: dict, prev: dict) -> list[tuple[str, float]]:
    """(本次Zjl - 上次Zjl), 降序; 正值=主力净流加速流入"""
    diffs = []
    for code, c in curr.items():
        p = prev.get(code)
        if c is None or p is None:
            continue
        try:
            diffs.append((code, c - float(p)))
        except (TypeError, ValueError):
            continue
    diffs.sort(key=lambda x: x[1], reverse=True)
    return diffs


def show_snapshot(label: str, zjl_map: dict) -> None:
    valid = {k: v for k, v in zjl_map.items() if v is not None}
    if not valid:
        print(f"{label}: 无数据")
        return
    print(f"{label}: 共 {len(valid)}/{len(zjl_map)} 只有Zjl, 当前主力净流TOP:")
    top_now = sorted(valid.items(), key=lambda x: x[1], reverse=True)[:5]
    for code, v in top_now:
        print(f"  {code}: {v:+.2f} 万元")


def main() -> int:
    args = parse_args()

    banner("initialize")
    try:
        tq.initialize(__file__)
        print("OK initialize")
    except Exception as e:  # noqa: BLE001
        print(f"FAIL initialize: {e}")
        return 1

    # 股票池
    banner("准备股票池")
    if args.codes:
        stocks = [c.strip() for c in args.codes.split(',') if c.strip()]
    else:
        try:
            all_stocks = tq.get_stock_list(market='5')
            stocks = all_stocks[:args.limit]
        except Exception as e:  # noqa: BLE001
            print(f"FAIL get_stock_list: {e}")
            return 1
    print(f"股票池: {len(stocks)} 只")

    # 绝对值模式:单轮取数按当前Zjl降序(盘后数据冻结也能看排序)
    if args.abs_mode:
        banner(f"绝对值模式 | 单轮取数 | 前 {args.top} 名 (按当前Zjl降序)")
        curr = fetch_zjl(stocks)
        ok = sum(1 for v in curr.values() if v is not None)
        print(f"取到 {ok}/{len(stocks)} 只的 Zjl")
        valid = {k: v for k, v in curr.items() if v is not None}
        if not valid:
            print("⚠️ 无 Zjl 数据")
        else:
            ranked = sorted(valid.items(), key=lambda x: x[1], reverse=True)
            n = min(args.top, len(ranked))
            print(f"\n🏆 主力净流(Zjl)当前 TOP {n} (万元, 正=净流入最多):")
            print("-" * 54)
            for i, (code, v) in enumerate(ranked[:n], 1):
                print(f"  {i:>2}. {code}: {v:+.2f}")
            print("-" * 54)
            print(f"\n💀 主力净流底部 {n} (净流出最多):")
            print("-" * 54)
            for i, (code, v) in enumerate(sorted(valid.items(), key=lambda x: x[1])[:n], 1):
                print(f"  {i:>2}. {code}: {v:+.2f}")
            print("-" * 54)
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
        print("✅ 处理完成 (纯选股, 未下单)")
        return 0

    banner(f"{args.rounds} 轮循环 | 间隔 {args.interval}s | 前 {args.top} 名")
    pre: dict = {}
    for rnd in range(1, args.rounds + 1):
        print(f"\n--- 第 {rnd}/{args.rounds} 轮 ---")
        curr = fetch_zjl(stocks)
        ok = sum(1 for v in curr.values() if v is not None)
        print(f"取到 {ok}/{len(stocks)} 只的 Zjl")

        if pre:
            diffs = compute_diff(curr, pre)
            if diffs:
                print(f"\n🔥 主力净流(Zjl)变化前 {args.top} 名 (万元, 正=加速流入):")
                print("-" * 54)
                for i, (code, diff) in enumerate(diffs[:args.top], 1):
                    now = curr.get(code)
                    now_s = f"{now:+.2f}" if now is not None else "N/A"
                    print(f"  {i}. {code}: 变化 {diff:+.2f}  (当前 {now_s})")
                print("-" * 54)
            else:
                print("⚠️ 本轮无有效差额(盘后Zjl不变属正常)")
        elif rnd == 1:
            show_snapshot("首轮快照", curr)
            print("(首轮 pre 为空, 等下一轮算差额)")

        pre = curr
        if rnd < args.rounds:
            print(f"⏳ 等待 {args.interval}s 进入下一轮 ...")
            time.sleep(args.interval)

    banner("done")
    try:
        tq.close()
    except Exception:  # noqa: BLE001
        pass
    print("✅ 处理完成 (纯选股, 未下单)")
    return 0


if __name__ == "__main__":
    sys.exit(main())