#!/usr/bin/env python3
"""01实盘监控 — 订阅式盘中异动监控 — 主入口

模式:
  python main.py                 # 实盘长驻(盘中 9:30-11:30/13:00-15:00, 每15秒轮询)
  python main.py --once          # 跑一轮就退出(测连通性, 任意时段)
  python main.py --mock          # 模拟剧情驱动异动(无 tqcenter/非交易时段测全链路)
  python main.py --dry-run       # 检测+打印+落盘, 不推飞书(可配 --mock/--once/--长驻)
  python main.py --pool x.txt    # 自定义订阅池

异动推飞书(同股同类型3分钟去重, 封板/炸板豁免); 事件落 output/events_YYYYMMDD.parquet。

@meta table=intraday_monitor cn=订阅实盘监控 dir=01实盘监控 sort=001
@meta schedule=realtime mode=monitor source=tqcenter+snapshot
"""
from __future__ import annotations

import argparse
import sys
import time as _time
from collections import Counter
from datetime import datetime, time as dtime

import pandas as pd
from loguru import logger
from rich.console import Console
from rich.table import Table

import capital
import data
import engine
import notify
from config import CONFIG, LABELS, label_cn

console = Console()
SEV_COLOR = {"critical": "red", "warn": "yellow", "info": "cyan"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="01实盘监控 - 订阅式盘中异动监控")
    p.add_argument("--pool", default=str(CONFIG.pool_path), help="订阅池文件")
    p.add_argument("--interval", type=int, default=CONFIG.schedule.poll_interval, help="轮询间隔(秒)")
    p.add_argument("--once", action="store_true", help="跑一轮就退出(测连通性)")
    p.add_argument("--mock", action="store_true", help="模拟剧情驱动(非交易时段测全链路)")
    p.add_argument("--mock-sleep", type=float, default=0.4, help="mock 步间隔(秒)")
    p.add_argument("--dry-run", action="store_true", help="不推飞书(仍打印+落盘)")
    p.add_argument("--no-capital", action="store_true", help="禁用主力资金(ZLJE)差额检测")
    return p.parse_args()


def parse_names(path) -> dict[str, str]:
    """从 pool.txt 注释读 code→名称"""
    from pathlib import Path
    names: dict[str, str] = {}
    if not Path(path).exists():
        return names
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        parts = line.split("#", 1)
        if len(parts) == 2:
            code = parts[0].strip()
            if code:
                names[code] = parts[1].strip()
    return names


# ============ 时段判断 ============
def in_trading_session(now_dt: datetime) -> bool:
    if now_dt.weekday() >= 5:
        return False
    t = now_dt.time()
    sch = CONFIG.schedule
    return sch.morning_start <= t < sch.morning_end or sch.afternoon_start <= t < sch.afternoon_end


def wait_for_session() -> None:
    """非交易时段阻塞等待, 每 60 秒探测一次"""
    while not in_trading_session(datetime.now()):
        logger.info("非交易时段, 60s 后再探测...")
        _time.sleep(60)


# ============ 输出 ============
def _fmt_ts(ts) -> str:
    if isinstance(ts, str):
        return ts
    try:
        return ts.strftime("%H:%M:%S")
    except AttributeError:
        return str(ts)


def render_snapshot(df: pd.DataFrame, names: dict, now_dt: datetime) -> None:
    tbl = Table(title=f"订阅池快照 {now_dt:%H:%M:%S}", show_lines=False)
    for col, w, j in [("代码", 11, "left"), ("名称", 10, "left"), ("现价", 8, "right"),
                      ("涨跌%", 7, "right"), ("5分%", 7, "right"), ("日内位%", 7, "right"),
                      ("状态", 8, "left")]:
        tbl.add_column(col, width=w, justify=j)
    th = CONFIG.thresholds
    for _, r in df.iterrows():
        d = engine.derive(r, th)
        sealed = d["is_at_limit_up"] and _sellv0(r) <= th.limit_seal_sellv_max
        pos = f"{d['day_pos'] * 100:.0f}"
        color = "red" if d["pct"] > 0 else ("green" if d["pct"] < 0 else "white")
        tbl.add_row(str(r["code"]), names.get(str(r["code"]), ""), f"{d['now']:.2f}",
                    f"[{color}]{d['pct']:+.2f}[/{color}]",
                    f"{d['min5_pct']:+.2f}" if pd.notna(d["min5_pct"]) else "-",
                    pos, "[red]封板[/red]" if sealed else "")
    console.print(tbl)


def _sellv0(r) -> float:
    v = r.get("sellv") if hasattr(r, "get") else r["sellv"]
    try:
        return float(v[0]) if v and pd.notna(v[0]) else float("inf")
    except (TypeError, ValueError, IndexError):
        return float("inf")


def render_events(events: list[dict], now_dt: datetime) -> None:
    if not events:
        return
    tbl = Table(title=f"⚡ 异动 {now_dt:%H:%M:%S} ({len(events)} 条)", show_lines=False)
    for col, w, j in [("类型", 12, "left"), ("代码", 11, "left"), ("名称", 10, "left"),
                      ("时间", 8, "left"), ("现价", 8, "right"), ("涨幅%", 7, "right"),
                      ("详情", 42, "left")]:
        tbl.add_column(col, width=w, justify=j)
    for ev in events:
        c = SEV_COLOR.get(ev["severity"], "white")
        tbl.add_row(f"[{c}]{label_cn(ev['type'])}[/{c}]", ev["code"], ev.get("name", ""),
                    _fmt_ts(ev["ts"]), f"{ev['price']:.2f}", f"{ev['pct']:+.2f}",
                    str(ev.get("detail", "")))
    console.print(tbl)


def save_events(events: list[dict], now_dt: datetime) -> None:
    """追加到 output/events_YYYYMMDD.parquet(pyarrow 缺失则跳过)"""
    try:
        CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
        path = CONFIG.output_dir / f"events_{now_dt:%Y%m%d}.parquet"
        df_new = pd.DataFrame(events)
        df = pd.concat([pd.read_parquet(path), df_new], ignore_index=True) if path.exists() else df_new
        df.to_parquet(path, index=False)
        logger.info(f"事件落盘 {path} (+{len(df_new)} 行, 累计{len(df)})")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"parquet 落盘跳过: {e}")


def write_daily_report(events: list[dict], now_dt: datetime) -> None:
    if not events:
        return
    CONFIG.report_dir.mkdir(parents=True, exist_ok=True)
    path = CONFIG.report_dir / f"intraday_{now_dt:%Y%m%d}.md"
    cnt = Counter(e["type"] for e in events)
    lines = [f"# 实盘监控日报 {now_dt:%Y-%m-%d}", "", f"异动事件共 {len(events)} 条", "",
             "## 类型分布"]
    for t, n in cnt.most_common():
        lines.append(f"- {label_cn(t)}: {n}")
    lines += ["", "## 明细",
              "| 时间 | 代码 | 名称 | 类型 | 现价 | 涨幅% | 详情 |",
              "|---|---|---|---|---|---|---|"]
    for e in events:
        lines.append(f"| {_fmt_ts(e['ts'])} | {e['code']} | {e['name']} | {label_cn(e['type'])} | "
                     f"{e['price']:.2f} | {e['pct']:+.2f} | {e.get('detail', '')} |")
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"日报: {path}")


# ============ 一轮(实盘) ============
def run_round(codes, names, states, deduper, args, now_dt: datetime, day_events: list, last_snap: dict) -> int:
    df = data.fetch_all(codes)
    if df.empty:
        logger.warning("本轮快照空(未开盘/停牌/tqcenter 故障)")
        return 1
    th = CONFIG.thresholds
    events: list[dict] = []
    for _, row in df.iterrows():
        code = row["code"]
        if code not in states:
            states[code] = engine.new_state(th)
        d_now = engine.derive(row, th)
        last_snap[code] = {"price": d_now["now"], "pct": d_now["pct"]}
        events.extend(engine.detect_all(row, states[code], th, names.get(code, ""), now_dt))

    render_snapshot(df, names, now_dt)
    if events:
        render_events(events, now_dt)
        save_events(events, now_dt)
        day_events.extend(events)
        if args.dry_run:
            logger.info(f"[dry-run] 跳过飞书 ({len(events)} 条)")
        else:
            notify.batch_push(events, CONFIG.feishu_webhook, deduper)
    else:
        console.print(f"[dim]{now_dt:%H:%M:%S} 本轮无异动[/dim]")
    return 0


# ============ 资金轮询(ZLJE 差额, 独立长间隔) ============
def run_capital(codes, names, prev_capital: dict, last_snap: dict, deduper,
                args, now_dt: datetime, day_events: list) -> None:
    """主力资金(ZLJE)差额检测:与本轮前一次的差超阈值 → 资金异动。

    首轮只记基准不算差额; 仅交易时段有意义(盘后数据冻结差额=0)。
    """
    try:
        curr = capital.fetch_zlje_values(codes, refresh=False)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"ZLJE 取数失败(跳过本轮资金检测): {e}")
        return
    if not curr:
        logger.warning("ZLJE 全空(可能非交易时段/公式未建)")
        return
    th = CONFIG.thresholds
    events: list[dict] = []
    for code in codes:
        if code in prev_capital:
            diff = curr.get(code, 0.0) - prev_capital[code]
            r = engine.detect_capital_flow(diff, th)
            if r:
                etype, detail = r
                lab = LABELS[etype]
                snap = last_snap.get(code, {})
                events.append({
                    "code": code, "name": names.get(code, ""), "ts": now_dt,
                    "type": etype, "severity": lab.severity,
                    "price": snap.get("price", 0.0), "pct": snap.get("pct", 0.0),
                    "detail": detail,
                })
    for code, v in curr.items():  # 更新基准(下一轮差额的起点)
        prev_capital[code] = v

    if events:
        render_events(events, now_dt)
        save_events(events, now_dt)
        day_events.extend(events)
        if args.dry_run:
            logger.info(f"[dry-run] 资金异动跳过飞书 ({len(events)} 条)")
        else:
            notify.batch_push(events, CONFIG.feishu_webhook, deduper)
    else:
        logger.debug(f"资金轮询完成, 无异动 (基准已更新 {len(curr)} 只)")


# ============ MOCK ============
def _mock_snap(code, name, last_close, pct, prev_price, prev_volume):
    now = round(last_close * (1 + pct / 100), 2)
    chg = abs(now / prev_price - 1) * 100 if prev_price else 0.0
    delta_v = 300 + chg * 2000
    volume = (prev_volume or 100000) + delta_v
    hi = round(max(now, last_close) * (1.002 if pct > 0 else 1.0), 2)
    lo = round(min(now, last_close) * (0.998 if pct < 0 else 1.0), 2)
    sealed = pct >= 9.8
    return {
        "code": code, "now": now, "open": round(last_close * 1.001, 2),
        "max": hi, "min": lo, "last_close": last_close,
        "volume": volume, "amount": volume * now / 1000, "now_vol": delta_v,
        "inside": 60000 if pct < 0 else 40000, "outside": 80000 if pct > 0 else 45000,
        "before5min_now": prev_price if prev_price else last_close,
        "zangsu": pct / 5, "tick_diff": now - last_close,
        "buyp": [now - 0.01, 0, 0, 0, 0], "buyv": [200, 0, 0, 0, 0],
        "sellp": [now + 0.01, 0, 0, 0, 0], "sellv": [5 if sealed else 3000, 0, 0, 0, 0],
    }


def run_mock(codes, names, states, deduper, args) -> int:
    """模拟剧情:缓涨→加速→封板→炸板→下跌→反弹, 验证全链路"""
    logger.info("=== MOCK 模式 ===")
    code = codes[0] if codes else "002008.SZ"
    name = names.get(code, "测试票")
    if code not in states:
        states[code] = engine.new_state(CONFIG.thresholds)
    last_close = 20.0
    scenario = [0, 1, 2, 3, 5, 7, 9, 9.9, 9.9, 7, 4, 1, -2, -4, -2, 1, 3, 5, 3, 1, 0]
    prev_price, prev_volume = None, None
    th = CONFIG.thresholds
    all_events: list[dict] = []
    for step, pct in enumerate(scenario):
        snap = _mock_snap(code, name, last_close, pct, prev_price, prev_volume)
        now_dt = datetime.now()
        d = engine.derive(snap, th)
        console.print(f"[dim]step{step:02d} pct={pct:+5.1f}% 现价{d['now']:.2f} "
                      f"5分{d['min5_pct']:+.2f}% 日内{d['day_pos']*100:.0f}% "
                      f"触涨停={d['is_at_limit_up']}[/dim]")
        evs = engine.detect_all(snap, states[code], th, name, now_dt)
        if evs:
            render_events(evs, now_dt)
            all_events.extend(evs)
            if not args.dry_run:
                notify.batch_push(evs, CONFIG.feishu_webhook, deduper)
        prev_price, prev_volume = snap["now"], snap["volume"]
        _time.sleep(args.mock_sleep)
    if all_events:
        save_events(all_events, datetime.now())
    logger.success(f"MOCK 完成: 共触发 {len(all_events)} 条异动事件(dry-run={args.dry_run})")
    return 0


# ============ 主 ============
def main() -> int:
    args = parse_args()
    from pathlib import Path
    codes = data.load_pool(Path(args.pool))
    if not codes:
        logger.error(f"订阅池为空: {args.pool}")
        return 1
    names = parse_names(args.pool)
    th = CONFIG.thresholds
    states = {c: engine.new_state(th) for c in codes}
    deduper = notify.Deduper(CONFIG.dedup_window)

    if args.mock:
        return run_mock(codes, names, states, deduper, args)

    day_events: list[dict] = []
    last_snap: dict = {}
    prev_capital: dict = {}
    last_capital_ts: float | None = None
    try:
        while True:
            if not args.once and not in_trading_session(datetime.now()):
                wait_for_session()
            now_dt = datetime.now()
            run_round(codes, names, states, deduper, args, now_dt, day_events, last_snap)
            # 资金轮询:每 capital_interval 秒一次, 与价格 15s 轮询解耦(formula 慢)
            if not args.no_capital and not args.mock:
                now_ts = now_dt.timestamp()
                if last_capital_ts is None or (now_ts - last_capital_ts) >= CONFIG.capital_interval:
                    run_capital(codes, names, prev_capital, last_snap, deduper, args, now_dt, day_events)
                    last_capital_ts = now_ts
            if args.once:
                break
            _time.sleep(args.interval)
    except KeyboardInterrupt:
        console.print("\n[yellow]收到 Ctrl+C, 退出[/yellow]")
    finally:
        try:
            from tqcenter import tq  # noqa
            tq.close()
        except Exception:  # noqa: BLE001
            pass
        if day_events:
            write_daily_report(day_events, datetime.now())
        logger.info(f"今日累计异动 {len(day_events)} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
