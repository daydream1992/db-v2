#!/usr/bin/env python3
"""tes_011_zlje — 主力净额(ZLJE)变化/排序选股(纯选股,绝不下单)

数据源: 自建 ZLJE 技术指标公式(formula_process_mul_zb)
       基于历史K线的 L2_AMO, 盘后不归零(优于 get_more_info 的 Zjl)。

⚠️ 两种模式:
  --abs (默认推荐,盘后可用): 取最近交易日 ZLJE 绝对值排序, 看谁主力净流入最多
  默认(差额模式,盘中用): 多轮循环算 (本次-上次) 差额, 找资金加速流入的票
                        盘后数据冻结, 差额恒为0, 此模式只在交易时段有意义

⚠️ 数据特性(实测):
  - L2 历史数据通达信只存近期(约1-2月), 远期(如2024)返回 None
  - 所以默认区间自动取最近30天, 别手动填远古日期
  - ZLJE 公式必须先在通达信手动建好(见 ZLJE公式安装说明.md)

跑法:
  python tes/tes_011_zlje.py --abs --codes 600519.SH,000001.SZ --top 10    # 盘后排序
  python tes/tes_011_zlje.py --abs --limit 200 --top 20                     # 全市场前200排序
  python tes/tes_011_zlje.py --codes 600519.SH --rounds 3 --interval 180    # 盘中实时差额
"""
from __future__ import annotations
import argparse
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.append(r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="主力净额(ZLJE)选股 — 纯选股,不下单")
    p.add_argument('--limit', type=int, default=100, help='从全市场取前N只(默认100)')
    p.add_argument('--codes', default='', help='指定股票池,逗号分隔; 给了忽略 --limit')
    p.add_argument('--abs', dest='abs_mode', action='store_true',
                   help='绝对值模式:取最近交易日ZLJE排序(盘后可用,推荐)')
    p.add_argument('--rounds', type=int, default=2, help='差额模式轮数(≥2,默认2)')
    p.add_argument('--interval', type=int, default=180, help='差额模式每轮间隔秒(默认180)')
    p.add_argument('--top', type=int, default=15, help='输出前N名(默认15)')
    p.add_argument('--start', default='', help='开始日期 YYYYMMDD(默认自动最近30天)')
    p.add_argument('--end', default='', help='结束日期 YYYYMMDD(默认今天)')
    p.add_argument('--no-refresh', action='store_true', help='不强制刷新缓存')
    return p.parse_args()


def banner(msg: str) -> None:
    print(f"\n{'=' * 60}\n=== {THIS} :: {msg} ===\n{'=' * 60}")


def fetch_zlje(stock_list, start: str, end: str, refresh: bool):
    if refresh:
        try:
            tq.refresh_cache(market='AG', force=True)
        except Exception as e:  # noqa: BLE001
            print(f"  refresh_cache 失败(忽略): {e}")
    return tq.formula_process_mul_zb(
        formula_name='ZLJE',
        formula_arg='',
        xsflag=6,
        return_count=2,
        return_date=True,
        stock_list=stock_list,
        stock_period='1d',
        count=-1,
        start_time=start,
        end_time=end,
        dividend_type=1,
    )


def last_valid_value(entry) -> float | None:
    """从 res[code]['主力净额'] 取最近一个非None的Value; entry可能为None/list"""
    if not isinstance(entry, list):
        return None
    for it in reversed(entry):
        v = it.get('Value')
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
    return None


def main() -> int:
    args = parse_args()

    # 默认区间:最近30天(L2 远期数据全空,别用远古日期)
    end = args.end or datetime.now().strftime('%Y%m%d')
    start = args.start or (datetime.now() - timedelta(days=30)).strftime('%Y%m%d')

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
        print(f"指定股票池: {len(stocks)} 只 -> {stocks[:8]}{' ...' if len(stocks) > 8 else ''}")
    else:
        try:
            stocks = tq.get_stock_list(market='5')[:args.limit]
            print(f"全市场前 {args.limit} 只: {stocks[:5]} ...")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL get_stock_list: {e}")
            return 1

    # ============ 绝对值模式(盘后可用,推荐) ============
    if args.abs_mode:
        banner(f"绝对值模式 | 区间 {start}-{end} | 前 {args.top} 名")
        try:
            res = fetch_zlje(stocks, start, end, refresh=not args.no_refresh)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL fetch_zlje: {e}")
            print(">> 若报'公式不存在',请先按 ZLJE公式安装说明.md 建 ZLJE 公式")
            return 1

        rows: list[tuple[str, float]] = []
        miss = 0
        for code in stocks:
            entry = res.get(code, {}).get('主力净额') if isinstance(res, dict) else None
            v = last_valid_value(entry)
            if v is None:
                miss += 1
            else:
                rows.append((code, v))
        rows.sort(key=lambda x: x[1], reverse=True)

        if not rows:
            print("⚠️ 全部为空(可能公式没建/区间无L2数据/非交易时段未刷新)")
            try:
                tq.close()
            except Exception:  # noqa: BLE001
                pass
            return 1

        print(f"取到 {len(rows)}/{len(stocks)} 只有效ZLJE (缺失 {miss})")
        n = min(args.top, len(rows))
        print(f"\n🏆 ZLJE 主力净额 TOP {n} (万元, 正=净流入最多):")
        print("-" * 50)
        for i, (code, v) in enumerate(rows[:n], 1):
            print(f"  {i:>2}. {code}: {v:+,.2f}")
        print("-" * 50)
        print(f"\n💀 ZLJE 底部 {n} (净流出最多):")
        print("-" * 50)
        for i, (code, v) in enumerate(list(reversed(rows))[:n], 1):
            print(f"  {i:>2}. {code}: {v:+,.2f}")
        print("-" * 50)
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
        print("✅ 处理完成 (纯选股, 未下单)")
        return 0

    # ============ 差额模式(盘中实时监控用) ============
    banner(f"差额模式 | {args.rounds} 轮 | 间隔 {args.interval}s | 区间 {start}-{end} | 前 {args.top} 名")
    print("⚠️ 差额模式仅交易时段有效(盘后数据冻结,差额=0)")
    pre: dict = {}
    for rnd in range(1, args.rounds + 1):
        print(f"\n--- 第 {rnd}/{args.rounds} 轮 ---")
        try:
            curr = fetch_zlje(stocks, start, end, refresh=not args.no_refresh)
        except Exception as e:  # noqa: BLE001
            print(f"FAIL: {e}")
            curr = {}

        if isinstance(curr, dict) and pre:
            diffs = []
            for code in stocks:
                if code in curr and code in pre:
                    c = last_valid_value(curr[code].get('主力净额'))
                    p = last_valid_value(pre[code].get('主力净额'))
                    if c is not None and p is not None:
                        diffs.append((code, c - p))
            diffs.sort(key=lambda x: x[1], reverse=True)
            if diffs and any(abs(d) > 1e-6 for _, d in diffs):
                print(f"\n🔥 主力净额变化前 {args.top} 名 (万元):")
                print("-" * 50)
                for i, (code, d) in enumerate(diffs[:args.top], 1):
                    print(f"  {i}. {code}: {d:+.2f}")
                print("-" * 50)
            else:
                print("⚠️ 无有效差额(盘后数据冻结属正常; 盘中请确认在交易时段)")
        elif rnd == 1:
            print("(首轮 pre 为空, 等下一轮算差额)")

        pre = curr if isinstance(curr, dict) else {}
        if rnd < args.rounds:
            print(f"⏳ 等待 {args.interval}s ...")
            time.sleep(args.interval)

    try:
        tq.close()
    except Exception:  # noqa: BLE001
        pass
    print("✅ 处理完成 (纯选股, 未下单)")
    return 0


if __name__ == "__main__":
    sys.exit(main())