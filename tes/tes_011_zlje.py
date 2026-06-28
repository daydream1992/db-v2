#!/usr/bin/env python3
"""tes_011_zlje — 主力净额(ZLJE)变化选股(纯选股,绝不下单)

来源: 微信《TdxQuant资金数据实战指南》文章 2.1 实时选股版
核心: 定时取 ZLJE 主力净额, 算 (本次值 - 上次值) 差额, 排序找资金流入最猛的票。

⚠️ 前提: 必须先在通达信公式管理器建好 ZLJE 自定义公式
   (见同目录 ZLJE公式安装说明.md), 否则报 "获取公式失败或公式不存在"。
   且需要 Level-2 数据权限(专业研究版 V7.73+)。

跑法:
  python tes/tes_011_zlje.py                                 # 默认 100只/2轮/间隔60s/前5
  python tes/tes_011_zlje.py --limit 500 --interval 180 --top 10
  python tes/tes_011_zlje.py --rounds 4 --start 20260601 --end 20260625
  python tes/tes_011_zlje.py --codes 600519.SH,000001.SZ     # 指定股票池
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="主力净额(ZLJE)变化选股 — 纯选股,不下单")
    p.add_argument('--limit', type=int, default=100, help='从全市场取前N只(默认100)')
    p.add_argument('--codes', default='', help='指定股票池,逗号分隔(如 600519.SH,000001.SZ); 给了就忽略 --limit')
    p.add_argument('--rounds', type=int, default=2, help='循环轮数(≥2才能算差额,默认2)')
    p.add_argument('--interval', type=int, default=60, help='每轮间隔秒数(默认60; 文章原值180)')
    p.add_argument('--top', type=int, default=5, help='输出前N名(默认5)')
    p.add_argument('--start', default='20240601', help='开始日期 YYYYMMDD')
    p.add_argument('--end', default='20240630', help='结束日期 YYYYMMDD')
    p.add_argument('--no-refresh', action='store_true', help='不强制刷新缓存(默认每轮前刷新)')
    return p.parse_args()


def banner(msg: str) -> None:
    print(f"\n{'=' * 60}\n=== {THIS} :: {msg} ===\n{'=' * 60}")


def fetch_zlje(stock_list, start: str, end: str, refresh: bool):
    """取一轮 ZLJE 主力净额数据"""
    if refresh:
        try:
            tq.refresh_cache(market='AG', force=True)
        except Exception as e:  # noqa: BLE001
            print(f"  refresh_cache 失败(忽略): {e}")
    return tq.formula_process_mul_zb(
        formula_name='ZLJE',
        formula_arg='',
        xsflag=6,                # 保留6位小数
        return_count=2,
        return_date=True,
        stock_list=stock_list,
        stock_period='1d',
        count=-1,
        start_time=start,
        end_time=end,
        dividend_type=1,         # 前复权
    )


def compute_diff(curr: dict, prev: dict) -> list[tuple[str, float]]:
    """计算每只票主力净额 (本次 - 上次) 差额, 按降序返回 [(code, diff), ...]"""
    diffs: list[tuple[str, float]] = []
    for key in curr:
        if key == "ErrorId":
            continue
        try:
            c = curr[key].get('主力净额', [])
            p = prev[key].get('主力净额', [])
            if not c or not p:
                continue
            curr_val = float(c[-1]['Value'])
            pre_val = float(p[-1]['Value'])
            diffs.append((key, curr_val - pre_val))
        except (KeyError, ValueError, TypeError, IndexError):
            continue
    diffs.sort(key=lambda x: x[1], reverse=True)
    return diffs


def error_id_of(res) -> str:
    if isinstance(res, dict):
        return str(res.get('ErrorId', '0'))
    return '0'


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
        print(f"指定股票池: {len(stocks)} 只 -> {stocks}")
    else:
        try:
            all_stocks = tq.get_stock_list(market='5')
            stocks = all_stocks[:args.limit]
            print(f"全市场前 {args.limit} 只 (共 {len(all_stocks)}): {stocks[:5]} ...")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL get_stock_list: {e}")
            return 1

    # 循环取数 + 算差额
    banner(f"{args.rounds} 轮循环 | 间隔 {args.interval}s | 区间 {args.start}-{args.end} | 前 {args.top} 名")
    pre: dict = {}
    for rnd in range(1, args.rounds + 1):
        print(f"\n--- 第 {rnd}/{args.rounds} 轮 ---")
        try:
            curr = fetch_zlje(stocks, args.start, args.end, refresh=not args.no_refresh)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL fetch_zlje: {e}")
            print(">> 若报 '公式不存在', 请先按 ZLJE公式安装说明.md 在通达信建 ZLJE 公式")
            curr = {}

        if not isinstance(curr, dict) or not curr:
            print("⚠️ 本轮返回空")
        else:
            eid = error_id_of(curr)
            if eid not in ('0', 'None', ''):
                print(f"⚠️ API ErrorId={eid}: {curr.get('Error', '')}")

            if pre:
                diffs = compute_diff(curr, pre)
                if diffs:
                    print(f"\n🔥 主力净额变化前 {args.top} 名 (万元):")
                    print("-" * 50)
                    for i, (code, diff) in enumerate(diffs[:args.top], 1):
                        print(f"  {i}. {code}: {diff:+.2f} 万元")
                    print("-" * 50)
                else:
                    print("⚠️ 本轮无有效差额(可能首日无历史 L2 数据)")
            elif rnd == 1:
                print("(首轮 pre 为空, 等下一轮才能算差额)")

        pre = curr if isinstance(curr, dict) else {}
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