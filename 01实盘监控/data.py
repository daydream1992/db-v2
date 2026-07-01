"""01实盘监控 — 数据层

盘中每轮 fetch_all: 对订阅池逐股取 get_market_snapshot 快照 → 标准化为小写列。

字段来源(实测见 竞价监控/probe/snapshot_probe_*.json):
  LastClose/Open/Max/Min/Now/Volume/Amount/NowVol/Inside/Outside/
  Before5MinNow(5分钟前价)/Zangsu(涨速)/TickDiff/Buyp/Buyv/Sellp/Sellv(五档)

单位:Volume/NowVol=手, Amount=千元, Inside/Outside=手, Buyp/Sellp=元, Buyv/Sellv=手。
"""
from __future__ import annotations

import math
import sys
import time as _time
from pathlib import Path

import pandas as pd
from loguru import logger

from config import CONFIG

TQ_SYS_PATH = CONFIG.tq_sys_path
if TQ_SYS_PATH not in sys.path:
    sys.path.insert(0, TQ_SYS_PATH)
try:
    from tqcenter import tq  # type: ignore
except Exception as e:  # noqa: BLE001
    tq = None  # type: ignore
    logger.warning(f"tqcenter 加载失败: {e}")


# ============ 订阅池 ============
def load_pool(path: Path) -> list[str]:
    """读 pool.txt: 每行 <code>  # 名称, 忽略空行/# 注释, 去重保序"""
    if not path.exists():
        return []
    codes: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        s = line.strip().split("#", 1)[0].strip()
        if s:
            codes.append(s)
    return list(dict.fromkeys(codes))


# ============ 字段提取 ============
def _f(d: dict, k: str) -> float:
    """标量字段 → float, 缺失/非法 → nan"""
    v = d.get(k)
    if v is None or v == "":
        return float("nan")
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def _fl(d: dict, k: str, n: int = 5) -> list[float]:
    """五档字段 → list[float](长度 n), 缺档 nan"""
    v = d.get(k)
    if not isinstance(v, list):
        return [float("nan")] * n
    out: list[float] = []
    for i in range(n):
        try:
            out.append(float(v[i]) if i < len(v) else float("nan"))
        except (TypeError, ValueError):
            out.append(float("nan"))
    return out


# ============ 单股快照(带重试) ============
def _safe_snapshot(code: str, max_retry: int = 3) -> dict:
    if tq is None:
        return {}
    for attempt in range(1, max_retry + 1):
        try:
            d = tq.get_market_snapshot(stock_code=code, field_list=[])
            if d and str(d.get("ErrorId")) == "0":
                return d
        except Exception:  # noqa: BLE001
            _time.sleep(0.2 * attempt)
    return {}


# ============ 一轮快照(全池) ============
def fetch_all(codes: list[str]) -> pd.DataFrame:
    """盘中逐股取快照 → 标准化 DataFrame(每行一只票)。

    盘前/停牌 Now=0 的票跳过。tqcenter 缺失抛 RuntimeError(mock 模式不调本函数)。
    """
    if tq is None:
        raise RuntimeError("tqcenter 未加载(实盘需 K:\\txdlianghua\\PYPlugins\\sys\\tqcenter.py)")
    tq.initialize(__file__)
    rows: list[dict] = []
    try:
        for code in codes:
            d = _safe_snapshot(code)
            if not d:
                continue
            last_close = _f(d, "LastClose")
            now = _f(d, "Now")
            if math.isnan(last_close) or last_close <= 0 or math.isnan(now) or now <= 0:
                continue  # 盘前/停牌/异常
            rows.append({
                "code": code,
                "now": now,
                "open": _f(d, "Open"),
                "max": _f(d, "Max"),
                "min": _f(d, "Min"),
                "last_close": last_close,
                "volume": _f(d, "Volume"),          # 累计成交量(手)
                "amount": _f(d, "Amount"),          # 累计成交额(千元)
                "now_vol": _f(d, "NowVol"),         # 现手(手)
                "inside": _f(d, "Inside"),          # 内盘(手)
                "outside": _f(d, "Outside"),        # 外盘(手)
                "before5min_now": _f(d, "Before5MinNow"),
                "zangsu": _f(d, "Zangsu"),          # 涨速
                "tick_diff": _f(d, "TickDiff"),
                "buyp": _fl(d, "Buyp"),
                "buyv": _fl(d, "Buyv"),
                "sellp": _fl(d, "Sellp"),
                "sellv": _fl(d, "Sellv"),
            })
    finally:
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass
    logger.debug(f"快照取到 {len(rows)}/{len(codes)}")
    return pd.DataFrame(rows)
