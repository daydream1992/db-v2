"""竞价监控雷达 — 评分引擎 (L3)

纯函数层:不读不写,只算分。
输入 pd.Series (一行特征),输出 ScoredRow。
输入 pd.DataFrame (多行),输出加 3 列的 DataFrame。
"""
from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from config import THRESHOLDS


@dataclass(frozen=True)
class ScoredRow:
    """单行评分结果"""

    code: str
    pct: float
    real_vol: float        # 实际成交量(手,Volume 字段原始单位)
    amount: float          # 成交额(元)
    trap_ratio: float      # s3/s2,诱多/低吸系数
    mode: str              # 'trend' | 'dip' | 'weak' | 'anomaly'
    score: float           # 0..100
    reason: str            # 简短中文原因


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _is_anomaly(row: pd.Series, th: THRESHOLDS) -> bool:
    """数据异常熔断"""
    last_close = row.get("last_close", 0.0) or 0.0
    if last_close <= th.last_close_floor:
        return True
    if row.get("s3_price", 0.0) is None or row.get("s3_price", 0.0) <= 0:
        return True
    if row.get("real_vol", -1) is not None and row.get("real_vol", 0) < 0:
        return True
    return False


def score_row(row: pd.Series, th: THRESHOLDS) -> ScoredRow:
    """评分一行

    Args:
        row: 含 code/last_close/s1_price/s2_price/s3_price/real_vol/amount 列
        th: 阈值

    Returns:
        ScoredRow
    """
    code = str(row.get("code", ""))
    pct = float(row.get("pct", 0.0) or 0.0)
    real_vol = float(row.get("real_vol", 0) or 0)
    amount = float(row.get("amount", 0.0) or 0.0)
    trap_ratio = float(row.get("trap_ratio", 1.0) or 1.0)

    # 异常熔断
    if _is_anomaly(row, th):
        return ScoredRow(
            code=code, pct=pct, real_vol=real_vol, amount=amount,
            trap_ratio=trap_ratio, mode="anomaly", score=0.0,
            reason="数据异常(昨收/价格/成交量无效)"
        )

    # 弱信号（pct 在 ±1% 区间内,直接给 weak_score,不再细分）
    if th.dip_pct <= pct <= th.trend_pct:
        return ScoredRow(
            code=code, pct=pct, real_vol=real_vol, amount=amount,
            trap_ratio=trap_ratio, mode="weak", score=float(th.weak_score),
            reason="平盘/微涨,观望"
        )

    # 标准化分项到 [0,1]
    amt_score = _clamp(amount / th.full_amt)
    vol_score = _clamp(real_vol / th.full_vol_lots)

    if pct > th.trend_pct:
        # 趋势追高: 涨幅加成 + 量能加成 - 诱多扣分
        amp_score = _clamp(pct / 5.0)            # 5% 涨幅 = 满分
        trap_penalty = 15.0 if trap_ratio < th.trap_floor else 0.0
        score = (
            60.0
            + 20.0 * amp_score
            + 10.0 * amt_score
            + 10.0 * vol_score
            - trap_penalty
        )
        reason = "趋势追高" if score >= 80 else "弱趋势"
        if trap_penalty:
            reason += "(诱多扣分)"
        mode = "trend"
    else:  # pct < dip_pct
        # 反核低吸: 跌幅加成 + 资金加成 + 抛压吸收加成
        depth_score = _clamp(abs(pct) / 5.0)     # -5% = 满分深度
        trap_bonus = 20.0 if trap_ratio > th.trap_ceiling else 0.0
        score = (
            60.0
            + 20.0 * depth_score
            + 10.0 * amt_score
            + 10.0 * vol_score
            + trap_bonus
        )
        reason = "黄金坑" if score >= 80 else "弱转强"
        if trap_bonus:
            reason += "(低吸确认)"
        mode = "dip"

    score = _clamp(score, 0.0, 100.0)
    return ScoredRow(
        code=code, pct=pct, real_vol=real_vol, amount=amount,
        trap_ratio=trap_ratio, mode=mode, score=score, reason=reason
    )


def score_all(features: pd.DataFrame, th: THRESHOLDS) -> pd.DataFrame:
    """评分全部行,返回加 3 列(score/mode/reason)的 DataFrame,按 score 降序"""
    if features.empty:
        return pd.DataFrame(columns=list(features.columns) + ["score", "mode", "reason"])

    rows: list[dict] = []
    for _, raw in features.iterrows():
        sr = score_row(raw, th)
        rows.append({"score": sr.score, "mode": sr.mode, "reason": sr.reason})

    extra = pd.DataFrame(rows, index=features.index)
    out = pd.concat([features, extra], axis=1)
    out = out.sort_values("score", ascending=False).reset_index(drop=True)
    return out
