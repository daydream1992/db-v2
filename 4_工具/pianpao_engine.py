#!/usr/bin/env python3
"""全维度量价陷阱与生命周期分析引擎 (pianpao_engine v2)

从「骗炮识别器」升级为「全维度量价陷阱与生命周期分析引擎」：
  - 诱多(Bull)/诱空(Bear) 双向陷阱:
      分时级(1m): 诱多 5 型 + 诱空 5 型 (尾盘偷鸡板 / 早盘冲高回落 / ... )
      日线级    : 诱多 2 型 + 诱空 2 型 (假突破 / 放量滞涨 / 均线假破位 / 缩量深跌)
  - 生命周期打标: 主升浪 / 吸筹 / 洗盘 / 派发 / 下跌 / 震荡  ↔ 策略映射

数据源:
  stock_daily_kline (OHLCV) + stock_daily_turnover (换手率/涨跌幅) +
  stock_kline_1m (分时) + dim_security_type (A股全集)

写入: pianpao_daily(主) + pianpao_intraday/events/periods(分时) +
      pianpao_daily_summary

性能主线 (针对 stock_kline_1m 2.83亿行, 防OOM):
  日级全量向量化(5257股×~100日) → 日级预筛候选 → 仅候选批量取1m(groupby分发)
  → register+INSERT SELECT 批量写 (消除N+1与单行INSERT)

注: con 由外部(70/71)注入, 引擎不直连 DB, 无模块级 DB_PATH。
"""
# ---
# @meta table=pianpao_daily cn=骗炮每日明细 dir=2_计算 sort=070
# @meta schedule=daily mode=increment source=SQL派生

import sys
from pathlib import Path
from dataclasses import dataclass, replace, field
from datetime import datetime, timedelta
import duckdb
import pandas as pd
import numpy as np
from loguru import logger

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ==================== 配置 ====================

@dataclass(frozen=True)
class Config:
    """所有阈值集中于此, 可调。"""
    # —— 基底骗炮 ——
    min_gap_up: float = 3.0            # 高开低走: 最小高开幅度%
    minute_levels: tuple = ('S级', 'A级')   # 拉取1分钟K线的等级(保留V1, 现按候选预筛)
    # —— 涨停/连板/封板 ——
    zt_close_pct: float = 0.997        # 收盘≥zt*0.997 视为涨停(连板计数)
    zt_touch_pct: float = 0.995        # 1m high≥zt*0.995 视为摸板(封板/炸板代理)
    # —— 诱多(分时) ——
    waterfall_speed: float = -1.0      # 一字瀑布杀: 单根最大跌幅 ≤ -1.0 %/min
    late_sneak_seal: float = 0.2       # 尾盘偷鸡板: 封板时长占比 < 0.2(代理封单小)
    # —— 诱多(日线) ——
    breakout_vol_ratio: float = 1.5    # 假突破: 放量倍数(量比)
    long_shadow: float = 2.0           # 长上影阈值%
    breakout_pullback: float = 0.98    # 假突破: 收盘≥日内最高*0.98(看似强突破)
    # —— 诱空(日线) ——
    deep_drop_pct: float = -5.0        # 缩量深跌: 单日跌幅%
    wash_vol_ratio: float = 0.8        # 缩量深跌: 量比<
    # —— 生命周期 ——
    uptrend_vol_days: int = 4          # 主升浪: 近5日放量(量>20日均量)天数≥
    pulse_vol_std: float = 0.6         # 派发: 近5日量比标准差(脉冲式发散)>
    amp_accumulation: float = 15.0     # 吸筹: 20日振幅<
    vol_shrink_accum: float = 0.5      # 吸筹: 近5日均量/近20日均量 <
    dev_ma20_dist: float = 15.0        # 派发: 偏离MA20% >
    up_shadow_cnt_dist: int = 2        # 派发: 近5日上影线天数≥
    # —— V1 急涨急跌分级 ——
    rapid_thresholds: dict = field(
        default_factory=lambda: {'极速': (1, 2.0), '快速': (3, 1.5), '温和': (5, 1.0)})

    def copy(self) -> 'Config':
        return replace(self)


DEFAULT_CONFIG = Config()

# 依赖T+1确认的陷阱类型(实时跑当天=待确认NULL, 回测才终判)
PENDING_TRAPS = ('假突破', '均线假破位')


# ==================== 工具函数 ====================

def calc_zt_price(prev_close: float, code: str) -> float:
    """涨停价: 主板10%, 创业板/科创板20%。code 形如 '300001.SZ'/'688001.SH'。"""
    if code.startswith('68') or code.startswith('30'):
        return round(prev_close * 1.2, 2)
    return round(prev_close * 1.1, 2)


def severity_level(severity: float, gap_up_pct: float) -> str:
    if severity >= 10 or gap_up_pct >= 7:
        return 'S级'
    if severity >= 6 or gap_up_pct >= 5:
        return 'A级'
    if severity >= 4:
        return 'B级'
    return 'C级'


def short_time(time_str) -> str:
    if not time_str:
        return ''
    if isinstance(time_str, str) and len(time_str) >= 16:
        return time_str[11:16]
    if hasattr(time_str, 'strftime'):
        return time_str.strftime('%H:%M')
    return str(time_str)


def limit_factor(code: str) -> float:
    return 1.2 if (code.startswith('68') or code.startswith('30')) else 1.1


def _iso(target_date: str) -> str:
    return f"{target_date[:4]}-{target_date[4:6]}-{target_date[6:]}"


def _date(target_date: str):
    return datetime.strptime(target_date, '%Y%m%d').date()


def _trailing_streak(bool_series: pd.Series) -> pd.Series:
    """截至当日的连续True计数(用于连板数)。"""
    out, run = [], 0
    for v in bool_series.tolist():
        run = run + 1 if v else 0
        out.append(run)
    return pd.Series(out, index=bool_series.index)


def _ph(n: int) -> str:
    """生成 n 个参数的单层占位符: (?,?,...,?)。"""
    return "(" + ",".join(["?"] * n) + ")"


# ==================== 数据层 (con 注入, 纯读) ====================

def load_universe(con) -> list:
    """A股候选 (主板/创业板/科创板, active, 排除ST/退)。code 带交易所后缀。"""
    sql = """
    SELECT DISTINCT code
    FROM dim_security_type
    WHERE type IN ('沪市主板', '深市主板', '创业板', '科创板')
      AND is_active = TRUE
      AND code NOT LIKE '%ST%'
      AND code NOT LIKE '%退%'
    ORDER BY code
    """
    codes = con.execute(sql).fetchdf()['code'].tolist()
    logger.info(f"  A股候选: {len(codes)} 只")
    return codes


def load_daily_window(con, codes, target_date, lookback_days: int = 60) -> pd.DataFrame:
    """一条SQL批量取目标日+前N日日K, LEFT JOIN 换手率。"""
    dd = _iso(target_date)
    start = (_date(target_date) - timedelta(days=int(lookback_days * 2.5))).isoformat()
    # 右沿+7天: 让 target 的 T+1(假突破/均线假破位确认)进入窗口; 最新日无T+1则pending
    end = (_date(target_date) + timedelta(days=7)).isoformat()
    if not codes:
        return pd.DataFrame()
    # 分批构造 IN 列表 (DuckDB 单次参数上限友好)
    parts = []
    for i in range(0, len(codes), 900):
        chunk = codes[i:i + 900]
        in_list = ",".join(f"'{c}'" for c in chunk)
        parts.append(f"""
            SELECT d.code, d.date, d.open, d.high, d.low, d.close, d.volume, d.amount,
                   t.turnover, t.pct_chg
            FROM stock_daily_kline d
            LEFT JOIN stock_daily_turnover t USING (code, date)
            WHERE d.date BETWEEN DATE '{start}' AND DATE '{end}'
              AND d.code IN ({in_list})
        """)
    sql = " UNION ALL ".join(parts) + " ORDER BY code, date"
    df = con.execute(sql).fetchdf()
    if not df.empty:
        df['date'] = pd.to_datetime(df['date']).dt.date
    return df


def load_1m_batch(con, codes, target_date) -> pd.DataFrame:
    """一条SQL批量取候选当日1m (消除N+1)。候选级, 内存安全。"""
    dd = _iso(target_date)
    if not codes:
        return pd.DataFrame()
    in_list = ",".join(f"'{c}'" for c in codes)
    sql = f"""
      SELECT code, trade_time, open, high, low, close, volume, amount
      FROM stock_kline_1m
      WHERE DATE(trade_time) = DATE '{dd}'
        AND code IN ({in_list})
      ORDER BY code, trade_time
    """
    return con.execute(sql).fetchdf()


# ==================== 特征层 (纯函数) ====================

def compute_daily_features(d: pd.DataFrame, cfg: Config = DEFAULT_CONFIG) -> pd.DataFrame:
    """日级全量向量化特征 (就地加列)。d 需含 code/date/OHLC/volume(+turnover)。"""
    d = d.sort_values(['code', 'date']).reset_index(drop=True)
    g = d.groupby('code', group_keys=False)
    d['prev_close'] = g['close'].shift(1)

    # 均线 / 量比
    for w in (5, 10, 20, 60):
        d[f'ma{w}'] = g['close'].transform(lambda s, w=w: s.rolling(w, min_periods=w).mean())
    d['vol_avg5'] = g['volume'].transform(lambda s: s.shift(1).rolling(5, min_periods=3).mean())
    d['vol_ratio'] = d['volume'] / d['vol_avg5']                       # 量比(放量/缩量代理)
    d['vol20'] = g['volume'].transform(lambda s: s.rolling(20, min_periods=10).mean())

    # 涨跌幅 / 形态
    d['change_pct'] = (d['close'] - d['prev_close']) / d['prev_close'] * 100
    d['gap_up'] = (d['open'] - d['prev_close']) / d['prev_close'] * 100
    d['open_to_close'] = (d['close'] - d['open']) / d['open'] * 100
    d['amplitude'] = (d['high'] - d['low']) / d['prev_close'] * 100
    body_max = d[['open', 'close']].max(axis=1)
    body_min = d[['open', 'close']].min(axis=1)
    d['upper_shadow'] = (d['high'] - body_max) / d['prev_close'] * 100
    d['lower_shadow'] = (body_min - d['low']) / d['prev_close'] * 100

    # 区间涨跌 / 支撑 / 偏离
    d['gain_10d'] = (d['close'] / g['close'].shift(10) - 1) * 100
    d['gain_60d'] = (d['close'] / g['close'].shift(60) - 1) * 100
    d['high_20d_prior'] = g['high'].transform(lambda s: s.shift(1).rolling(20, min_periods=10).max())
    d['low_20d_prior'] = g['low'].transform(lambda s: s.shift(1).rolling(20, min_periods=10).min())
    d['dev_ma20'] = (d['close'] - d['ma20']) / d['ma20'] * 100

    # 涨停 / 连板数 / 触板
    d['zt_price'] = d['prev_close'] * d['code'].map(limit_factor)
    d['is_zt'] = (d['close'] >= d['zt_price'] * cfg.zt_close_pct).fillna(False)
    d['zt_streak'] = g['is_zt'].transform(_trailing_streak)
    d['touched_zt'] = (d['high'] >= d['zt_price'] * cfg.zt_touch_pct).fillna(False)
    d['zt_distance'] = (d['zt_price'] - d['open']) / d['open'] * 100

    # T+1 (假突破/均线假破位 确认用; 最新日为NaN=待确认)
    d['next_open'] = g['open'].shift(-1)
    d['next_high'] = g['high'].shift(-1)
    d['next_close'] = g['close'].shift(-1)
    d['next_chg'] = (d['next_close'] - d['close']) / d['close'] * 100

    # 前置形态 (兼容V1字段)
    d['prev1_change'] = g['change_pct'].shift(1)
    d['prev3_total_change'] = (
        g['close'].shift(1) / g['close'].shift(4) - 1) * 100
    d['prev3_trend'] = np.where(
        d['prev3_total_change'] > 3, '偏强',
        np.where(d['prev3_total_change'] < -3, '偏弱', '震荡'))

    return d


def compute_lifecycle_features(d: pd.DataFrame) -> pd.DataFrame:
    """生命周期所需窗统计 (吸筹/派发证据)。依赖 compute_daily_features 产出的 vol20/vol_ratio 等。"""
    g = d.groupby('code', group_keys=False)
    d['high_20max'] = g['high'].transform(lambda s: s.rolling(20, min_periods=10).max())
    d['low_20min'] = g['low'].transform(lambda s: s.rolling(20, min_periods=10).min())
    d['close_20mean'] = g['close'].transform(lambda s: s.rolling(20, min_periods=10).mean())
    d['amp_20d'] = (d['high_20max'] - d['low_20min']) / d['close_20mean'] * 100
    d['vol5'] = g['volume'].transform(lambda s: s.rolling(5, min_periods=3).mean())
    d['vol_shrink'] = d['vol5'] / d['vol20']                            # 近5/近20 量比
    # 近5日放量天数 (量>20日均量)
    d['vol_gt_avg20'] = (d['volume'] > d['vol20']).astype(int)
    d['vol_gt_avg20_5d'] = g['vol_gt_avg20'].transform(
        lambda s: s.rolling(5, min_periods=5).sum())
    # 近5日上影线天数 / 量比发散
    d['up_shadow_day'] = (d['upper_shadow'] > 1.0).astype(int)
    d['up_shadow_cnt5'] = g['up_shadow_day'].transform(
        lambda s: s.rolling(5, min_periods=3).sum())
    d['vol_ratio_std5'] = g['vol_ratio'].transform(lambda s: s.rolling(5, min_periods=5).std())
    return d


def compute_intraday_features(grp: pd.DataFrame, zt_price: float,
                              prev_close: float, cfg: Config = DEFAULT_CONFIG):
    """单code单日1m → 分时特征 dict (V1字段 + 新增陷阱字段)。无足够数据返回None。"""
    g = grp.sort_values('trade_time').reset_index(drop=True)
    if len(g) < 5:
        return None

    bars = [{'time': str(t), 'open': float(o), 'high': float(h), 'low': float(l),
             'close': float(c), 'volume': int(v)}
            for t, o, h, l, c, v in zip(g['trade_time'], g['open'], g['high'],
                                        g['low'], g['close'], g['volume'])]

    # —— V1: 峰值/涨跌速度/急涨急跌/量价/分时段/场景 ——
    peak_idx, peak_price = 0, 0.0
    for i, b in enumerate(bars):
        if b['high'] > peak_price:
            peak_price, peak_idx = b['high'], i
    open_price, close_price = bars[0]['open'], bars[-1]['close']
    rise_bars = peak_idx + 1
    rise_pct = (peak_price - open_price) / open_price * 100 if open_price > 0 else 0
    rise_speed = rise_pct / rise_bars if rise_bars > 0 else 0
    fall_bars = len(bars) - peak_idx - 1
    fall_pct = (close_price - peak_price) / peak_price * 100 if peak_price > 0 else 0
    fall_speed = abs(fall_pct) / fall_bars if fall_bars > 0 else 0
    surge_events, crash_events = [], []
    for label, (w, th) in cfg.rapid_thresholds.items():
        for ev in _find_moves(bars, 'up', w, th):
            ev['speed'] = label; surge_events.append(ev)
        for ev in _find_moves(bars, 'down', w, th):
            ev['speed'] = label; crash_events.append(ev)
    vol_analysis = _analyze_volume(bars, surge_events, crash_events)
    periods = _period_stats(bars)
    scenario = _classify_scenario(peak_idx, len(bars), surge_events, crash_events, periods)

    # —— 新增: 封板/炸板/段涨跌/VWAP/翻红 (陷阱信号) ——
    mins = g['trade_time'].dt.hour * 60 + g['trade_time'].dt.minute
    o, c, h, l, v = g['open'], g['close'], g['high'], g['low'], g['volume']
    touch = h >= zt_price * cfg.zt_touch_pct
    seal_ratio = float(touch.mean())                                    # 封板时长占比(L2封单代理)
    break_count = int((touch & (c < zt_price * cfg.zt_touch_pct)).sum())  # 炸板根数
    tot_vol = v.sum()
    vwap = float(g['amount'].sum() / tot_vol) if tot_vol > 0 else float(c.iloc[-1])
    chg_vs_pc = (c - prev_close) / prev_close * 100
    ret1 = c.pct_change() * 100

    def seg(a, b):
        mask = (mins >= a) & (mins < b)
        if not mask.any():
            return None
        gg = g[mask]
        fo = gg['open'].iloc[0]
        return (gg['close'].iloc[-1] - fo) / fo * 100 if fo > 0 else None

    red_idx = (c > prev_close).values.nonzero()[0]
    return {
        # V1
        'peak_time': bars[peak_idx]['time'], 'peak_price': peak_price, 'peak_idx': peak_idx,
        'total_bars': len(bars), 'rise_bars': rise_bars, 'rise_pct': round(rise_pct, 2),
        'rise_speed': round(rise_speed, 3), 'fall_bars': fall_bars, 'fall_pct': round(fall_pct, 2),
        'fall_speed': round(fall_speed, 3), 'surge_events': surge_events, 'crash_events': crash_events,
        'vol_analysis': vol_analysis, 'periods': periods, 'scenario': scenario,
        # 新增
        'peak_minute': int(mins.iloc[peak_idx]),
        'max_fall_speed': float(ret1.min()),
        'vwap': round(vwap, 3), 'above_vwap_ratio': round(float((c > vwap).mean()), 3),
        'strong_ratio': round(float((chg_vs_pc > 0).mean()), 3),
        'weak_under3_ratio': round(float((chg_vs_pc < 3).mean()), 3),
        'seal_ratio': round(seal_ratio, 3), 'break_count': break_count,
        'early_crash5': seg(570, 575), 'late_drop': seg(870, 900),
        'first_red_minute': int(mins.iloc[red_idx[0]]) if len(red_idx) > 0 else None,
    }


def _find_moves(bars, direction, window, threshold):
    events, i = [], 0
    while i <= len(bars) - window:
        sp = bars[i]['open']
        ep = bars[i + window - 1]['close']
        if sp <= 0:
            i += 1; continue
        pct = (ep - sp) / sp * 100
        hit = (direction == 'up' and pct >= threshold) or \
              (direction == 'down' and pct <= -threshold)
        if hit:
            vol = sum(bars[j]['volume'] for j in range(i, i + window))
            events.append({'start_idx': i, 'end_idx': i + window - 1,
                           'start_time': bars[i]['time'], 'end_time': bars[i + window - 1]['time'],
                           'start_price': sp, 'end_price': ep, 'pct': round(pct, 2), 'volume': vol})
            i += window
        else:
            i += 1
    return events


def _analyze_volume(bars, surges, crashes):
    total_vol = sum(b['volume'] for b in bars)
    avg_vol = total_vol / len(bars) if bars else 1
    rise_vol = sum(b['volume'] for b in bars if b['close'] > b['open'])
    fall_vol = sum(b['volume'] for b in bars if b['close'] < b['open'])

    def _seg_ratio(evs):
        if not evs:
            return 0
        sv = sum(e['volume'] for e in evs)
        sc = sum(e['end_idx'] - e['start_idx'] + 1 for e in evs)
        return (sv / sc) / avg_vol if avg_vol > 0 else 0
    surge_ratio, crash_ratio = _seg_ratio(surges), _seg_ratio(crashes)

    def _label(r):
        return '放量' if r >= 2.0 else ('正常' if r >= 1.0 else '缩量')
    return {'rise_vol': rise_vol, 'fall_vol': fall_vol,
            'rise_fall_ratio': round(rise_vol / fall_vol, 2) if fall_vol > 0 else 0,
            'surge_vol_ratio': round(surge_ratio, 2), 'crash_vol_ratio': round(crash_ratio, 2),
            'surge_vol_label': _label(surge_ratio), 'crash_vol_label': _label(crash_ratio)}


def _period_stats(bars):
    def _mins(bar):
        t = bar.get('time', '')
        try:
            p = t.split(' ')[1][:5] if ' ' in t else t[-8:-3]
            h, m = p.split(':')
            return int(h) * 60 + int(m)
        except Exception:
            return -1
    defs = [('早盘', 570, 600), ('上午', 600, 690), ('下午', 780, 840), ('尾盘', 840, 900)]
    overall_avg = sum(b['volume'] for b in bars) / len(bars) if bars else 1
    stats = {}
    for name, s, e in defs:
        pb = [b for b in bars if s <= _mins(b) < e]
        if not pb:
            stats[name] = None; continue
        fo, lc = pb[0]['open'], pb[-1]['close']
        mx, mn = max(b['high'] for b in pb), min(b['low'] for b in pb)
        vr = (sum(b['volume'] for b in pb) / len(pb)) / overall_avg if overall_avg > 0 else 0
        stats[name] = {'change': round((lc - fo) / fo * 100, 2) if fo > 0 else 0,
                       'max_gain': round((mx - fo) / fo * 100, 2) if fo > 0 else 0,
                       'max_loss': round((mn - fo) / fo * 100, 2) if fo > 0 else 0,
                       'vol_ratio': round(vr, 2), 'bar_count': len(pb)}
    return stats


def _classify_scenario(peak_idx, total_bars, surges, crashes, periods):
    labels = []
    if peak_idx <= 2:
        labels.append('单边杀跌')
    elif peak_idx <= 15:
        labels.append('早盘诱多')
    elif peak_idx <= 60:
        labels.append('冲高回落')
    if len(surges) >= 2 and len(crashes) >= 2:
        labels.append('脉冲诱多')
    late = periods.get('尾盘')
    if late and late['change'] <= -1.5:
        labels.append('尾盘杀跌')
    return ' + '.join(labels) if labels else '其他'


# ==================== 分类器 ====================

def classify_bull_traps(r, cfg: Config, ia) -> list:
    """诱多(分时级): 高开低走(基底) + 5型。ia=None 时仅出基底。"""
    tags = []
    if r['gap_up'] >= cfg.min_gap_up and r['open_to_close'] < 0:
        tags.append('高开低走')
    if not ia:
        return tags
    # 1 尾盘偷鸡板: 14:30后封板 + 封板占比低(代理封单小) + 全天多数时间涨幅<3% + 涨停
    if (ia.get('peak_minute', 9999) >= 870 and ia.get('seal_ratio', 1) < cfg.late_sneak_seal
            and ia.get('weak_under3_ratio', 1) > 0.7 and r['is_zt']):
        tags.append('尾盘偷鸡板')
    # 2 早盘冲高回落: 10:30前见顶 + 上影线>5% + 自高点回落>7%
    if (ia.get('peak_minute', 9999) < 630 and r['upper_shadow'] > 5
            and ia.get('fall_pct', 0) < -7):
        tags.append('早盘冲高回落')
    # 3 一字开板瀑布杀: 高开≥7% + 振幅>10% + 收绿 + 1m急跌
    if (r['gap_up'] >= 7 and r['amplitude'] > 10 and r['change_pct'] < 0
            and ia.get('max_fall_speed', 0) <= cfg.waterfall_speed):
        tags.append('一字开板瀑布杀')
    # 4 高位放量烂板: 连板≥4 + 换手>20% + 炸板≥2 + 封板占比<0.1
    if (r['zt_streak'] >= 4 and pd.notna(r['turnover']) and r['turnover'] > 20
            and ia.get('break_count', 0) >= 2 and ia.get('seal_ratio', 1) < 0.1):
        tags.append('高位放量烂板')
    # 5 半山腰接盘: 昨大涨>7% + 今低开 + 单边跌 + 尾盘续跌 + 分时无有效反弹
    if (r['prev1_change'] > 7 and r['gap_up'] < 0 and r['open_to_close'] < -3
            and ia.get('late_drop') is not None and ia['late_drop'] < -1
            and ia.get('rise_pct', 0) < 3):
        tags.append('半山腰接盘')
    return tags


def classify_bear_traps(r, cfg: Config, ia) -> list:
    """诱空(分时级): 5型。全部需1m。"""
    if not ia:
        return []
    tags = []
    # 1 尾盘杀跌诱空: 全天强势 + 14:30跳水>3% + 收盘>MA5 + 未放巨量
    if (ia.get('strong_ratio', 0) > 0.6 and ia.get('late_drop') is not None
            and ia['late_drop'] < -3 and r['close'] > r['ma5'] and r['vol_ratio'] < 1.5):
        tags.append('尾盘杀跌诱空')
    # 2 早盘急跌反抽: 开盘5min急跌>4% + 收复 + 跌幅收窄<1% + 长下影
    if (ia.get('early_crash5') is not None and ia['early_crash5'] < -4
            and r['change_pct'] > -1 and r['lower_shadow'] > 2):
        tags.append('早盘急跌反抽')
    # 3 破位假摔拉升: 盘中破MA20/前低 + 收盘拉回上方 + 跌破缩量
    support = min(r['ma20'], r['low_20d_prior']) if pd.notna(r['ma20']) else r['low_20d_prior']
    if pd.notna(support) and r['low'] < support and r['close'] > support and r['vol_ratio'] < 1.0:
        tags.append('破位假摔拉升')
    # 4 缩量烂板洗盘: 低位 + 首板/二板 + 多次炸板 + 换手<10%
    is_low = (r['gain_60d'] < 20) if pd.notna(r['gain_60d']) else True
    if (is_low and r['zt_streak'] in (1, 2) and ia.get('break_count', 0) >= 2
            and pd.notna(r['turnover']) and r['turnover'] < 10):
        tags.append('缩量烂板洗盘')
    # 5 强转弱假杀: 昨涨停 + 今低开<-4% + 迅速翻红 + 不破均价线
    if (r['prev1_change'] > 9 and r['gap_up'] < -4
            and ia.get('first_red_minute') is not None and ia['first_red_minute'] <= 600
            and ia.get('above_vwap_ratio', 0) > 0.9):
        tags.append('强转弱假杀')
    return tags


def classify_daily_bull_traps(r, cfg: Config) -> list:
    """诱多(日线级): 假突破(T+1确认) + 放量滞涨。"""
    tags = []
    # 假突破: 放量破前20日高 + 收盘在最高价下方2%以内(看似强突破) + 次日收跌(无T+1=待确认)
    if (pd.notna(r['high_20d_prior']) and r['high'] > r['high_20d_prior']
            and r['vol_ratio'] > cfg.breakout_vol_ratio
            and r['close'] >= r['high'] * cfg.breakout_pullback):
        if pd.isna(r['next_chg']) or r['next_chg'] < 0:
            tags.append('假突破')
    # 放量滞涨: 高位(60日涨>30%) + 换手>15% + 日涨幅<2% + 长上影
    if (pd.notna(r['gain_60d']) and r['gain_60d'] > 30 and pd.notna(r['turnover'])
            and r['turnover'] > 15 and r['change_pct'] < 2
            and r['upper_shadow'] > cfg.long_shadow):
        tags.append('放量滞涨')
    return tags


def classify_daily_bear_traps(r, cfg: Config) -> list:
    """诱空(日线级): 均线假破位(T+1确认) + 缩量深跌。"""
    tags = []
    # 均线假破位: 收盘跌破MA20 + 缩量跌破(<5日均量) [T] + 次日高开且盘中收复 [T+1确认]
    if (pd.notna(r['ma20']) and r['close'] < r['ma20']
            and pd.notna(r['vol_avg5']) and r['volume'] < r['vol_avg5']):
        if (pd.isna(r['next_open']) or pd.isna(r['next_high'])
                or (r['next_open'] > r['close'] and r['next_high'] > r['ma20'])):
            tags.append('均线假破位')
    # 缩量深跌: 上升趋势 + 单日跌>5% + 量比<0.8
    uptrend = ((pd.notna(r['ma5']) and r['ma5'] > r['ma10'] > r['ma20'])
               or (pd.notna(r['ma20']) and r['close'] > r['ma20']))
    if uptrend and r['change_pct'] < cfg.deep_drop_pct and r['vol_ratio'] < cfg.wash_vol_ratio:
        tags.append('缩量深跌')
    return tags


def classify_lifecycle(r, cfg: Config) -> str:
    """生命周期 ↔ 策略映射: 主升浪/派发/下跌/洗盘/吸筹/震荡。"""
    # 主升浪: MA多头排列 + 近5日持续放量
    if (pd.notna(r['ma5']) and r['ma5'] > r['ma10'] > r['ma20']
            and pd.notna(r['vol_gt_avg20_5d']) and r['vol_gt_avg20_5d'] >= cfg.uptrend_vol_days):
        return '主升浪'
    # 派发: 偏离MA20>15% + 近5日频繁上影 + 量能脉冲发散
    if (pd.notna(r['dev_ma20']) and r['dev_ma20'] > cfg.dev_ma20_dist
            and pd.notna(r['up_shadow_cnt5']) and r['up_shadow_cnt5'] >= cfg.up_shadow_cnt_dist
            and pd.notna(r['vol_ratio_std5']) and r['vol_ratio_std5'] > cfg.pulse_vol_std):
        return '派发'
    # 下跌: 均线空头排列
    if pd.notna(r['ma5']) and r['ma5'] < r['ma10'] < r['ma20']:
        return '下跌'
    # 洗盘: 前段有涨幅 + 缩量回调不破MA10
    if (pd.notna(r['gain_10d']) and r['gain_10d'] > 10 and r['vol_ratio'] < 1.0
            and pd.notna(r['ma10']) and r['low'] >= r['ma10'] * 0.98):
        return '洗盘'
    # 吸筹: 低振幅 + 极度缩量 + 重心不降 + 偶有长下影
    if (pd.notna(r['amp_20d']) and r['amp_20d'] < cfg.amp_accumulation
            and pd.notna(r['vol_shrink']) and r['vol_shrink'] < cfg.vol_shrink_accum
            and pd.notna(r['close_20mean']) and r['close'] >= r['close_20mean'] * 0.97
            and r['lower_shadow'] > 1):
        return '吸筹'
    return '震荡'


def classify_stock(r, cfg: Config, ia):
    """统一分类一只股票 → (trap_type, trap_direction, trap_confirmed) 或 None(无陷阱)。"""
    bull = classify_bull_traps(r, cfg, ia) + classify_daily_bull_traps(r, cfg)
    bear = classify_bear_traps(r, cfg, ia) + classify_daily_bear_traps(r, cfg)
    tags = bull + bear
    if not tags:
        return None
    # T+1确认: 待确认型陷阱在最新日(无T+1)时 trap_confirmed=NULL
    pending = set()
    if '假突破' in tags and pd.isna(r.get('next_chg')):
        pending.add('假突破')
    if '均线假破位' in tags and pd.isna(r.get('next_open')):
        pending.add('均线假破位')
    any_confirmed = any(t not in pending for t in tags)
    direction = 'bull' if bull else ('bear' if bear else 'none')
    return {'trap_type': '|'.join(tags), 'trap_direction': direction,
            'trap_confirmed': True if any_confirmed else None}


def prescreen_intraday(target: pd.DataFrame, cfg: Config) -> pd.Series:
    """日级预筛: 命中任意分时陷阱日级前提的票才批量拉1m。"""
    mask = (
        target['is_zt']
        | (target['upper_shadow'] > 5)
        | (target['gap_up'] >= 7)
        | (target['zt_streak'] >= 4)
        | ((target['prev1_change'] > 7) & (target['gap_up'] < 0))
        | ((target['prev1_change'] > 9) & (target['gap_up'] < -4))
        | ((target['lower_shadow'] > 2) & (target['change_pct'] > -3))
        | (target['change_pct'] > 5)        # 强势日(尾盘杀跌诱空候选)
    ).fillna(False)
    return mask


# ==================== 持久层 ====================

PIANPAO_TABLES = [
    'pianpao_daily', 'pianpao_intraday', 'pianpao_intraday_events',
    'pianpao_intraday_periods', 'pianpao_daily_summary',
]

# pianpao_daily 新增列 (迁移)
_PIANPAO_DAILY_NEW_COLS = [
    ('trap_direction', 'VARCHAR'), ('trap_type', 'VARCHAR'), ('lifecycle_stage', 'VARCHAR'),
    ('trap_confirmed', 'BOOLEAN'), ('turnover', 'DOUBLE'), ('vol_ratio_5d', 'DOUBLE'),
    ('consecutive_zt', 'INTEGER'), ('break_count', 'INTEGER'), ('seal_ratio', 'DOUBLE'),
    ('ma5', 'DOUBLE'), ('ma10', 'DOUBLE'), ('ma20', 'DOUBLE'), ('ma60', 'DOUBLE'),
    ('dev_ma20', 'DOUBLE'),
]


def _add_column_if_missing(con, table, col, ddl):
    exists = con.execute(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = ? AND column_name = ?", [table, col]).fetchone()
    if not exists:
        con.execute(f'ALTER TABLE {table} ADD COLUMN {col} {ddl}')
        logger.info(f"    + {table}.{col} {ddl}")


def ensure_tables(con):
    """建表(IF NOT EXISTS) + 安全迁移 pianpao_daily 新列。"""
    # 主表(含新列直接写在DDL里, 适配全新库)
    con.execute("""
    CREATE TABLE IF NOT EXISTS pianpao_daily (
        trade_date          DATE NOT NULL,
        stock_code          VARCHAR(16) NOT NULL,
        stock_name          VARCHAR(32),
        level               VARCHAR(4),
        severity            DOUBLE,
        prev_close          DOUBLE,
        open_price          DOUBLE,
        close_price         DOUBLE,
        high_price          DOUBLE,
        low_price           DOUBLE,
        volume              BIGINT,
        gap_up_pct          DOUBLE,
        open_to_close_pct   DOUBLE,
        day_change_pct      DOUBLE,
        upper_shadow_ratio  DOUBLE,
        zt_price            DOUBLE,
        zt_distance         DOUBLE,
        touched_zt          BOOLEAN,
        prev1_change        DOUBLE,
        prev3_trend         VARCHAR(8),
        prev3_total_change  DOUBLE,
        scenario            VARCHAR(64),
        sectors             VARCHAR(512),
        trap_direction      VARCHAR,
        trap_type           VARCHAR,
        lifecycle_stage     VARCHAR,
        trap_confirmed      BOOLEAN,
        turnover            DOUBLE,
        vol_ratio_5d        DOUBLE,
        consecutive_zt      INTEGER,
        break_count         INTEGER,
        seal_ratio          DOUBLE,
        ma5 DOUBLE, ma10 DOUBLE, ma20 DOUBLE, ma60 DOUBLE,
        dev_ma20            DOUBLE,
        PRIMARY KEY (trade_date, stock_code)
    )""")
    # 存量表安全补列
    for col, ddl in _PIANPAO_DAILY_NEW_COLS:
        _add_column_if_missing(con, 'pianpao_daily', col, ddl)

    con.execute("""
    CREATE TABLE IF NOT EXISTS pianpao_intraday (
        trade_date DATE NOT NULL, stock_code VARCHAR(16) NOT NULL,
        total_bars INTEGER, peak_time VARCHAR(20), peak_price DOUBLE, peak_idx INTEGER,
        rise_bars INTEGER, rise_pct DOUBLE, rise_speed DOUBLE,
        fall_bars INTEGER, fall_pct DOUBLE, fall_speed DOUBLE,
        surge_count INTEGER, crash_count INTEGER,
        surge_vol_ratio DOUBLE, crash_vol_ratio DOUBLE, rise_fall_vol_ratio DOUBLE,
        surge_vol_label VARCHAR(8), crash_vol_label VARCHAR(8),
        PRIMARY KEY (trade_date, stock_code)
    )""")
    con.execute("""
    CREATE TABLE IF NOT EXISTS pianpao_intraday_events (
        trade_date DATE NOT NULL, stock_code VARCHAR(16) NOT NULL, seq INTEGER NOT NULL,
        event_type VARCHAR(8), start_time VARCHAR(20), end_time VARCHAR(20),
        start_price DOUBLE, end_price DOUBLE, pct DOUBLE, speed_label VARCHAR(8), volume BIGINT,
        PRIMARY KEY (trade_date, stock_code, seq)
    )""")
    con.execute("""
    CREATE TABLE IF NOT EXISTS pianpao_intraday_periods (
        trade_date DATE NOT NULL, stock_code VARCHAR(16) NOT NULL, period_name VARCHAR(8) NOT NULL,
        change_pct DOUBLE, max_gain DOUBLE, max_loss DOUBLE, vol_ratio DOUBLE, bar_count INTEGER,
        PRIMARY KEY (trade_date, stock_code, period_name)
    )""")
    con.execute("""
    CREATE TABLE IF NOT EXISTS pianpao_daily_summary (
        trade_date DATE PRIMARY KEY, total_count INTEGER,
        s_count INTEGER, a_count INTEGER, b_count INTEGER, c_count INTEGER,
        avg_gap_up DOUBLE, avg_intraday_drop DOUBLE, zt_rejected INTEGER, sector_linked INTEGER
    )""")


# pianpao_daily 列顺序(与建表一致) —— 用于显式 INSERT
_DAILY_COLS = [
    'trade_date', 'stock_code', 'stock_name', 'level', 'severity', 'prev_close',
    'open_price', 'close_price', 'high_price', 'low_price', 'volume', 'gap_up_pct',
    'open_to_close_pct', 'day_change_pct', 'upper_shadow_ratio', 'zt_price', 'zt_distance',
    'touched_zt', 'prev1_change', 'prev3_trend', 'prev3_total_change', 'scenario', 'sectors',
    'trap_direction', 'trap_type', 'lifecycle_stage', 'trap_confirmed', 'turnover',
    'vol_ratio_5d', 'consecutive_zt', 'break_count', 'seal_ratio',
    'ma5', 'ma10', 'ma20', 'ma60', 'dev_ma20',
]


def _build_daily_df(records, target_date, stock_names, lifecycle_map):
    """records: list[dict] (每只命中陷阱的票) → pianpao_daily DataFrame。"""
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    dd = _iso(target_date)
    df['trade_date'] = dd
    df['stock_name'] = df['stock_code'].map(lambda c: (stock_names or {}).get(c, ''))
    df['lifecycle_stage'] = df['stock_code'].map(lifecycle_map)
    # 严重度/等级 (仅高开低走有意义, 其余留空)
    df['severity'] = df.apply(
        lambda r: round(r['gap_up'] + abs(r['open_to_close']), 2)
        if '高开低走' in (r.get('trap_type') or '') else None, axis=1)
    df['level'] = df.apply(
        lambda r: severity_level(r['severity'], r['gap_up'])
        if pd.notna(r['severity']) else None, axis=1)
    # 重命名 → 表列名
    df = df.rename(columns={
        'open': 'open_price', 'close': 'close_price', 'high': 'high_price', 'low': 'low_price',
        'gap_up': 'gap_up_pct', 'open_to_close': 'open_to_close_pct',
        'change_pct': 'day_change_pct', 'upper_shadow': 'upper_shadow_ratio',
        'vol_ratio': 'vol_ratio_5d', 'zt_streak': 'consecutive_zt',
    })
    df['sectors'] = ''
    df['scenario'] = df.get('scenario', '')
    for col in _DAILY_COLS:
        if col not in df.columns:
            df[col] = None
    return df[_DAILY_COLS].where(pd.DataFrame(df[_DAILY_COLS]).notnull(), None)


def save_to_db(con, results_df, sector_analysis=None, target_date=None, stock_names=None,
              ia_map=None):
    """批量写入: register + INSERT SELECT (弃用循环单行INSERT)。
    results_df: pianpao_daily 主表 DataFrame; ia_map: code→分时dict(写intraday 3表)。"""
    dd = _iso(target_date)
    for tbl in PIANPAO_TABLES:
        con.execute(f"DELETE FROM {tbl} WHERE trade_date = '{dd}'")   # 按日删(非按code全删)

    if results_df is None or results_df.empty:
        con.execute("INSERT INTO pianpao_daily_summary VALUES (?,?,?,?,?,?,?,?,?,?)",
                    [dd, 0, 0, 0, 0, 0, 0, 0, 0, 0])
        logger.info(f"  保存: 无陷阱, summary 置零")
        return

    # —— pianpao_daily ——
    con.register('_pp', results_df)
    con.execute(f"INSERT INTO pianpao_daily ({','.join(_DAILY_COLS)}) "
                f"SELECT {','.join(_DAILY_COLS)} FROM _pp")
    con.unregister('_pp')

    # —— pianpao_intraday / events / periods (仅有分时分析的票) ——
    ia_map = ia_map if ia_map is not None else _LAST_IA_MAP
    if ia_map:
        rows_i, rows_e, rows_p = [], [], []
        for code, ia in ia_map.items():
            va = ia.get('vol_analysis', {})
            rows_i.append([dd, code, ia.get('total_bars'), short_time(ia.get('peak_time', '')),
                           ia.get('peak_price'), ia.get('peak_idx'), ia.get('rise_bars'),
                           ia.get('rise_pct'), ia.get('rise_speed'), ia.get('fall_bars'),
                           ia.get('fall_pct'), ia.get('fall_speed'),
                           len(ia.get('surge_events', [])), len(ia.get('crash_events', [])),
                           va.get('surge_vol_ratio'), va.get('crash_vol_ratio'),
                           va.get('rise_fall_ratio'), va.get('surge_vol_label'),
                           va.get('crash_vol_label')])
            seq = 0
            for ev in ia.get('surge_events', []):
                rows_e.append([dd, code, seq, 'surge', short_time(ev['start_time']),
                               short_time(ev['end_time']), ev['start_price'], ev['end_price'],
                               ev['pct'], ev.get('speed', ''), int(ev.get('volume', 0))]); seq += 1
            for ev in ia.get('crash_events', []):
                rows_e.append([dd, code, seq, 'crash', short_time(ev['start_time']),
                               short_time(ev['end_time']), ev['start_price'], ev['end_price'],
                               ev['pct'], ev.get('speed', ''), int(ev.get('volume', 0))]); seq += 1
            for pn in ['早盘', '上午', '下午', '尾盘']:
                pv = ia.get('periods', {}).get(pn)
                if pv:
                    rows_p.append([dd, code, pn, pv['change'], pv['max_gain'], pv['max_loss'],
                                   pv['vol_ratio'], pv['bar_count']])
        if rows_i:
            con.executemany("INSERT INTO pianpao_intraday VALUES " + _ph(19), rows_i)
        if rows_e:
            con.executemany("INSERT INTO pianpao_intraday_events VALUES " + _ph(11), rows_e)
        if rows_p:
            con.executemany("INSERT INTO pianpao_intraday_periods VALUES " + _ph(8), rows_p)

    # —— daily_summary ——
    df = results_df
    counts = {lv: int((df['level'] == lv).sum()) for lv in ['S级', 'A级', 'B级', 'C级']}
    avg_gap = float(df['gap_up_pct'].mean()) if 'gap_up_pct' in df else 0
    avg_otc = float(df['open_to_close_pct'].mean()) if 'open_to_close_pct' in df else 0
    zt_rej = int(df['touched_zt'].sum()) if 'touched_zt' in df else 0
    con.execute("INSERT INTO pianpao_daily_summary VALUES (?,?,?,?,?,?,?,?,?,?)",
                [dd, len(df), counts['S级'], counts['A级'], counts['B级'], counts['C级'],
                 round(avg_gap, 2), round(avg_otc, 2), zt_rej, 0])
    logger.info(f"  保存: daily={len(df)}, intraday={len(ia_map)}")


# ==================== 主流程 ====================

def run_analysis(con, target_date, cfg=None, stock_names=None):
    """运行全维度陷阱分析。返回 (results_df, {})。results_df = pianpao_daily 行。
    同时返回的 ia_map 通过 _last_ia_map 暴露给 save_to_db。"""
    if cfg is None:
        cfg = DEFAULT_CONFIG
    dd = _iso(target_date)
    logger.info(f"[TRAP] 开始分析 {dd}")
    t0 = pd.Timestamp.now()

    codes = load_universe(con)
    if not codes:
        logger.warning("  无A股候选")
        return pd.DataFrame(), {}

    daily = load_daily_window(con, codes, target_date, lookback_days=60)
    if daily.empty:
        logger.warning("  无日K数据")
        return pd.DataFrame(), {}
    daily = compute_daily_features(daily, cfg)
    daily = compute_lifecycle_features(daily)

    target = daily[daily['date'] == _date(target_date)].copy()
    if target.empty:
        logger.warning(f"  目标日 {dd} 无日K数据")
        return pd.DataFrame(), {}
    logger.info(f"  目标日候选: {len(target)} 只")

    # 生命周期 (全量)
    target['lifecycle_stage'] = target.apply(lambda r: classify_lifecycle(r, cfg), axis=1)
    lifecycle_map = dict(zip(target['code'], target['lifecycle_stage']))

    # 分时候选预筛 → 批量取1m
    cand_mask = prescreen_intraday(target, cfg)
    candidates = target[cand_mask]
    logger.info(f"  分时1m候选: {len(candidates)} 只")

    ia_map = {}
    if not candidates.empty:
        m1 = load_1m_batch(con, candidates['code'].tolist(), target_date)
        if not m1.empty:
            cand_idx = {c: candidates[candidates['code'] == c].iloc[0] for c in m1['code'].unique()}
            for code, grp in m1.groupby('code'):
                row = cand_idx.get(code)
                if row is None or pd.isna(row['prev_close']):
                    continue
                zt = calc_zt_price(row['prev_close'], code)
                ia = compute_intraday_features(grp, zt, row['prev_close'], cfg)
                if ia:
                    ia_map[code] = ia

    # 统一分类 → records
    records = []
    for _, r in target.iterrows():
        ia = ia_map.get(r['code'])
        verdict = classify_stock(r, cfg, ia)
        if verdict is None:
            continue
        rec = {
            'stock_code': r['code'],
            'prev_close': float(r['prev_close']) if pd.notna(r['prev_close']) else None,
            'open': float(r['open']), 'close': float(r['close']),
            'high': float(r['high']), 'low': float(r['low']), 'volume': int(r['volume']),
            'gap_up': float(r['gap_up']), 'open_to_close': float(r['open_to_close']),
            'change_pct': float(r['change_pct']), 'upper_shadow': float(r['upper_shadow']),
            'zt_price': float(r['zt_price']) if pd.notna(r['zt_price']) else None,
            'zt_distance': float(r['zt_distance']) if pd.notna(r['zt_distance']) else None,
            'touched_zt': bool(r['touched_zt']),
            'prev1_change': float(r['prev1_change']) if pd.notna(r['prev1_change']) else None,
            'prev3_trend': r['prev3_trend'], 'prev3_total_change': float(r['prev3_total_change'])
            if pd.notna(r['prev3_total_change']) else None,
            'scenario': (ia.get('scenario') if ia else '') or verdict['trap_type'],
            'turnover': float(r['turnover']) if pd.notna(r['turnover']) else None,
            'vol_ratio': float(r['vol_ratio']) if pd.notna(r['vol_ratio']) else None,
            'zt_streak': int(r['zt_streak']),
            'break_count': int(ia['break_count']) if ia else None,
            'seal_ratio': float(ia['seal_ratio']) if ia else None,
            'ma5': float(r['ma5']) if pd.notna(r['ma5']) else None,
            'ma10': float(r['ma10']) if pd.notna(r['ma10']) else None,
            'ma20': float(r['ma20']) if pd.notna(r['ma20']) else None,
            'ma60': float(r['ma60']) if pd.notna(r['ma60']) else None,
            'dev_ma20': float(r['dev_ma20']) if pd.notna(r['dev_ma20']) else None,
            'trap_direction': verdict['trap_direction'],
            'trap_type': verdict['trap_type'],
            'trap_confirmed': verdict['trap_confirmed'],
        }
        records.append(rec)

    results_df = _build_daily_df(records, target_date, stock_names, lifecycle_map)

    elapsed = (pd.Timestamp.now() - t0).total_seconds()
    logger.info(f"[TRAP] 完成 {dd}: 陷阱 {len(results_df)} 只, 分时 {len(ia_map)} 只, 耗时 {elapsed:.1f}s")

    # 暴露 ia_map 供 save_to_db (模块级缓存, 避免改签名)
    _LAST_IA_MAP.update(ia_map)
    return results_df, {}


# 模块级缓存: run_analysis 产出的 ia_map, save_to_db 取用 (保持70/71原签名)
_LAST_IA_MAP = {}


# ==================== 报告 ====================

def print_report(results_df, sector_analysis, target_date, cfg):
    """打印报告 (DataFrame 版)。"""
    dd = _iso(target_date)
    print(f"\n{'=' * 80}")
    if results_df is None or results_df.empty:
        print(f"  {dd} 无陷阱记录")
        print(f"{'=' * 80}")
        return
    print(f"  {dd} 全维度陷阱报告  共 {len(results_df)} 只")
    print(f"{'=' * 80}")

    # trap_direction × lifecycle 交叉
    if 'trap_direction' in results_df.columns:
        print("\n  方向分布:")
        for d, n in results_df['trap_direction'].value_counts().items():
            print(f"    {d}: {n}")
    if 'lifecycle_stage' in results_df.columns:
        print("\n  生命周期分布:")
        for lc, n in results_df['lifecycle_stage'].value_counts().items():
            print(f"    {lc}: {n}")
    if 'trap_type' in results_df.columns:
        print("\n  陷阱类型 top:")
        tt = results_df['trap_type'].str.split('|').explode().value_counts().head(10)
        for t, n in tt.items():
            print(f"    {t}: {n}")

    # 明细 (按 severity/severity 降序)
    show = results_df.copy()
    show = show.sort_values('severity', ascending=False, na_position='last').head(30)
    print(f"\n  {'代码':<14}{'方向':<6}{'陷阱类型':<28}{'生命周期':<8}{'高开%':>7}{'全天%':>7}{'换手%':>7}")
    print(f"  {'-' * 80}")
    for _, r in show.iterrows():
        print(f"  {str(r['stock_code']):<14}{str(r.get('trap_direction','')):<6}"
              f"{str(r.get('trap_type','')):<28}{str(r.get('lifecycle_stage','')):<8}"
              f"{(r['gap_up_pct'] if pd.notna(r.get('gap_up_pct')) else 0):>+7.2f}"
              f"{(r['day_change_pct'] if pd.notna(r.get('day_change_pct')) else 0):>+7.2f}"
              f"{(r['turnover'] if pd.notna(r.get('turnover')) else 0):>7.2f}")
    print(f"{'=' * 80}")
