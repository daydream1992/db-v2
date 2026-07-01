"""01实盘监控 — 异动检测器(纯函数 + 内存状态)

每轮对每只票的快照跑 detect_all → 返回事件列表。

6 类检测:
  1. 涨速异动     |5分钟涨跌幅| ≥ 阈值(用 Before5MinNow)
  2. 涨跌幅触及   pct 穿越 ±3/±5/±7 关键位(用上一轮 pct 判穿越)
  3. 涨停封板/炸板 进入涨停封单 / 封板被砸开(critical)
  4. 量能放大     本轮 15 秒成交量 > 窗口均量 × 倍数
  5. 超买超卖     日内位置 + 涨速 + 内外盘 启发式
  6. 趋势反转     滑动窗口短长均线交叉 + "有势可反"

事件: {code, name, ts, type, severity, price, pct, detail}
状态: 每票一个 MonitorState(滑动窗口 + 上一轮快照), 跨轮询保留, 在线更新。
"""
from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field

import pandas as pd

from config import LABELS, THRESHOLDS, limit_up_pct


# ============ 派生指标 ============
def derive(snap, th: THRESHOLDS) -> dict:
    """快照 → 派生指标 dict(pct/涨停价/触涨停/5分钟涨跌/日内位置)"""
    code = str(snap["code"])
    now = float(snap["now"])
    last_close = float(snap["last_close"])
    hi = float(snap.get("max", now) or now)
    lo = float(snap.get("min", now) or now)
    before5 = snap.get("before5min_now")
    before5 = float(before5) if pd.notna(before5) else float("nan")

    pct = (now - last_close) / last_close * 100
    lim_pct = limit_up_pct(code)
    limit_up_price = round(last_close * (1 + lim_pct / 100), 2)
    limit_down_price = round(last_close * (1 - lim_pct / 100), 2)

    is_at_limit_up = ((now / limit_up_price - 1) * 100) >= -th.limit_touch_band
    is_at_limit_down = ((now / limit_down_price - 1) * 100) <= th.limit_touch_band

    min5_pct = ((now / before5 - 1) * 100) if (before5 and before5 > 0) else float("nan")
    rng = hi - lo
    day_pos = (now - lo) / rng if rng > 0 else 0.5

    return {
        "code": code, "now": now, "last_close": last_close,
        "pct": pct, "lim_pct": lim_pct,
        "limit_up_price": limit_up_price, "limit_down_price": limit_down_price,
        "is_at_limit_up": is_at_limit_up, "is_at_limit_down": is_at_limit_down,
        "min5_pct": min5_pct, "day_pos": day_pos,
    }


# ============ 每票内存状态 ============
@dataclass
class MonitorState:
    prices: deque = field(default_factory=deque)        # 价格序列(反转用)
    vol_deltas: deque = field(default_factory=deque)    # 每 15 秒成交量序列(量能用)
    last_pct: float = float("nan")
    last_volume: float = float("nan")
    last_limit_sealed: bool = False
    last_ma_s: float = float("nan")
    last_ma_l: float = float("nan")


def new_state(th: THRESHOLDS) -> MonitorState:
    w = max(th.vol_window, th.reversal_window) + 5
    return MonitorState(
        prices=deque(maxlen=w),
        vol_deltas=deque(maxlen=th.vol_window + 5),
    )


# ============ 6 类检测(各自返回 (etype, detail) 或 None) ============

def detect_surge(d: dict, th: THRESHOLDS):
    """涨速异动:5 分钟涨跌幅超阈值"""
    m = d["min5_pct"]
    if pd.notna(m) and abs(m) >= th.surge_5min_pct:
        t = "surge_up" if m > 0 else "surge_down"
        return (t, f"5分钟{m:+.2f}% (5分钟前{d['now'] / (1 + m / 100):.2f}→{d['now']:.2f})")
    return None


def detect_pct_level(d: dict, state: MonitorState, th: THRESHOLDS):
    """涨跌幅触及:pct 穿越关键位(用上一轮 pct 判定穿越, 再更新)"""
    pct = d["pct"]
    prev = state.last_pct
    state.last_pct = pct
    if pd.isna(prev):
        return None
    for lv in th.pct_levels_up:
        if prev < lv <= pct:
            return ("pct_level", f"涨幅上穿 {lv:.0f}%")
    for lv in th.pct_levels_down:
        if prev > lv >= pct:
            return ("pct_level", f"跌幅下穿 {lv:.0f}%")
    return None


def detect_limit(d: dict, snap, state: MonitorState, th: THRESHOLDS) -> list:
    """涨停封板(首次进入封板状态) / 炸板(封板后跌离涨停价)"""
    sellv = snap.get("sellv") or []
    sellv0 = float(sellv[0]) if len(sellv) > 0 and pd.notna(sellv[0]) else float("inf")
    sealed = d["is_at_limit_up"] and sellv0 <= th.limit_seal_sellv_max

    events: list = []
    if sealed and not state.last_limit_sealed:
        events.append(("limit_seal", f"封涨停 {d['limit_up_price']:.2f} 卖一余{sellv0:.0f}手"))
    if state.last_limit_sealed and not d["is_at_limit_up"]:
        events.append(("limit_break", f"炸板 现{d['now']:.2f} 涨停{d['limit_up_price']:.2f}"))
    state.last_limit_sealed = sealed
    return events


def detect_volume_surge(snap, d: dict, state: MonitorState, th: THRESHOLDS):
    """量能放大:本轮 15 秒成交量 > 窗口均量 × 倍数(用累计 volume 差分, 比现手稳)"""
    volume = float(snap.get("volume", 0) or 0)
    last = state.last_volume
    state.last_volume = volume
    delta = (volume - last) if (pd.notna(last) and volume >= last) else float("nan")
    if pd.notna(delta):
        state.vol_deltas.append(delta)
    hist = [x for x in state.vol_deltas if pd.notna(x)]
    if pd.isna(delta) or len(hist) < 4:
        return None
    prev_hist = hist[:-1][-th.vol_window:]
    if not prev_hist:
        return None
    avg = sum(prev_hist) / len(prev_hist)
    if avg > 0 and delta > avg * th.vol_surge_ratio:
        return ("volume_surge", f"15秒成交{delta:.0f}手 > 均量{avg:.0f}手×{th.vol_surge_ratio:.0f}")
    return None


def detect_overbought_oversold(snap, d: dict, th: THRESHOLDS):
    """超买超卖:日内位置 + 涨速 + 内外盘 启发式"""
    pos = d["day_pos"]
    m = d["min5_pct"]
    if pd.isna(m) or abs(m) < th.obos_min5_abs:
        return None  # 涨速平淡不判
    inside = float(snap.get("inside", 0) or 0)
    outside = float(snap.get("outside", 0) or 0)
    if pos >= th.overbought_pos and m > 0 and outside > inside:
        return ("overbought", f"日内{pos * 100:.0f}%位 涨速{m:+.2f}% 外盘{outside:.0f}>内盘{inside:.0f}")
    if pos <= th.oversold_pos and m < 0 and inside > outside:
        return ("oversold", f"日内{pos * 100:.0f}%位 涨速{m:+.2f}% 内盘{inside:.0f}>外盘{outside:.0f}")
    return None


def detect_capital_flow(diff: float, th: THRESHOLDS):
    """主力资金异动:3 分钟 ZLJE 差额(万元)超阈值 → 主力流入/流出。返回 (etype, detail) 或 None。

    diff>0 净流入, <0 净流出; 绝对值 < capital_min_abs 不报(过滤噪声)。
    """
    if pd.isna(diff) or abs(diff) < th.capital_min_abs:
        return None
    if diff >= th.capital_inflow_wan:
        return ("capital_in", f"3分钟主力净流入{diff:+.0f}万")
    if diff <= -th.capital_outflow_wan:
        return ("capital_out", f"3分钟主力净流出{diff:+.0f}万")
    return None


def detect_reversal(d: dict, state: MonitorState, th: THRESHOLDS):
    """趋势反转:窗口短长均线交叉, 且窗口有足够涨跌幅(有势可反)"""
    state.prices.append(d["now"])
    ps = list(state.prices)
    if len(ps) < th.reversal_window:
        return None
    window = ps[-th.reversal_window:]
    ma_s = sum(window[-th.reversal_ma_short:]) / th.reversal_ma_short
    ma_l = sum(window[-th.reversal_ma_long:]) / th.reversal_ma_long
    swing = (window[-1] / window[0] - 1) * 100  # 窗口累计涨跌幅

    prev_s, prev_l = state.last_ma_s, state.last_ma_l
    state.last_ma_s, state.last_ma_l = ma_s, ma_l
    if pd.isna(prev_s) or pd.isna(prev_l):
        return None
    if abs(swing) < th.reversal_min_swing:
        return None  # 无势可反

    crossed_up = prev_s <= prev_l and ma_s > ma_l    # 短均线上穿(跌转涨)
    crossed_down = prev_s >= prev_l and ma_s < ma_l  # 短均线下穿(涨转跌)
    if crossed_up and swing < 0:
        return ("reversal_up", f"跌势反转 短均{ma_s:.2f}上穿长均{ma_l:.2f} (窗口{swing:+.2f}%)")
    if crossed_down and swing > 0:
        return ("reversal_down", f"涨势反转 短均{ma_s:.2f}下穿长均{ma_l:.2f} (窗口{swing:+.2f}%)")
    return None


# ============ 总入口 ============
def detect_all(snap, state: MonitorState, th: THRESHOLDS, name: str, ts) -> list[dict]:
    """对一只票跑全部检测 → 事件列表。snap: pd.Series/dict。state 就地更新。"""
    d = derive(snap, th)
    fired: list = []
    fired.append(detect_surge(d, th))
    fired.append(detect_pct_level(d, state, th))
    fired.extend(detect_limit(d, snap, state, th))
    fired.append(detect_volume_surge(snap, d, state, th))
    fired.append(detect_overbought_oversold(snap, d, th))
    fired.append(detect_reversal(d, state, th))

    events: list[dict] = []
    for item in fired:
        if not item:
            continue
        etype, detail = item
        lab = LABELS[etype]
        events.append({
            "code": d["code"], "name": name, "ts": ts,
            "type": etype, "severity": lab.severity,
            "price": d["now"], "pct": d["pct"], "detail": detail,
        })
    return events


def is_price_sane(snap) -> bool:
    """快照价格合理性(过滤停牌/盘前 Now=0 已在 data 层做过, 二次保险)"""
    try:
        return float(snap["now"]) > 0 and float(snap["last_close"]) > 0
    except (TypeError, ValueError, KeyError):
        return False
