#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""index_monitor.py — 大盘层(定仓位)
    5 指数采集 + 背离检测 + 情绪评级 + 北向资金/期指升贴水(可选 stub)
    阈值见 _common.TH(用户填 __TODO__)
"""
from __future__ import annotations
from typing import Any
import _common
from _common import TH, _f


def collect(tq) -> dict[str, dict]:
    """采集 5 指数:snapshot(涨跌家数+Max) + more_info(涨幅/主力/动量/开盘金额)"""
    out = {}
    for code in _common.INDEX_CODES:
        row = {'code': code}
        try:
            snap = tq.get_market_snapshot(stock_code=code, field_list=[])
            row['up'] = int(_f(snap, 'UpHome'))
            row['down'] = int(_f(snap, 'DownHome'))
            row['now'] = _f(snap, 'Now')
            row['amount'] = _f(snap, 'Amount')      # 成交额(大盘用,判价量背离)
        except Exception:
            row['up'] = row['down'] = 0; row['now'] = row['amount'] = 0.0
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            row['zaf'] = _f(info, 'ZAF')            # 当日涨幅%
            row['zjl'] = _f(info, 'Zjl')            # 主力净额万
            row['zaf_pre5'] = _f(info, 'ZAFPre5')
            row['zaf_pre20'] = _f(info, 'ZAFPre20')
            row['zaf_pre60'] = _f(info, 'ZAFPre60')
            row['open_amo'] = _f(info, 'OpenAmo')
            row['cjje_pre1'] = _f(info, 'CJJEPre1') # 昨成交额(价量背离基准)
        except Exception:
            for k in ['zaf', 'zjl', 'zaf_pre5', 'zaf_pre20', 'zaf_pre60', 'open_amo', 'cjje_pre1']:
                row[k] = 0.0
        out[code] = row
    return out


# ─── 北向资金 / 期指升贴水(已实测 tes_042/043/044,字段确认)───
def collect_north_money(tq) -> float | None:
    """北向资金当日净流入(亿元)。实测(tes_042):
       get_scjy_value(['SC8']) 返历史序列,每条 Value=[累计余额, 当日净流入],取最新 Value[1]。
       ⚠️ SC 系列 = T-1 盘后(2024-08 起交易所停披露盘中实时),盘中取到的是上一交易日,仅参考。
       ⚠️ 单位量级判为亿元(文档标"万元"不准:实测 Value[1] ±百亿级、累计 2.8 万亿级)。"""
    try:
        res = tq.get_scjy_value(field_list=['SC8'])
        series = res.get('SC8') if isinstance(res, dict) else None
        if isinstance(series, list) and series:
            last = series[-1]
            val = last.get('Value') if isinstance(last, dict) else None
            if isinstance(val, list) and len(val) >= 2:
                return float(val[1])
    except Exception:
        return None
    return None


def _next_yyyymm(yyyymm: str, step: int = 1) -> str:
    """YYMM 月份推进(step 可为 0/1/2),跨年自动滚。"""
    y, m = int(yyyymm[:2]), int(yyyymm[2:])
    m += step
    while m > 12:
        m -= 12
        y += 1
    return f"{y:02d}{m:02d}"


def collect_futures_basis(tq) -> float | None:
    """IF 主力合约基差 = 沪深300现指 − IF当月期货(指数点,正=升水 / 负=贴水)。
       实测(tes_043/044):
         - 连续代码 IF300.CFF 是现指别名(snapshot.Now == 000300.Now,基差恒 0),不可用
         - 合约代码 IF{YYMM}.CFF 才是真期货价(IF2607/IF2608 Now 有效;已到期合约 server none)
         - 主力 = 当月+次月+下下月中 snapshot.Volume 最大者(自动处理当月到期切月)
       盘中实时(snapshot,非 T-1)。"""
    import datetime as dt
    ym0 = dt.date.today().strftime('%y%m')
    cands = [f"IF{_next_yyyymm(ym0, k)}.CFF" for k in (0, 1, 2)]
    try:
        spot_snap = tq.get_market_snapshot(stock_code='000300.SH', field_list=[])
        spot = _f(spot_snap, 'Now')
    except Exception:
        return None
    if spot <= 0:
        return None
    best_vol, best_now = -1.0, 0.0
    for code in cands:
        try:
            snap = tq.get_market_snapshot(stock_code=code, field_list=[])
            now = _f(snap, 'Now')
            vol = _f(snap, 'Volume')
        except Exception:
            continue
        if now > 0 and vol > best_vol:
            best_vol, best_now = vol, now
    if best_now <= 0:
        return None
    return round(spot - best_now, 2)


# ─── 背离检测 ───
def detect_divergence(idx: dict, north: float | None, futures: float | None) -> list[str]:
    """检测 5 指数的背离信号。返信号列表"""
    sigs = []
    for code, r in idx.items():
        zaf = r['zaf']
        if zaf <= TH.DIV_INDEX_UP:
            continue  # 没涨不判背离
        # 价宽背离:涨但涨跌比低
        udr = r['up'] / r['down'] if r['down'] > 0 else 999
        if udr < TH.DIV_BREADTH_LOW:
            sigs.append(f"{code} 价宽背离:涨{zaf}%但涨跌比{udr:.2f}")
        # 价资背离:涨但主力流出
        if r['zjl'] < TH.DIV_FLOW_OUT:
            sigs.append(f"{code} 价资背离:涨{zaf}%但主力净流出{r['zjl']:.0f}万")
        # 价量背离:涨但成交额较昨缩
        if r['cjje_pre1'] > 0:
            shrink = 1 - (r['amount'] / r['cjje_pre1']) if r['cjje_pre1'] > 0 else 0
            if shrink > TH.DIV_VOL_SHRINK:
                sigs.append(f"{code} 价量背离:涨{zaf}%但成交较昨缩{shrink*100:.0f}%")
    # 北向隐性背离(T-1 数据,参考性):净流出
    if north is not None and north < TH.DIV_FLOW_OUT:
        sigs.append(f"北向背离:净流出{abs(north):.1f}亿(指数坚挺但外资撤退,T-1)")
    # 期指贴水背离:基差显著为负(期货看空)
    if futures is not None and futures < TH.DIV_FUTS_DISCOUNT:
        sigs.append(f"期指贴水:基差{futures:.1f}点(指数坚挺但期货看空)")
    return sigs


# ─── 情绪评级(5档)───
def _bin(value: float, bins: list[float], labels: list[str]) -> str:
    for i, b in enumerate(bins):
        if value <= b:
            return labels[i]
    return labels[-1]


def rate_emotion(zt_cnt: int, fengban_rate: float, max_lb: int, udr: float) -> dict:
    """综合涨停数/封板率/最高连板/涨跌比 → 评级。
       4 指标各评 1 档,取众数或最差档为最终评级"""
    labels = ['冰点', '低迷', '中性', '活跃', '过热']
    grades = [
        _bin(zt_cnt, TH.EMOTION_ZT_BIN, labels),
        _bin(fengban_rate, TH.EMOTION_FBL_BIN, labels),
        _bin(max_lb, TH.EMOTION_LB_BIN, labels),
        _bin(udr, TH.EMOTION_UDR_BIN, labels),
    ]
    # 取最差档(保守):冰点<低迷<中性<活跃<过热
    order = {lb: i for i, lb in enumerate(labels)}
    worst = min(grades, key=lambda g: order[g])
    return {
        'rating': worst,
        'detail': {
            '涨停数': f"{zt_cnt}→{grades[0]}",
            '封板率': f"{fengban_rate}%→{grades[1]}",
            '最高连板': f"{max_lb}→{grades[2]}",
            '涨跌比': f"{udr:.2f}→{grades[3]}",
        }
    }
