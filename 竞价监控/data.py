"""竞价监控雷达 — 数据层 (L1 + L2)

L1: safe_snapshot 单股安全获取(3 次重试 + 异常降级)
L2: extract_features 三时刻 join + 指标计算
"""
from __future__ import annotations

import random
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Sequence

import pandas as pd
from loguru import logger

# 必须在 import tqcenter 之前设 sys.path
TQ_SYS_PATH = r"K:\txdlianghua\PYPlugins\sys"
if TQ_SYS_PATH not in sys.path:
    sys.path.insert(0, TQ_SYS_PATH)

try:
    from tqcenter import tq  # type: ignore
except Exception as e:  # noqa: BLE001
    tq = None  # type: ignore
    logger.warning(f"tqcenter 加载失败: {e};仅 --mock 可用")


# ============ L1: 池管理 + 安全快照 ============

def load_pool(path: Path) -> list[str]:
    """解析 pool.txt

    格式:
        # 注释行
        <code>  # 名称
        <code>

    空行忽略
    """
    if not path.exists():
        logger.error(f"pool.txt 不存在: {path}")
        return []

    codes: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        # 去掉行内注释
        code = s.split("#", 1)[0].strip()
        if code:
            codes.append(code)

    # 去重保序
    seen: set[str] = set()
    unique: list[str] = []
    for c in codes:
        if c not in seen:
            seen.add(c)
            unique.append(c)
    logger.info(f"加载监控池 {len(unique)} 只: {path}")
    return unique


def safe_snapshot(code: str, max_retry: int = 3, backoff_s: float = 0.2) -> dict:
    """单股安全快照

    Returns:
        dict 字段(已转 float/int):LastClose/Open/Now/Volume/Amount 等
        失败返回空 dict{}
    """
    if tq is None:
        return {}

    last_err: Exception | None = None
    for attempt in range(1, max_retry + 1):
        try:
            data = tq.get_market_snapshot(stock_code=code, field_list=[])
            if data:
                return _normalize_snapshot(data)
        except Exception as e:  # noqa: BLE001
            last_err = e
            logger.debug(f"snapshot {code} 第{attempt}次失败: {e}")
            time.sleep(backoff_s * attempt)

    logger.warning(f"snapshot {code} 重试{max_retry}次仍失败: {last_err}")
    return {}


def _normalize_snapshot(data: dict) -> dict:
    """字段归一化:camelCase → snake_case,数值化"""
    out: dict = {}
    mapping = {
        "LastClose": "last_close", "Open": "open",
        "Now": "now", "Max": "high", "Min": "low",
        "Volume": "volume", "NowVol": "now_vol", "Amount": "amount",
        "Average": "avg", "Zangsu": "speed",
    }
    for k_src, k_dst in mapping.items():
        v = data.get(k_src)
        if v is None:
            continue
        try:
            if k_dst in ("volume", "now_vol"):
                out[k_dst] = int(float(v))
            else:
                out[k_dst] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def fetch_snapshots(
    codes: Sequence[str],
    snapshot_at: datetime | None = None,
    progress: bool = True,
) -> pd.DataFrame:
    """批量取快照(串行)

    Args:
        codes: 股票代码列表
        snapshot_at: 采样时刻(用于日志,可空)
        progress: 是否打印进度

    Returns:
        DataFrame cols: code, last_close, open, now, volume, amount, snapshot_at
    """
    if tq is None:
        raise RuntimeError("tqcenter 未加载,无法 fetch_snapshots")

    tq.initialize(__file__)
    ts = snapshot_at or datetime.now()
    rows: list[dict] = []
    try:
        for i, code in enumerate(codes, 1):
            snap = safe_snapshot(code)
            if not snap:
                continue
            snap["code"] = code
            snap["snapshot_at"] = ts
            rows.append(snap)
            if progress and i % 5 == 0:
                logger.debug(f"  snapshot {i}/{len(codes)}")
    finally:
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass

    return pd.DataFrame(rows)


# ============ L2: 特征提取(三时刻 join) ============

REQUIRED_COLS = ["code", "s1_price", "s2_price", "s3_price",
                 "last_close", "real_vol", "amount", "pct", "trap_ratio"]


def extract_features(
    s1: pd.DataFrame, s2: pd.DataFrame, s3: pd.DataFrame
) -> pd.DataFrame:
    """三时刻 join + 计算 pct/trap_ratio/real_vol

    输入每张表都有: code, last_close, now(此时刻现价), volume, amount
    输出: code, last_close, s1_price, s2_price, s3_price, real_vol, amount, pct, trap_ratio

    公式:
        real_vol = s3.volume - s1.volume   (累计增量手数)
        pct = (s3.now - s1.last_close) / s1.last_close * 100
        trap_ratio = s3.now / max(s2.now, 1e-9)
    """
    if s1.empty or s2.empty or s3.empty:
        return pd.DataFrame(columns=REQUIRED_COLS)

    # 用 last_close 取 s1 的(盘前不变)
    s1_view = s1[["code", "last_close", "now", "volume"]].rename(
        columns={"now": "s1_price", "volume": "s1_vol"}
    )
    s2_view = s2[["code", "now", "volume"]].rename(
        columns={"now": "s2_price", "volume": "s2_vol"}
    )
    s3_view = s3[["code", "now", "volume", "amount"]].rename(
        columns={"now": "s3_price", "volume": "s3_vol"}
    )

    df = s1_view.merge(s2_view, on="code", how="inner").merge(s3_view, on="code", how="inner")
    if df.empty:
        return pd.DataFrame(columns=REQUIRED_COLS)

    df["real_vol"] = (df["s3_vol"].fillna(0) - df["s1_vol"].fillna(0)).clip(lower=0)
    df["amount"] = df["amount"].fillna(0.0)

    last_close = pd.to_numeric(df["last_close"], errors="coerce").replace(0, pd.NA)
    s3_price = pd.to_numeric(df["s3_price"], errors="coerce")
    s2_price = pd.to_numeric(df["s2_price"], errors="coerce")
    df["pct"] = ((s3_price - last_close) / last_close * 100).fillna(0.0)

    s2_safe = s2_price.replace(0, pd.NA)
    df["trap_ratio"] = (s3_price / s2_safe).fillna(1.0)

    return df[REQUIRED_COLS]


# ============ mock 数据生成(供 --mock 验证,生产环境不用) ============

def mock_snapshots(
    codes: Sequence[str], base_price: float = 50.0, seed: int = 42
) -> pd.DataFrame:
    """生成模拟快照,字段对齐真实 snapshot"""
    rng = random.Random(seed)
    rows: list[dict] = []
    for code in codes:
        # 模拟不同涨跌:大多数微涨,少量大涨/大跌
        r = rng.random()
        if r < 0.55:
            pct = rng.uniform(-0.8, 0.8)
        elif r < 0.80:
            pct = rng.uniform(1.5, 4.5)    # 趋势候选
        elif r < 0.90:
            pct = rng.uniform(-4.5, -1.5)  # 反核候选
        else:
            pct = rng.uniform(0, 0)        # 平盘

        last_close = base_price * rng.uniform(0.5, 1.5)
        s1_price = last_close * (1 + rng.uniform(-0.001, 0.001))
        s2_price = last_close * (1 + pct / 100 * rng.uniform(0.5, 1.5))
        s3_price = last_close * (1 + pct / 100)
        amount = rng.uniform(1_000_000, 80_000_000)
        volume = rng.randint(100, 20_000)

        rows.append({
            "code": code,
            "last_close": last_close,
            "s1_price": s1_price,
            "s2_price": s2_price,
            "s3_price": s3_price,
            "amount": amount,
            "volume": volume,
        })
    return pd.DataFrame(rows)


def mock_features(codes: Sequence[str], seed: int = 42) -> pd.DataFrame:
    """直接生成特征 df,跳过三时刻 join(供 --mock 验证主流程)"""
    snaps = mock_snapshots(codes, seed=seed)
    df = snaps.rename(columns={"volume": "real_vol"})  # mock 直接用 volume 当 real_vol
    df["pct"] = ((df["s3_price"] - df["last_close"]) / df["last_close"] * 100)
    df["trap_ratio"] = df["s3_price"] / df["s2_price"].replace(0, pd.NA)
    df["trap_ratio"] = df["trap_ratio"].fillna(1.0)
    return df[REQUIRED_COLS]
