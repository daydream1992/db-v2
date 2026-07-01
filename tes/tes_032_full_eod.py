#!/usr/bin/env python3
"""tes_032_full_eod — 盘后情绪全量探针
    1) ZTG 公式 0.02s 拿涨/跌/涨停/跌停/成交额
    2) get_scjy_value(['SC15']) 拿封板成功/失败资金
    3) get_bkjy_value 588 板块,拿板块层 BK9/BK12/BK13/BK14
    4) get_more_info 循环 5533 只,拿 max(EverZTCount) + 连板股列表
    5) get_market_data 全市场今/昨价,Python 算炸板数(4 套阈值)
    全部测耗时
"""
from __future__ import annotations
import sys
import time
from pathlib import Path

sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
from tqcenter import tq  # noqa: E402

THIS = Path(__file__).name


def banner(msg: str) -> None:
    print(f"\n=== {THIS} :: {msg} ===", flush=True)


def step1_ztg_formula() -> dict:
    banner("step1: ZTG 公式 拿全市场 涨/跌/涨停/跌停/成交额")
    t0 = time.time()
    res = tq.formula_process_mul_zb(
        formula_name='ZTG',
        formula_arg='',
        return_count=1,
        return_date=True,
        stock_list=['999999.SH'],
        stock_period='1d',
        start_time='20260701',
        end_time='20260701',
        count=1,
        dividend_type=0,
    )
    elapsed = time.time() - t0
    blk = res.get('999999.SH', {})
    out = {}
    for k, v in blk.items():
        if isinstance(v, list) and v:
            val = v[-1].get('Value')
            if val and val != '0.00':
                out[k] = val
    print(f"  耗时 {elapsed:.2f}s  ErrorId={res.get('ErrorId')}")
    print(f"  字段: {out}")
    return out


def step2_scjy() -> dict:
    banner("step2: get_scjy_value(['SC15']) 封板资金")
    t0 = time.time()
    res = tq.get_scjy_value(field_list=['SC15'])
    elapsed = time.time() - t0
    v = res.get('SC15', [])
    last = v[-1] if v else None
    print(f"  耗时 {elapsed:.2f}s  SC15 last={last!r}")
    return {'SC15': last}


def step3_bkjy(sectors: list) -> dict:
    banner(f"step3: get_bkjy_value {len(sectors)} 板块")
    t0 = time.time()
    res = tq.get_bkjy_value(
        stock_list=sectors,
        field_list=['BK9', 'BK12', 'BK13', 'BK14'],
        start_time='20260629',
        end_time='20260701',
    )
    elapsed = time.time() - t0
    print(f"  耗时 {elapsed:.2f}s  顶层 keys 数={len(res)}")
    return res


def step4_more_info(codes: list) -> tuple:
    banner(f"step4: get_more_info 循环 {len(codes)} 只")
    t0 = time.time()
    max_lb = 0
    leaders = []
    n_lb = 0
    for i, code in enumerate(codes, 1):
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            ec = int(info.get('EverZTCount') or 0)
            if ec >= 1:
                n_lb += 1
            if ec > max_lb:
                max_lb = ec
                leaders = [code]
            elif ec == max_lb and ec > 0:
                leaders.append(code)
        except Exception:
            pass
        if i % 1000 == 0:
            print(f"  进度 {i}/{len(codes)}  {time.time()-t0:.1f}s  max_lb={max_lb} n_lb={n_lb}")
    elapsed = time.time() - t0
    print(f"  耗时 {elapsed:.1f}s  max_lb={max_lb} 连板股数={n_lb} leaders={leaders[:5]}")
    return max_lb, leaders, n_lb


def step5_market_data(codes: list) -> dict:
    """全市场今/昨价,Python 算炸板数(主板10%/创20%/科20%/北30%)"""
    banner(f"step5: get_market_data {len(codes)} 只 算炸板")
    t0 = time.time()
    res = tq.get_market_data(
        field_list=['Open', 'High', 'Low', 'Close'],
        stock_list=codes,
        period='1d',
        start_time='20260630',
        end_time='20260701',
        count=2,
        dividend_type=0,  # 不复权,贴近真实涨跌停
    )
    elapsed = time.time() - t0
    print(f"  get_market_data 耗时 {elapsed:.1f}s")
    if not isinstance(res, dict):
        return {'zt': 0, 'zha_ban': 0, 'dt': 0, 'elapsed': elapsed}
    close = res.get('Close')
    high = res.get('High')
    if close is None or high is None or close.empty:
        return {'zt': 0, 'zha_ban': 0, 'dt': 0, 'elapsed': elapsed}
    # close: 行=日期,列=code; 取最后 2 行
    if len(close) < 2:
        return {'zt': 0, 'zha_ban': 0, 'dt': 0, 'elapsed': elapsed}
    today = close.iloc[-1]
    yesterday = close.iloc[-2]
    today_high = high.iloc[-1]
    pct = (today - yesterday) / yesterday
    zt, zha_ban, dt = 0, 0, 0
    for code in close.columns:
        if code not in pct.index:
            continue
        p = pct[code]
        h = today_high.get(code, 0)
        c = today.get(code, 0)
        y = yesterday.get(code, 0)
        if y <= 0 or c <= 0 or h <= 0:
            continue
        # 阈值
        if code.startswith(('300', '301')):
            th_zt, th_dt = 0.199, -0.199
        elif code.startswith(('688', '689')):
            th_zt, th_dt = 0.199, -0.199
        elif code.endswith('.BJ'):
            th_zt, th_dt = 0.299, -0.299
        else:
            th_zt, th_dt = 0.098, -0.098
        if p >= th_zt:
            zt += 1
            if h > c * (1 + 0.001):  # 触过涨停价但没收在涨停
                zha_ban += 1
        elif p <= th_dt:
            dt += 1
    elapsed_all = time.time() - t0
    print(f"  涨停={zt} 炸板={zha_ban} 跌停={dt}  耗时 {elapsed_all:.1f}s")
    return {'zt': zt, 'zha_ban': zha_ban, 'dt': dt, 'elapsed': elapsed_all}


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

    ztg = step1_ztg_formula()
    scjy = step2_scjy()
    sectors = tq.get_sector_list(list_type=0)
    print(f"\n  板块数: {len(sectors)}")
    bkjy = step3_bkjy(sectors)
    codes = tq.get_stock_list()
    print(f"\n  股票数: {len(codes)}")
    max_lb, leaders, n_lb = step4_more_info(codes)
    md = step5_market_data(codes)

    banner("汇总")
    print(f"  ZTG 公式:  {ztg}")
    print(f"  SCJY:      {scjy}")
    print(f"  BKJY:      {len(bkjy)} 板块")
    print(f"  连板:      max_lb={max_lb} 连板股数={n_lb}")
    print(f"  K线算:     涨停={md['zt']} 炸板={md['zha_ban']} 跌停={md['dt']}")

    banner("done")
    tq.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())