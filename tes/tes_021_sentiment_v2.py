#!/usr/bin/env python3
"""tes_021_sentiment_v2 — 修正上证指数代码 + 加板块指数看涨停跌停字段
    关键修复:
      1) 上证指数 999999.SH (不是 000001.SH,那是平安银行个股)
      2) 加板块指数(沪深300/科创50/创业板),看 Outside/Inside 是不是真切换成涨停跌停数
      3) 北证50 试 899050 / 830000 / 899300
      4) 累加全市场今日触板股数
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name

# 通达信指数代码表(根据用户提供)
INDEX_CODES = [
    '999999.SH',  # 上证指数
    '399001.SZ',  # 深证成指
    '000300.SH',  # 沪深300
    '000688.SH',  # 科创50
    '399006.SZ',  # 创业板指
]
# 北证50 候选
BJ_CANDIDATES = ['899050.BJ', '830000.BJ', '899300.BJ']


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_snapshot(code: str) -> dict:
    snap = tq.get_market_snapshot(stock_code=code, field_list=[])
    return {
        'code': code,
        'UpHome': snap.get('UpHome'),
        'DownHome': snap.get('DownHome'),
        'Outside': snap.get('Outside'),
        'Inside': snap.get('Inside'),
        'Now': snap.get('Now'),
        'Name': snap.get('Name', '?'),
        'ErrorId': snap.get('ErrorId'),
    }


def probe_bj50() -> None:
    banner("探测北证50 代码")
    for code in BJ_CANDIDATES:
        try:
            r = probe_snapshot(code)
            print(f"  [{code}] UpHome={r['UpHome']} DownHome={r['DownHome']} "
                  f"Outside={r['Outside']} Inside={r['Inside']} Now={r['Now']} Name={r['Name']}")
        except Exception as e:
            print(f"  [{code}] 异常: {e}")


def probe_main_indices() -> dict:
    banner("step1: 主指数 + 板块指数快照")
    out = {}
    for code in INDEX_CODES:
        r = probe_snapshot(code)
        out[code] = r
        print(f"  [{code}] {r}")
    return out


def probe_full_market_today_zt() -> tuple[int, int, int, int, int]:
    """全市场 get_more_info,累加:
       - 今日首板: LastStartZT=1 AND EverZTCount=0
       - 今日连板: EverZTCount >= 1
       - max_lb, leader
       返回: (n, 首板数, 连板数, max_lb, leader_count)
    """
    codes = tq.get_stock_list()
    print(f"  全市场股票数: {len(codes)}")
    first_zt = 0
    lb_zt = 0
    max_lb = 0
    leaders = []
    t0 = time.time()
    for i, code in enumerate(codes, 1):
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            ls = int(info.get('LastStartZT') or 0)
            ec = int(info.get('EverZTCount') or 0)
            if ls == 1 and ec == 0:
                first_zt += 1
            if ec >= 1:
                lb_zt += 1
            if ec > max_lb:
                max_lb = ec
                leaders = [code]
            elif ec == max_lb and ec > 0:
                leaders.append(code)
        except Exception as e:
            print(f"  [{code}] 异常: {e}")
        if i % 1000 == 0:
            print(f"  进度 {i}/{len(codes)}  耗时 {time.time()-t0:.1f}s  "
                  f"首板={first_zt} 连板={lb_zt} max_lb={max_lb}")
    print(f"\n  === 统计 ===")
    print(f"  处理只数: {i}")
    print(f"  耗时: {time.time()-t0:.1f}s")
    print(f"  今日首板(LastStartZT=1, EverZTCount=0): {first_zt}")
    print(f"  今日连板(EverZTCount>=1): {lb_zt}")
    print(f"  最高连板: {max_lb}  股票(前5): {leaders[:5]}")
    return i, first_zt, lb_zt, max_lb, len(leaders)


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1

    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] {str(rc)[:80]}")
    except Exception as e:
        print(f"refresh_cache 失败: {e}")

    # step1: 主指数
    main_idx = probe_main_indices()

    # step2: 探测北证50
    probe_bj50()

    # step3: 全市场 get_more_info 测时 + 累加今日触板
    banner("step3: 全市场 get_more_info 累加今日触板")
    n, first_zt, lb_zt, max_lb, n_leaders = probe_full_market_today_zt()

    banner("汇总")
    print(f"  上证指数 [999999.SH] UpHome={main_idx['999999.SH']['UpHome']} DownHome={main_idx['999999.SH']['DownHome']}")
    print(f"  深证成指 [399001.SZ] UpHome={main_idx['399001.SZ']['UpHome']} DownHome={main_idx['399001.SZ']['DownHome']}")
    print(f"  今日首板: {first_zt}  今日连板: {lb_zt}  最高连板: {max_lb}板")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
