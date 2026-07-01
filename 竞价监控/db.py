"""竞价监控 — DB 持久化(入项目库 profit_radar.duckdb,自管,不走 run.py 治理)

两张表:
  auction_snapshot  每日开盘快照(实时取,失败盘后可补)
  auction_labels    每日标签结果(初筛/修正/修复都入)

UPSERT:同日同票(同 phase)覆盖。DELETE + INSERT,简单稳。
"""
from __future__ import annotations

from datetime import date

import pandas as pd
from loguru import logger

from config import CONFIG


DDL_SNAPSHOT = """
CREATE TABLE IF NOT EXISTS auction_snapshot (
    hq_date     DATE,
    code        VARCHAR(20),
    last_close  DOUBLE,
    open_price  DOUBLE,
    now_price   DOUBLE,
    volume      BIGINT,
    amount      DOUBLE,
    fetch_time  TIMESTAMP,
    source      VARCHAR(10),
    PRIMARY KEY (hq_date, code)
)"""
DDL_LABELS = """
CREATE TABLE IF NOT EXISTS auction_labels (
    hq_date     DATE,
    code        VARCHAR(20),
    phase       VARCHAR(10),
    label       VARCHAR(20),
    aux         VARCHAR(20),
    confidence  VARCHAR(10),
    open_pct    DOUBLE,
    zjl_ratio   DOUBLE,
    float_mcap  DOUBLE,
    trap_cnt    INTEGER,
    reason      VARCHAR(120),
    run_ts      TIMESTAMP,
    PRIMARY KEY (hq_date, code, phase)
)"""


def connect(read_only: bool = False):
    import duckdb
    return duckdb.connect(str(CONFIG.db_path), read_only=read_only)


def ensure_tables(con) -> None:
    con.execute(DDL_SNAPSHOT)
    con.execute(DDL_LABELS)


def _today(hq_date) -> pd.Timestamp:
    return pd.to_datetime(hq_date or date.today())


def save_snapshot(con, df: pd.DataFrame, source: str = "live", hq_date=None) -> int:
    """UPSERT 开盘快照(同日覆盖)。source: live/fix"""
    if df.empty:
        logger.warning("snapshot 空,跳过入表")
        return 0
    d = _today(hq_date)
    rows = pd.DataFrame({
        "hq_date": d,
        "code": df["code"].values,
        "last_close": df.get("last_close").values if "last_close" in df else None,
        "open_price": df.get("open_price").values if "open_price" in df else None,
        "now_price": df.get("now_price").values if "now_price" in df else None,
        "volume": df.get("volume").values if "volume" in df else None,
        "amount": df.get("amount").values if "amount" in df else None,
        "fetch_time": pd.Timestamp.now(),
        "source": source,
    })
    con.execute("DELETE FROM auction_snapshot WHERE hq_date = ?", [d])
    con.register("_snap", rows)
    con.execute("INSERT INTO auction_snapshot SELECT * FROM _snap")
    con.unregister("_snap")
    logger.info(f"snapshot 入表 {len(rows)} 只 source={source} hq_date={d.date()}")
    return len(rows)


def save_labels(con, df: pd.DataFrame, phase: str, hq_date=None) -> int:
    """UPSERT 标签结果(同日同 phase 覆盖)。phase: initial/confirm"""
    if df.empty:
        return 0
    d = _today(hq_date)
    rows = pd.DataFrame({
        "hq_date": d,
        "code": df["code"].values,
        "phase": phase,
        "label": df.get("label").values if "label" in df else None,
        "aux": df.get("aux").values if "aux" in df else None,
        "confidence": df.get("confidence").values if "confidence" in df else None,
        "open_pct": df.get("open_pct").values if "open_pct" in df else None,
        "zjl_ratio": df.get("zjl_ratio").values if "zjl_ratio" in df else None,
        "float_mcap": df.get("float_mcap").values if "float_mcap" in df else None,
        "trap_cnt": df.get("trap_cnt").values if "trap_cnt" in df else None,
        "reason": df.get("reason").values if "reason" in df else None,
        "run_ts": pd.Timestamp.now(),
    })
    con.execute("DELETE FROM auction_labels WHERE hq_date = ? AND phase = ?", [d, phase])
    con.register("_lab", rows)
    con.execute("INSERT INTO auction_labels SELECT * FROM _lab")
    con.unregister("_lab")
    logger.info(f"labels 入表 {len(rows)} 只 phase={phase} hq_date={d.date()}")
    return len(rows)


def get_missing_codes(con, codes: list[str], hq_date=None) -> list[str]:
    """当日 auction_snapshot 缺失的 code(用于盘后修复)"""
    d = _today(hq_date)
    existing = con.execute(
        "SELECT code FROM auction_snapshot WHERE hq_date = ?", [d]
    ).fetchdf()
    have = set(existing["code"]) if not existing.empty else set()
    return [c for c in codes if c not in have]


def load_snapshot(con, hq_date=None) -> pd.DataFrame:
    """读当日全部 snapshot(修复后重跑标签用)"""
    d = _today(hq_date)
    return con.execute(
        "SELECT code, last_close, open_price, now_price, volume, amount "
        "FROM auction_snapshot WHERE hq_date = ?", [d]
    ).fetchdf()
