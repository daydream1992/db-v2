"""竞价监控雷达 v2 — 评分引擎(标签规则树)

纯函数:合并开盘价 + DB 特征 → 算衍生指标 → 按规则树打标签。

规则树优先级(高开票):
  1. pianpao 一票否决      → 🔴 高开陷阱警示
  2. 主力净流出(相对市值)  → 🟠 资金背离
  3. 昨涨停 + 主力流入      → 🟢 强势延续
  4. 否则                  → neutral
低开票:
  - 昨涨停 + 低开          → 🟠 核按钮(不是低吸!)
  - 小低开 + 昨涨 + 主力未流出 + 非惯骗 → 🟡 低吸观察
辅助:流通市值 < 30 亿 → 叠加 ⚪ 流动性警示
"""
from __future__ import annotations

import pandas as pd

from config import THRESHOLDS, limit_up_pct, LABELS

def merge_open_db(open_df: pd.DataFrame, db_df: pd.DataFrame) -> pd.DataFrame:
    """合并开盘快照 + DB 特征,算衍生指标

    衍生:open_pct / float_mcap / zjl_ratio / yest_limit_up
    单位:Zjl 万元,ltgb 股,price 元 → float_mcap 元,zjl_ratio = zjl*1e4/float_mcap
    """
    df = open_df.merge(db_df, on="code", how="left")

    df["open_pct"] = (df["open_price"] - df["last_close"]) / df["last_close"] * 100

    # 流通市值(元)= 流通股本(股) × 开盘价(元)
    df["float_mcap"] = df["ltgb"] * df["open_price"]

    # 主力净额 / 流通市值(万元 → 元换算)
    df["zjl_ratio"] = (df["zjl"] * 1e4) / df["float_mcap"]

    # 昨日涨停(preset 已预算则不重算)
    if "yest_limit_up" not in df.columns:
        df["yest_limit_up"] = df.apply(
            lambda r: pd.notna(r.get("yest_pct"))
            and r["yest_pct"] >= limit_up_pct(r["code"]) - 0.2,
            axis=1,
        )
    return df


def _num(v) -> float | None:
    """NaN/None → None"""
    if v is None or pd.isna(v):
        return None
    return float(v)


def label_row(row: pd.Series, th: THRESHOLDS) -> tuple[str, str | None, str]:
    """返回 (主标签, 辅助标签, 原因)"""
    code = str(row.get("code", ""))
    open_pct = float(row.get("open_pct", 0.0) or 0.0)
    trap_cnt = int(row.get("trap_cnt", 0) or 0)
    zjl_ratio = _num(row.get("zjl_ratio"))
    float_mcap = _num(row.get("float_mcap"))
    yest_pct = _num(row.get("yest_pct"))
    yest_limit = bool(row.get("yest_limit_up", False))

    # 辅助:流动性警示
    aux = "liquidity" if (float_mcap and float_mcap < th.float_mcap_warn) else None
    is_pianpao = trap_cnt >= th.pianpao_min_count  # 近 N 天有骗炮 = 惯骗

    # ===== 高开 =====
    if open_pct > th.open_up_pct:
        if is_pianpao:
            return ("trap_warning", aux,
                    f"高开{open_pct:+.1f}%·惯骗{trap_cnt}次·一票否决")
        if zjl_ratio is not None and zjl_ratio < th.fund_diverge_ratio:
            return ("fund_diverge", aux,
                    f"高开{open_pct:+.1f}%·主力流出{zjl_ratio*100:.2f}%·背离")
        if yest_limit and zjl_ratio is not None and zjl_ratio > th.fund_inflow_ratio:
            return ("strong_continue", aux,
                    f"高开{open_pct:+.1f}%·昨涨停·主力流入{zjl_ratio*100:.2f}%")
        return ("neutral", aux, f"高开{open_pct:+.1f}%·信号不足")

    # ===== 低开 =====
    if open_pct < th.open_down_pct:
        if yest_limit:
            return ("nuclear", aux,
                    f"低开{open_pct:+.1f}%·昨涨停·核按钮风险")
        # 低吸:小低开 + 昨涨(多头) + 主力未大幅流出 + 非惯骗
        not_diverge = (zjl_ratio is None) or (zjl_ratio > th.fund_diverge_ratio)
        if (th.dip_buy_low <= open_pct <= th.dip_buy_high
                and yest_pct is not None and yest_pct > 0
                and not is_pianpao and not_diverge):
            return ("dip_buy", aux,
                    f"低开{open_pct:+.1f}%·昨涨{yest_pct:+.1f}%·低吸观察")
        return ("neutral", aux, f"低开{open_pct:+.1f}%·观望")

    # ===== 平盘 =====
    return ("neutral", aux, f"平盘{open_pct:+.1f}%·观望")


def label_all(df: pd.DataFrame, th: THRESHOLDS) -> pd.DataFrame:
    """应用规则树,返回带 label/aux/reason 的 df。

    排序:按主力净流入(zjl)降序 —— 真强势(大资金流入)排前面。
    """
    if df.empty:
        return df

    results = [label_row(row, th) for _, row in df.iterrows()]
    extra = pd.DataFrame(results, columns=["label", "aux", "reason"], index=df.index)
    out = pd.concat([df, extra], axis=1)

    # 按主力净流入降序(None/NaN 排尾)
    out["_zjl_sort"] = pd.to_numeric(out.get("zjl"), errors="coerce").fillna(-1e18)
    out = out.sort_values("_zjl_sort", ascending=False).drop(columns=["_zjl_sort"])
    return out.reset_index(drop=True)


def label_cn(key: str) -> str:
    """标签 key → 中文名"""
    if not key:
        return ""
    lab = LABELS.get(key)
    return lab.cn if lab else key


# ============ 竞价趋势:线性拟合 + 强势排序 ============

def linear_fit(points: list) -> tuple[float, float, float, int]:
    """线性拟合 pct 序列。points: [(idx, ts, price, pct), ...]

    返回 (slope, r2, last_pct, n_valid)
    slope: 每2分钟涨幅变化(%/采样间隔), r2: 拟合优度
    """
    valid = [(p[0], p[3]) for p in points if p[3] is not None]
    n = len(valid)
    last_pct = valid[-1][1] if valid else 0.0
    if n < 2:
        return 0.0, 0.0, last_pct, n
    xs = [v[0] for v in valid]
    ys = [v[1] for v in valid]
    mean_x, mean_y = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mean_x) ** 2 for x in xs)
    sxy = sum((xs[i] - mean_x) * (ys[i] - mean_y) for i in range(n))
    syy = sum((y - mean_y) ** 2 for y in ys)
    slope = sxy / sxx if sxx > 0 else 0.0
    r2 = (sxy * sxy) / (sxx * syy) if (sxx > 0 and syy > 0) else 0.0
    return slope, r2, last_pct, n


def _is_high_risk(trap_cnt: int, zjl_ratio, float_mcap, trend) -> tuple[bool, str]:
    """高风险剔除:惯骗 / 资金背离 / 流动性低"""
    if trap_cnt >= trend.exclude_pianpao_cnt:
        return True, f"惯骗{trap_cnt}"
    if zjl_ratio is not None and not pd.isna(zjl_ratio) and zjl_ratio < trend.exclude_fund_diverge:
        return True, "资金背离"
    if float_mcap is not None and not pd.isna(float_mcap) and float_mcap < trend.exclude_float_mcap:
        return True, "流动性低"
    return False, ""


def interpret(slope: float, r2: float, points: list, trend) -> str:
    """线性波动解读(一句)"""
    if slope <= 0:
        return "↓ 走弱"
    valid = [p[3] for p in points if p[3] is not None]
    tag = ""
    if len(valid) >= 4:
        mid = len(valid) // 2
        front, back = valid[:mid + 1], valid[mid:]
        fsl = (front[-1] - front[0]) / (len(front) - 1) if len(front) > 1 else 0
        bsl = (back[-1] - back[0]) / (len(back) - 1) if len(back) > 1 else 0
        if bsl > fsl * 1.5:
            tag = "·末段加速"
        elif bsl < fsl * 0.5:
            tag = "·末段放缓"
    if r2 >= trend.r2_stable:
        return f"↗稳定上升 +{slope:.2f}/2min{tag}"
    if r2 >= trend.r2_volatile:
        return f"↗波动上升 +{slope:.2f}/2min{tag}"
    return f"↗凌乱 +{slope:.2f}/2min{tag}"


def rank_strong(series: dict, preset_df: pd.DataFrame, trend) -> pd.DataFrame:
    """拟合每票序列 → 剔除高风险/弱势 → 按斜率排序 → 加解读

    返回: code, last_pct, slope, r2, n, zjl_ratio, float_mcap, trap_cnt, interp
    """
    rows: list[dict] = []
    preset_idx = preset_df.set_index("code")
    for code, pts in series.items():
        if code not in preset_idx.index:
            continue
        slope, r2, last_pct, n = linear_fit(pts)
        if n < 2 or last_pct is None:
            continue
        valid = [p for p in pts if p[3] is not None]
        if not valid:
            continue
        last_price = valid[-1][2]
        prow = preset_idx.loc[code]
        ltgb = prow.get("ltgb")
        zjl = prow.get("zjl")
        trap_cnt = int(prow.get("trap_cnt", 0) or 0)
        float_mcap = (ltgb * last_price) if (ltgb and last_price) else None
        zjl_ratio = (zjl * 1e4 / float_mcap) if (zjl is not None and not pd.isna(zjl) and float_mcap) else None

        risky, _ = _is_high_risk(trap_cnt, zjl_ratio, float_mcap, trend)
        if risky:
            continue  # 高风险直接排除,不输出
        if slope < trend.slope_min:
            continue  # 不够强
        rows.append({
            "code": code, "last_pct": last_pct, "slope": slope, "r2": r2, "n": n,
            "zjl_ratio": zjl_ratio, "float_mcap": float_mcap, "trap_cnt": trap_cnt,
        })
    if not rows:
        return pd.DataFrame(columns=["code", "last_pct", "slope", "r2", "interp"])
    df = pd.DataFrame(rows)
    df["interp"] = df.apply(lambda r: interpret(r["slope"], r["r2"], series[r["code"]], trend), axis=1)
    return df.sort_values("slope", ascending=False).reset_index(drop=True)
