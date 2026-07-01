#!/usr/bin/env python3
"""01实盘监控 — 5分钟明暗盘信号(snapshot 自拼实时5m + dark_flow)

盘中 10 秒采 get_market_snapshot → 5分钟边界本地拼 OHLCV → Python 跑 dark_flow → 信号推飞书。
纯当天实时攒, 零过期(不接任何历史5m; formula/get_market_data 盘中只到昨天, 作废)。

dark_flow 源码移植自 01实盘监控/敏暗盘.md(RSI/量价背离推断, 无需L2)。

模式:
  python dark_flow.py                 # 实盘长驻(盘中 10s 采样, 5m边界触发)
  python dark_flow.py --once          # 单轮(测连通性)
  python dark_flow.py --mock          # 模拟snapshot序列驱动全链路(非交易时段)
  python dark_flow.py --dry-run       # 不推飞书(仍打印+落盘)
"""
from __future__ import annotations

import argparse
import sys
import time as _time
from collections import deque
from datetime import datetime, time as dtime
from pathlib import Path

import numpy as np
import pandas as pd
from loguru import logger
from rich.console import Console
from rich.table import Table

import data
import notify
from config import CONFIG

console = Console()


# ============================================================
#  DARK_FLOW 源码(移植自 敏暗盘.md)
# ============================================================
def calc_rsi(close: pd.Series, period: int = 6) -> pd.Series:
    """Wilder RSI"""
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = (-delta).clip(lower=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-10)
    return 100 - (100 / (1 + rs))


def calc_dark_flow_5m(df: pd.DataFrame) -> pd.DataFrame:
    """每根5m的暗盘/明盘资金。输入列: open/high/low/close/volume/amount"""
    df = df.copy()
    df["rsi6"] = calc_rsi(df["close"], period=6)
    df["pct_change"] = (df["close"] - df["open"]) / (df["open"] + 1e-10) * 100
    df["intent"] = df["rsi6"] - 50
    df["realize"] = df["pct_change"] * 200
    df["gap"] = df["intent"] - df["realize"]
    eps = 1e-8
    df["dark_money"] = np.where(df["gap"] > 0, df["gap"] * df["amount"], 0.0)
    df["light_money"] = np.where(df["realize"] > 0, df["realize"] * df["amount"], 0.0)
    df["trade_date"] = df.index.date
    df["cum_dark"] = df.groupby("trade_date")["dark_money"].cumsum()
    df["cum_light"] = df.groupby("trade_date")["light_money"].cumsum()
    df["ratio"] = df["cum_dark"] / (df["cum_light"] + eps)
    df["dark_ratio"] = df["cum_dark"] / (df["cum_dark"] + df["cum_light"] + eps)
    return df


def calc_dark_flow_derived(df: pd.DataFrame) -> pd.DataFrame:
    """衍生: 量比/加速度/连续性/斜率(窗口不足返回nan, 不影响信号)"""
    df = df.copy()
    eps = 1e-8
    prev_dark = df["dark_money"].shift(1)
    df["dark_accel"] = np.where(prev_dark > eps, df["dark_money"] / (prev_dark + eps) - 1, 0.0)
    df["vol_ratio"] = df["volume"] / (df["volume"].rolling(5).mean().shift(1) + eps)
    return df


def detect_signals(df: pd.DataFrame) -> pd.DataFrame:
    """低点(买)/高点(卖)信号。前6根 cold_start 不触发。"""
    df = df.copy()
    df["kline_index"] = df.groupby("trade_date").cumcount() + 1
    cold = df["kline_index"] <= 6
    cond_low = (
        (df["close"] < df["open"])
        & (df["gap"] > 0)
        & (df["rsi6"] > 30) & (df["rsi6"] < 70)
        & (df["vol_ratio"] > 1.5)
        & (~cold)
    )
    cond_high = (
        (df["close"] > df["open"])
        & (df["gap"] < 0)
        & (df["rsi6"] > 70)
        & (~cold)
    )
    df["low_signal"] = cond_low
    df["high_signal"] = cond_high
    return df


def run_dark_flow(df: pd.DataFrame) -> pd.DataFrame:
    df = calc_dark_flow_5m(df)
    df = calc_dark_flow_derived(df)
    df = detect_signals(df)
    return df


# ============================================================
#  KlineBuilder: 5m边界聚合 OHLCV(纯当天)
# ============================================================
def _bucket_key(ts: datetime) -> datetime:
    """ts 向下对齐到5分钟整数倍(13:07→13:05)"""
    return ts.replace(minute=(ts.minute // 5) * 5, second=0, microsecond=0)


class KlineBuilder:
    """每票一个: 桶内高频采样 Now 取 high/low 极值, 跨桶闭合入 deque。

    snapshot.Max/Min 是当日累计极值, 非单根5m —— 故 high/low 必须桶内 Now 取极值。
    volume/amount 用累计量增量(桶末-桶首)。
    """

    def __init__(self, maxlen: int = 50):
        self.bars: deque = deque(maxlen=maxlen)  # 已闭合5m bar
        self.cur: dict | None = None
        self.cur_bucket: datetime | None = None

    def update(self, now_price: float, volume_cum: float, amount_cum: float, ts: datetime) -> bool:
        """喂一次采样。返回 True=刚闭合了一个桶(触发计算)。"""
        bucket = _bucket_key(ts)
        closed = False
        if self.cur_bucket is not None and bucket != self.cur_bucket:
            # 跨桶: 闭合当前 bar
            self.bars.append({
                "dt": self.cur_bucket, "open": self.cur["open"], "high": self.cur["high"],
                "low": self.cur["low"], "close": self.cur["close"],
                "volume": self.cur["volume"], "amount": self.cur["amount"],
            })
            closed = True
            self.cur = None

        if self.cur is None:
            # 开新桶
            self.cur_bucket = bucket
            self.cur = {
                "open": now_price, "high": now_price, "low": now_price, "close": now_price,
                "_vol_start": volume_cum, "_amt_start": amount_cum,
                "volume": 0.0, "amount": 0.0,
            }
        else:
            # 桶内更新极值 + 末值
            if now_price > self.cur["high"]:
                self.cur["high"] = now_price
            if now_price < self.cur["low"]:
                self.cur["low"] = now_price
            self.cur["close"] = now_price
        # 增量始终刷新(首次=0)
        self.cur["volume"] = volume_cum - self.cur["_vol_start"]
        self.cur["amount"] = amount_cum - self.cur["_amt_start"]
        return closed

    def to_df(self) -> pd.DataFrame:
        """已闭合 bars → DataFrame(open/high/low/close/volume/amount, index=dt)"""
        if not self.bars:
            return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "amount"])
        df = pd.DataFrame(list(self.bars)).set_index("dt")
        return df[["open", "high", "low", "close", "volume", "amount"]]


# ============================================================
#  采样 / 推送
# ============================================================
def _extract(d: dict, code: str) -> dict | None:
    """snapshot 原始 dict → (now/volume/amount)"""
    try:
        now = float(d.get("Now", 0) or 0)
        last_close = float(d.get("LastClose", 0) or 0)
        if now <= 0 or last_close <= 0:
            return None
        return {
            "code": code, "now": now,
            "volume": float(d.get("Volume", 0) or 0),     # 当日累计量
            "amount": float(d.get("Amount", 0) or 0),     # 当日累计额(千元)
            "last_close": last_close,
        }
    except (TypeError, ValueError):
        return None


def fetch_snapshots(codes: list[str]) -> list[dict]:
    """本轮采样(不 initialize/close, 由主循环管理 tq 生命周期)"""
    rows = []
    for code in codes:
        d = data._safe_snapshot(code)
        if not d:
            continue
        snap = _extract(d, code)
        if snap:
            rows.append(snap)
    return rows


def parse_names(path: Path) -> dict[str, str]:
    names: dict[str, str] = {}
    if not path.exists():
        return names
    for line in path.read_text(encoding="utf-8").splitlines():
        parts = line.split("#", 1)
        if len(parts) == 2 and parts[0].strip():
            names[parts[0].strip()] = parts[1].strip()
    return names


def event_from_signal(row: pd.Series, code: str, name: str, sig_type: str) -> dict:
    """信号行 → 事件 dict"""
    return {
        "code": code, "name": name, "ts": row.name, "type": sig_type,
        "severity": "warn", "price": float(row["close"]), "pct": float(row["pct_change"]),
        "detail": (f"close={row['close']:.2f} gap={row['gap']:.1f} rsi6={row['rsi6']:.1f} "
                   f"vol_ratio={row['vol_ratio']:.2f} dark={row['dark_money']:.0f} "
                   f"暗明比={row['ratio']:.2f}"),
    }


def render_bar_table(builders: dict, names: dict, now_dt: datetime) -> None:
    tbl = Table(title=f"5m拼K进度 {now_dt:%H:%M:%S}", show_lines=False)
    for col, w, j in [("代码", 11, "left"), ("名称", 10, "left"), ("已闭合", 6, "right"),
                      ("当前桶close", 10, "right"), ("当前桶高/低", 14, "left")]:
        tbl.add_column(col, width=w, justify=j)
    for code, b in builders.items():
        if b.cur:
            tbl.add_row(code, names.get(code, ""), str(len(b.bars)),
                        f"{b.cur['close']:.2f}", f"{b.cur['low']:.2f} ~ {b.cur['high']:.2f}")
        else:
            tbl.add_row(code, names.get(code, ""), str(len(b.bars)), "-", "-")
    console.print(tbl)


def render_signals(events: list[dict], now_dt: datetime) -> None:
    if not events:
        return
    tbl = Table(title=f"⚡ 明暗盘信号 {now_dt:%H:%M:%S} ({len(events)} 条)", show_lines=False)
    for col, w, j in [("信号", 8, "left"), ("代码", 11, "left"), ("名称", 10, "left"),
                      ("close", 8, "right"), ("pct%", 7, "right"), ("详情", 60, "left")]:
        tbl.add_column(col, width=w, justify=j)
    for ev in events:
        tag = "[green]低点买[/green]" if ev["type"] == "low_signal" else "[red]高点卖[/red]"
        tbl.add_row(tag, ev["code"], ev.get("name", ""), f"{ev['price']:.2f}",
                    f"{ev['pct']:+.2f}", str(ev.get("detail", "")))
    console.print(tbl)


def save_events(events: list[dict], now_dt: datetime) -> None:
    try:
        CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
        path = CONFIG.output_dir / f"dark_flow_events_{now_dt:%Y%m%d}.parquet"
        df_new = pd.DataFrame(events)
        df = pd.concat([pd.read_parquet(path), df_new], ignore_index=True) if path.exists() else df_new
        df.to_parquet(path, index=False)
        logger.info(f"事件落盘 {path} (+{len(df_new)})")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"parquet 落盘跳过: {e}")


# ============================================================
#  一轮处理
# ============================================================
def process_round(codes, names, builders, deduper, args, now_dt: datetime,
                  day_events: list, snap_source) -> list[dict]:
    """处理本轮采样 → 每票喂 builder → 桶闭合则跑 dark_flow → 事件"""
    snaps = snap_source(codes)
    if not snaps:
        return []
    events: list[dict] = []
    for s in snaps:
        code = s["code"]
        if code not in builders:
            continue
        prev_bucket = builders[code].cur_bucket
        closed = builders[code].update(s["now"], s["volume"], s["amount"], now_dt)
        if closed and len(builders[code].bars) >= 7:
            df = builders[code].to_df()
            try:
                result = run_dark_flow(df)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"{code} dark_flow 计算异常: {e}")
                continue
            last = result.iloc[-1]
            if bool(last.get("low_signal", False)):
                events.append(event_from_signal(last, code, names.get(code, ""), "low_signal"))
            if bool(last.get("high_signal", False)):
                events.append(event_from_signal(last, code, names.get(code, ""), "high_signal"))

    if events:
        render_signals(events, now_dt)
        save_events(events, now_dt)
        day_events.extend(events)
        if args.dry_run:
            logger.info(f"[dry-run] 跳过飞书 ({len(events)} 条)")
        else:
            notify.batch_push(events, CONFIG.feishu_webhook, deduper, title="明暗盘信号")
    return events


# ============================================================
#  MOCK
# ============================================================
def _mock_snapshot(code, last_close, pct, vol_cum, amt_cum):
    """模拟一次快照: now = last_close*(1+pct/100)"""
    now = round(last_close * (1 + pct / 100), 2)
    return {"code": code, "now": now, "volume": vol_cum, "amount": amt_cum, "last_close": last_close}


def run_mock(codes, names, builders, deduper, args) -> int:
    """模拟剧情:演绎 收跌+放量+RSI未崩→gap>0→low_signal(暗中吸筹)
    每根5m内采3次(取极值), 跨5m边界触发闭合+dark_flow计算。"""
    logger.info("=== MOCK 模式: 模拟 snapshot 序列驱动拼K+dark_flow ===")
    code = codes[0] if codes else "002008.SZ"
    name = names.get(code, "测试票")
    last_close = 20.0
    import random
    random.seed(1)
    base = datetime(2026, 6, 30, 9, 30)

    # 剧情: 16根5m。前6根 cold_start 不触发。
    # 第7根起:收跌(跌的) + 放量 + RSI 回升至 30-70 区间 → gap>0(跌速放缓但RSI上行)
    # low_signal = close<open AND gap>0 AND 30<rsi6<70 AND vol_ratio>1.5
    # 构造: 每根5m 内价格先低后回升(收一根带下影的跌K, 或收跌但动能修复)
    # 简化: 直接控制每根5m的 open/close/high/low/volume/amount → 喂3个采样点还原
    plot = [
        # (open_pct, close_pct, low_pct, high_pct, vol_mul) 相对 last_close
        (-0.5, -1.0, -1.2, -0.3, 1.0),   # 1 跌
        (-1.0, -1.5, -1.8, -0.8, 0.8),   # 2 跌
        (-1.5, -0.8, -1.6, -0.5, 0.9),   # 3 跌势放缓
        (-0.8, -1.2, -1.4, -0.6, 1.0),   # 4 跌
        (-1.2, -0.6, -1.3, -0.4, 1.1),   # 5 跌势收敛
        (-0.6, -0.9, -1.0, -0.4, 1.0),   # 6 cold_start末
        (-0.9, -0.4, -1.0, -0.2, 1.8),   # 7 收跌+放量↑ + 动能修复 → gap>0 候选
        (-0.4, -0.2, -0.6, 0.0, 2.0),    # 8 收跌+放量
        (-0.2, 0.3, -0.3, 0.5, 1.5),     # 9 转涨
        (0.3, 0.8, 0.2, 1.0, 1.6),       # 10 涨
        (0.8, 1.5, 0.7, 1.7, 1.8),       # 11 涨加速
        (1.5, 2.2, 1.4, 2.4, 2.0),       # 12 强涨
        (2.2, 3.0, 2.1, 3.2, 2.2),       # 13 RSI升高
        (3.0, 3.8, 2.9, 4.0, 2.5),       # 14 接近超买
        (3.8, 4.5, 3.7, 4.7, 2.8),       # 15 高位
        (4.5, 5.2, 4.4, 5.4, 3.0),       # 16 RSI>70 + 滞涨 → high_signal 候选
    ]
    vol_cum, amt_cum = 0.0, 0.0
    base_amount_per_unit = 5000.0  # 每根基础成交额(千元)放大系数
    day_events: list = []
    ts = base
    for i, (op, cp, lp, hp, vm) in enumerate(plot):
        o = last_close * (1 + op / 100)
        c = last_close * (1 + cp / 100)
        lo = last_close * (1 + lp / 100)
        hi = last_close * (1 + hp / 100)
        # 这根5m总成交额(千元)
        bar_amount = base_amount_per_unit * vm * (1 + abs(cp - op) * 0.3)
        bar_vol = bar_amount / ((o + c) / 2) * 1000  # 千元→元再÷价=股, snapshot Volume 单位粗略
        # 桶内3次采样还原 OHLC: 采样点 = open, low, close (取极值)
        samples = [(o, bar_vol / 3, bar_amount / 3),
                   (lo, bar_vol * 2 / 3, bar_amount * 2 / 3),
                   (c, bar_vol, bar_amount)]
        for s_now, s_vol, s_amt in samples:
            vol_cum = s_vol  # 模拟累计量(直接覆盖为该采样点累计)
            amt_cum = s_amt
            builders[code].update(s_now, vol_cum, amt_cum, ts)
        # 强制跨桶(下一个 ts)以闭合本根
        prev_bucket = builders[code].cur_bucket
        next_ts = ts + _time_minutes(5)
        # 用 next_ts update 一次触发闭合(空采样用 close 价)
        builders[code].update(c, vol_cum + 0.01, amt_cum + 0.01, next_ts)
        ts = next_ts

        # 闭合后跑 dark_flow
        if len(builders[code].bars) >= 7:
            df = builders[code].to_df()
            result = run_dark_flow(df)
            last = result.iloc[-1]
            low_sig = bool(last.get("low_signal", False))
            high_sig = bool(last.get("high_signal", False))
            console.print(f"[dim]根{i+1} close={last['close']:.2f} pct={last['pct_change']:+.2f}% "
                          f"gap={last['gap']:.1f} rsi6={last['rsi6']:.1f} vol_r={last['vol_ratio']:.2f}"
                          f" → {'低点买' if low_sig else ''}{'高点卖' if high_sig else ''}[/dim]")
            if low_sig:
                ev = event_from_signal(last, code, name, "low_signal")
                day_events.append(ev)
                if not args.dry_run:
                    notify.batch_push([ev], CONFIG.feishu_webhook, deduper, title="明暗盘信号(mock)")
            if high_sig:
                ev = event_from_signal(last, code, name, "high_signal")
                day_events.append(ev)
                if not args.dry_run:
                    notify.batch_push([ev], CONFIG.feishu_webhook, deduper, title="明暗盘信号(mock)")
    if day_events:
        render_signals(day_events, datetime.now())
    logger.success(f"MOCK 完成: 触发 {len(day_events)} 条信号(dry-run={args.dry_run})")
    return 0


def _time_minutes(m):
    from datetime import timedelta
    return timedelta(minutes=m)


# ============================================================
#  时段 / CLI / main
# ============================================================
def in_trading_session(now_dt: datetime) -> bool:
    if now_dt.weekday() >= 5:
        return False
    t = now_dt.time()
    sch = CONFIG.schedule
    return sch.morning_start <= t < sch.morning_end or sch.afternoon_start <= t < sch.afternoon_end


def wait_for_session() -> None:
    while not in_trading_session(datetime.now()):
        logger.info("非交易时段, 60s 后再探测...")
        _time.sleep(60)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="5分钟明暗盘信号(snapshot自拼+dark_flow)")
    p.add_argument("--pool", default=str(CONFIG.pool_path))
    p.add_argument("--interval", type=int, default=10, help="采样间隔(秒,默认10)")
    p.add_argument("--once", action="store_true", help="单轮(测连通性)")
    p.add_argument("--mock", action="store_true", help="模拟snapshot序列测全链路")
    p.add_argument("--dry-run", action="store_true", help="不推飞书")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    codes = data.load_pool(Path(args.pool))
    if not codes:
        logger.error(f"订阅池为空: {args.pool}")
        return 1
    names = parse_names(Path(args.pool))
    builders = {c: KlineBuilder() for c in codes}
    deduper = notify.Deduper(CONFIG.dedup_window)

    if args.mock:
        return run_mock(codes, names, builders, deduper, args)

    # 实盘: tq 生命周期由主循环管理(initialize 一次)
    if data.tq is None:
        logger.error("tqcenter 未加载")
        return 1
    data.tq.initialize(__file__)
    day_events: list[dict] = []
    try:
        while True:
            if not args.once and not in_trading_session(datetime.now()):
                wait_for_session()
            now_dt = datetime.now()
            evs = process_round(codes, names, builders, deduper, args, now_dt, day_events,
                                snap_source=fetch_snapshots)
            if args.once:
                render_bar_table(builders, names, now_dt)
                logger.info(f"单轮完成: 采样{len(codes)}只, 事件{len(evs)}条")
                break
            if not evs:
                console.print(f"[dim]{now_dt:%H:%M:%S} 采样中, 已闭合"
                              f" {next(iter(builders.values())).bars.__len__() if builders else 0} 根[/dim]")
            _time.sleep(args.interval)
    except KeyboardInterrupt:
        console.print("\n[yellow]Ctrl+C 退出[/yellow]")
    finally:
        try:
            data.tq.close()
        except Exception:  # noqa: BLE001
            pass
        logger.info(f"今日累计明暗盘信号 {len(day_events)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
