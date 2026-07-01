#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""stock_monitor.py — 个股层(定标的)
    6 个池子:连板梯队 / 首板(含首封时间) / 龙头 / 炸板风险 / 易炸预警 / 跌停池(含A杀断板)
    阈值见 _common.TH(用户填 __TODO__)
"""
from __future__ import annotations
import datetime as dt
from typing import Any
import _common
from _common import TH, _f, classify_stock


def collect(tq, codes: list[str], state, ts: str) -> dict:
    """采集全市场,分 6 池。
       state: StateCache(首封时间/断板跟踪)
       ts: 当前帧时间戳 'HH:MM:SS'
    """
    pools = {
        '连板梯队': [], '首板': [], '龙头': [],
        '炸板风险': [], '易炸预警': [], '跌停池': [],
    }
    cur_lb_codes = set()
    broken_from_prev = state.prev_lb_leaders  # 上帧连板股(检测断板)

    for code in codes:
        try:
            info = tq.get_more_info(stock_code=code, field_list=[]) or {}
        except Exception:
            info = {}
        fcamo = _f(info, 'FCAmo')
        zt_price = _f(info, 'ZTPrice')
        ec = int(_f(info, 'EverZTCount'))
        fcb = _f(info, 'FCb')
        zjl = _f(info, 'Zjl')
        zaf = _f(info, 'ZAF')
        last_start_zt = int(_f(info, 'LastStartZT'))  # 几天前涨停(=1=昨日涨停)
        last_hz_num = int(_f(info, 'LastZTHzNum'))    # 昨日几板

        # 当日 Max(判炸板用)
        day_max = 0.0
        try:
            snap = tq.get_market_snapshot(stock_code=code, field_list=[])
            day_max = _f(snap, 'Max')
        except Exception:
            pass

        st = classify_stock(fcamo, day_max, zt_price)
        base = {'code': code, 'lb': ec, 'zaf': zaf, 'fcamo': fcamo, 'fcb': fcb, 'zjl': zjl,
                'state': st, 'last_start_zt': last_start_zt, 'last_hz_num': last_hz_num}

        # 首封时间记录(FCAmo 首次 >0)
        state.record_first_zt(code, fcamo, ts)

        # ── 分池 ──
        if st == '涨停':
            if ec == 1:
                # 首板池(今日首板 = EverZTCount==1)
                base['first_zt_time'] = state.first_zt_time.get(code, '')
                pools['首板'].append(base)
            elif ec >= 2:
                cur_lb_codes.add(code)
                pools['连板梯队'].append(base)
            # 易炸预警:涨停但封单弱/封成比低
            if fcb < TH.STOCK_WEAKFCB_FC or fcamo < TH.STOCK_WEAKFCA:
                pools['易炸预警'].append(base)
        elif st == '炸板':
            pools['炸板风险'].append(base)
        elif st == '跌停':
            base['zaf_pre1'] = zaf  # 今日跌幅
            # A杀 flag:昨日涨停(LastStartZT==1)今日跌停 / 或昨日连板(LastHzNum>=2)今日大跌
            base['a_sha'] = (last_start_zt == 1) or (last_hz_num >= 2 and zaf <= TH.STOCK_BREAK_DROP)
            pools['跌停池'].append(base)  # 所有跌停都进(退潮信号),A杀靠 flag 标

    # 龙头:连板梯队中 封单Top + 主力流入
    lb_sorted = sorted(pools['连板梯队'], key=lambda x: (-x['lb'], -x['fcamo']))
    pools['龙头'] = [r for r in lb_sorted
                     if r['fcamo'] >= TH.STOCK_LEADER_FCA and r['zjl'] > 0][:20]

    # 更新连板断板跟踪
    state.update_lb_leaders(cur_lb_codes)

    return pools


def split_tiers(lb_pool: list[dict]) -> dict[int, list[dict]]:
    """连板梯队按板数分层 [2板/3板/4-6板/7+板]"""
    tiers = {n: [] for n in TH.STOCK_LB_TIERS}
    for r in lb_pool:
        lb = r['lb']
        placed = False
        for t in TH.STOCK_LB_TIERS:
            if lb == t or (t == TH.STOCK_LB_TIERS[-1] and lb >= t):
                tiers[t].append(r); placed = True; break
        if not placed and lb >= TH.STOCK_LB_TIERS[0]:
            tiers[TH.STOCK_LB_TIERS[0]].append(r)
    return tiers
