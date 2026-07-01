#!/usr/bin/env python3
"""tes_020_sentiment — 大盘情绪监测探针
    用途:验证 get_market_snapshot(指数) + get_more_info(全市场) 的实测数据形态
    目标:1) 沪深家数/涨停跌停  2) 全市场 EverZTCount max  3) 跑通时间
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name
INDEX_CODES = ['000001.SH', '399001.SZ']  # 上证 / 深证


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def probe_index_snapshot() -> dict:
    """1) 沪深指数快照,拿涨跌家数/涨停跌停"""
    out = {}
    for code in INDEX_CODES:
        snap = tq.get_market_snapshot(stock_code=code, field_list=[])
        out[code] = {
            'UpHome': snap.get('UpHome'),
            'DownHome': snap.get('DownHome'),
            'Outside': snap.get('Outside'),  # 板块指数时=涨停家数
            'Inside': snap.get('Inside'),    # 板块指数时=跌停家数
            'Now': snap.get('Now'),
            'ErrorId': snap.get('ErrorId'),
        }
        print(f"  [{code}] {out[code]}")
    return out


def probe_get_more_info(code: str) -> dict:
    """2) 单股 more_info,验证连板字段是否存在"""
    info = tq.get_more_info(stock_code=code, field_list=[])
    keys_of_interest = ['LastStartZT', 'LastZTHzNum', 'EverZTCount',
                        'ConZAFDateNum', 'YearZTDay']
    return {k: info.get(k) for k in keys_of_interest}


def probe_full_market(max_seconds: int = 60) -> tuple[int, int, list]:
    """3) 全市场循环 get_more_info,拿 max(EverZTCount)
       返回: (处理只数, 最高连板, 最高连板股票列表)
       限时 max_seconds 防客户端卡死
    """
    codes = tq.get_stock_list()
    print(f"  全市场股票数: {len(codes)}")
    max_lb = 0
    lb_leaders = []
    t0 = time.time()
    for i, code in enumerate(codes, 1):
        if time.time() - t0 > max_seconds:
            print(f"  达到 {max_seconds}s 上限,中断在第 {i}/{len(codes)} 只")
            break
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            lb = int(info.get('EverZTCount') or 0)
            if lb > max_lb:
                max_lb = lb
                lb_leaders = [code]
            elif lb == max_lb and lb > 0:
                lb_leaders.append(code)
        except Exception as e:
            print(f"  [{code}] 异常: {e}")
        if i % 500 == 0:
            print(f"  进度 {i}/{len(codes)}  耗时 {time.time()-t0:.1f}s  当前 max_lb={max_lb}")
    print(f"  完成 {i} 只  耗时 {time.time()-t0:.1f}s  max_lb={max_lb}  leader={lb_leaders[:5]}")
    return i, max_lb, lb_leaders


def main() -> int:
    banner("initialize")
    try:
        tq.initialize(__file__)
    except Exception as e:
        print(f"FAIL init: {e}")
        return 1

    # 行情预热
    try:
        rc = tq.refresh_cache(market='AG', force=True)
        print(f"[refresh_cache AG] {str(rc)[:80]}")
    except Exception as e:
        print(f"refresh_cache 失败(可忽略): {e}")

    banner("step1: 沪深指数快照")
    snap = probe_index_snapshot()
    # 加和示例
    up_total = sum(int(v['UpHome'] or 0) for v in snap.values())
    down_total = sum(int(v['DownHome'] or 0) for v in snap.values())
    zt_total = sum(int(v['Outside'] or 0) for v in snap.values())
    dt_total = sum(int(v['Inside'] or 0) for v in snap.values())
    print(f"  沪深合计: 涨={up_total} 跌={down_total} 涨停={zt_total} 跌停={dt_total}")

    banner("step2: 单股 more_info 字段验证")
    sample = '600635.SH'  # 选个老牌主板
    fields = probe_get_more_info(sample)
    print(f"  [{sample}] {fields}")

    banner("step3: 全市场 5000 只 get_more_info 测时")
    n, max_lb, leaders = probe_full_market(max_seconds=60)

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
