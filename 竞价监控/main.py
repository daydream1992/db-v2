#!/usr/bin/env python3
"""竞价监控雷达 v2 — 开盘决策辅助 — 主入口

三模式:
  python main.py --prepare   # 盘前预备(任意时间,落盘 preset,DB 侧全做好)
  python main.py             # 9:25 初筛(读 preset + 取开盘价 + 计算 + 推送)
  python main.py --confirm   # 9:31 修正(9:30 现价对比开盘,跌破3%降级)

9:25 后只做"取开盘价 + 计算"一步,DB 侧盘前已预备,避免开盘掉链子。

@meta table=auction_monitor cn=竞价监控雷达 dir=竞价监控 sort=005
@meta schedule=realtime mode=monitor source=tqcenter+snapshot+db
"""
from __future__ import annotations

import argparse
import sys
import time as _time
from datetime import datetime, time as dtime
from pathlib import Path

import duckdb
import pandas as pd
from loguru import logger
from rich.console import Console
from rich.table import Table

import data
import db
import engine
import notify
from config import CONFIG, LABELS
from engine import label_cn, label_all, merge_open_db

console = Console()

CONF_COLOR = {"high": "green", "medium": "yellow", "low": "red"}


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="竞价监控雷达 v2 - 开盘决策辅助")
    p.add_argument("--prepare", action="store_true", help="盘前预备(落盘 preset)")
    p.add_argument("--confirm", action="store_true", help="9:31 修正模式")
    p.add_argument("--fix", action="store_true", help="盘后修复(补缺失snapshot+重跑标签)")
    p.add_argument("--no-wait", action="store_true", help="不等待,立即跑(测试)")
    p.add_argument("--pool", type=Path, default=CONFIG.pool_path)
    p.add_argument("--top", type=int, default=CONFIG.top_n)
    return p.parse_args()


def wait_until(target: dtime, slack_s: float = 0.5) -> None:
    now = datetime.now()
    now_s = now.hour * 3600 + now.minute * 60 + now.second
    tgt_s = target.hour * 3600 + target.minute * 60 + target.second
    delta = tgt_s - now_s
    if delta <= -slack_s:
        return
    if delta > 0:
        logger.info(f"等待到 {target} (还差 {delta:.0f}s)")
        _time.sleep(max(0.0, delta - slack_s))


# ============ 输出辅助 ============

def _zjl_pct(r) -> str:
    v = r.get("zjl_ratio")
    return f"{v*100:+.2f}" if pd.notna(v) else "-"


def _mcap_yi(r) -> str:
    v = r.get("float_mcap")
    return f"{v/1e8:.1f}" if pd.notna(v) else "-"


def _conf_tag(conf: str) -> str:
    color = CONF_COLOR.get(conf or "", "white")
    short = {"high": "高", "medium": "中", "low": "低"}.get(conf, conf or "")
    return f"[{color}]{short}[/{color}]"


def render_table(df: pd.DataFrame, top_n: int, title: str) -> None:
    if df.empty:
        console.print("[yellow]无结果[/yellow]")
        return
    tbl = Table(title=title, show_lines=False)
    for col, w, j in [("RK", 3, "right"), ("CODE", 11, "left"), ("标签", 16, "left"),
                      ("PCT%", 7, "right"), ("昨%", 6, "right"), ("主力%", 7, "right"),
                      ("市值亿", 7, "right"), ("惯骗", 4, "right"), ("置信", 4, "right"),
                      ("原因", 30, "left")]:
        tbl.add_column(col, width=w, justify=j)
    for i, r in df.head(top_n).iterrows():
        lab = LABELS.get(r.get("label"))
        color = lab.color if lab else "white"
        tag = lab.cn if lab else str(r.get("label", ""))
        if r.get("aux") and r["aux"] in LABELS:
            tag += f"+{LABELS[r['aux']].cn}"
        yest = r.get("yest_pct")
        tbl.add_row(
            str(i + 1), str(r["code"]), f"[{color}]{tag}[/{color}]",
            f"{r['open_pct']:+.2f}",
            f"{yest:+.1f}" if pd.notna(yest) else "-",
            _zjl_pct(r), _mcap_yi(r),
            str(int(r.get("trap_cnt", 0) or 0)),
            _conf_tag(r.get("confidence", "high")),
            str(r.get("reason", "")),
        )
    console.print(tbl)


def write_md(df: pd.DataFrame, top_n: int, run_ts: datetime, phase: str) -> Path:
    CONFIG.report_dir.mkdir(parents=True, exist_ok=True)
    stamp = run_ts.strftime("%Y%m%d_%H%M%S")
    path = CONFIG.report_dir / f"auction_{phase}_{stamp}.md"
    data_date = df["data_date"].iloc[0] if (not df.empty and "data_date" in df.columns) else "?"
    lines = [f"# 竞价监控 {phase} - {run_ts:%Y-%m-%d %H:%M:%S}",
             f"(T-1 数据日期: {data_date})", ""]
    if not df.empty:
        lines.append("## 标签分布")
        for k in ["strong_continue", "dip_buy", "trap_warning", "fund_diverge", "nuclear", "neutral"]:
            n = int((df["label"] == k).sum())
            if n:
                lines.append(f"- {label_cn(k)}: {n}")
        lines.append("")
        lines.append("## 置信度分布")
        for k in ["high", "medium", "low"]:
            n = int((df.get("confidence", pd.Series()) == k).sum())
            if n:
                lines.append(f"- {k}: {n}")
        lines.append("")
    lines.append(f"## TOP {top_n}")
    lines.append("")
    lines.append("| RK | CODE | 标签 | PCT% | 昨% | 主力% | 市值亿 | 惯骗 | 置信 | 原因 |")
    lines.append("|---:|------|------|-----:|-----:|------:|------:|-----:|------|")
    if not df.empty:
        for i, r in df.head(top_n).iterrows():
            yest = r.get("yest_pct")
            lines.append(
                f"| {i+1} | {r['code']} | {label_cn(r.get('label'))} | "
                f"{r['open_pct']:+.2f} | {f'{yest:+.1f}' if pd.notna(yest) else '-'} | "
                f"{_zjl_pct(r)} | {_mcap_yi(r)} | {int(r.get('trap_cnt',0) or 0)} | "
                f"{r.get('confidence','high')} | {r.get('reason','')} |"
            )
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"MD: {path}")
    return path


def write_parquet(df: pd.DataFrame, run_ts: datetime, phase: str) -> Path | None:
    if df.empty:
        return None
    CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
    day = run_ts.strftime("%Y%m%d")
    path = CONFIG.output_dir / f"auction_{phase}_{day}.parquet"
    out = df.copy()
    out.insert(0, "run_ts", run_ts)
    out.to_parquet(path, index=False)
    logger.info(f"parquet: {path} ({len(out)} 行)")
    return path


def write_xlsx(df: pd.DataFrame, top_n: int, run_ts: datetime, phase: str) -> Path | None:
    """表格输出到 report_dir(xlsx,给人看,飞书之外本地留存)"""
    if df.empty:
        return None
    CONFIG.report_dir.mkdir(parents=True, exist_ok=True)
    stamp = run_ts.strftime("%Y%m%d_%H%M%S")
    path = CONFIG.report_dir / f"auction_{phase}_{stamp}.xlsx"
    out = df.copy()
    out.insert(0, "RK", range(1, len(out) + 1))
    if "label" in out.columns:
        out["标签"] = out["label"].apply(label_cn)
    if "zjl_ratio" in out.columns:
        out["主力占比%"] = pd.to_numeric(out["zjl_ratio"], errors="coerce") * 100
    if "float_mcap" in out.columns:
        out["流通市值(亿)"] = pd.to_numeric(out["float_mcap"], errors="coerce") / 1e8
    keep = ["RK", "code", "标签", "open_pct", "yest_pct", "主力占比%", "流通市值(亿)",
            "trap_cnt", "confidence", "reason"]
    out = out[[c for c in keep if c in out.columns]].rename(columns={
        "code": "代码", "open_pct": "开盘%", "yest_pct": "昨涨%",
        "trap_cnt": "惯骗次数", "confidence": "置信度", "reason": "原因"})
    out.to_excel(path, index=False)
    logger.info(f"xlsx: {path}")
    return path


def _feishu_rows(df: pd.DataFrame, top_n: int) -> list[dict]:
    rows = []
    for _, r in df.head(top_n).iterrows():
        conf_mark = {"high": "", "medium": "⚠", "low": "‼"}.get(r.get("confidence", "high"), "")
        rows.append({
            "code": r["code"], "label_cn": label_cn(r.get("label")),
            "aux_cn": label_cn(r["aux"]) if r.get("aux") else "",
            "reason": f"{r.get('reason','')}{conf_mark}",
        })
    return rows


# ============ 阶段0:盘前预备 ============

def run_prepare(args, th) -> int:
    logger.info("=== 盘前预备 ===")
    con = duckdb.connect(str(CONFIG.db_path), read_only=True)
    try:
        report = data.prepare_preset(con, th)
    finally:
        con.close()

    f = report["fresh"]
    console.print(f"[green]盘前预备完成[/green]: {report['count']} 只")
    console.print(f"  数据日期={f['data_date']} 滞后{f['lag_days']}天 "
                  f"turnover/sjb一致={f['consistent']}")
    console.print(f"  置信度分布={report['confidence']}")
    console.print(f"  落盘={report['path']}")
    if f["lag_days"] >= 4 or not f["consistent"]:
        console.print("[yellow]⚠ 数据滞后或表日期不一致,9:25 结果置信度会降[/yellow]")
    logger.success("[OK] 盘前预备完成,9:25 后跑 python main.py 即可")
    return 0


# ============ 阶段1:9:25 初筛(读 preset + 取开盘价) ============

def run_initial(args, th) -> int:
    run_ts = datetime.now()
    if not args.no_wait:
        wait_until(CONFIG.schedule.initial_wait)

    try:
        preset = data.load_preset()
    except FileNotFoundError as e:
        logger.error(str(e))
        return 1

    # 唯一实时步骤:取开盘价(全空重试,应对撮合价推送延迟)
    codes = preset["code"].tolist()
    open_df = pd.DataFrame()
    for attempt in range(1, 4):
        open_df = data.fetch_open_snapshot(codes)
        if not open_df.empty:
            break
        logger.warning(f"开盘快照空(撮合价可能未到),5秒后重试 {attempt}/3")
        _time.sleep(5)
    if open_df.empty:
        logger.error("开盘快照重试3次仍空(未到9:25 / 市场未开盘 / tqcenter故障)")
        return 0

    # 入表持久化(失败可盘后 --fix 修复)
    con_rw = db.connect()
    try:
        db.ensure_tables(con_rw)
        db.save_snapshot(con_rw, open_df, source="live")
        df = merge_open_db(open_df, preset)
        df = data.filter_abnormal(df)
        df = label_all(df, th)
        db.save_labels(con_rw, df, phase="initial")
    finally:
        con_rw.close()
    logger.info(f"初筛打标 {len(df)} 只")

    render_table(df, args.top, f"竞价初筛 {run_ts:%H:%M}")
    write_md(df, args.top, run_ts, "initial")
    write_xlsx(df, args.top, run_ts, "initial")
    write_parquet(df, run_ts, "initial")
    notify.push_feishu(_feishu_rows(df, args.top), CONFIG.feishu_webhook,
                       title=f"竞价初筛 {run_ts:%H:%M}")
    logger.success(f"[OK] 初筛完成 {run_ts:%H:%M:%S}")
    return 0


# ============ 阶段2:9:31 修正 ============

def run_confirm(args, th) -> int:
    run_ts = datetime.now()
    if not args.no_wait:
        wait_until(CONFIG.schedule.confirm_wait)

    day = run_ts.strftime("%Y%m%d")
    initial_path = CONFIG.output_dir / f"auction_initial_{day}.parquet"
    if not initial_path.exists():
        logger.error(f"找不到当日初筛 {initial_path},无法修正")
        return 1
    initial = pd.read_parquet(initial_path)
    strong = initial[initial["label"] == "strong_continue"].copy()
    if strong.empty:
        console.print("[yellow]初筛无强势延续票,无需9:31修正[/yellow]")
        return 0

    logger.info(f"9:30 后取 {len(strong)} 只强势延续票现价")
    now_df = data.fetch_open_snapshot(strong["code"].tolist())
    if now_df.empty:
        logger.error("现价快照空")
        return 1

    cmp = strong.merge(
        now_df[["code", "now_price"]].rename(columns={"now_price": "current_price"}),  # 9:31现价,避初筛now_price冲突
        on="code", how="left",
    )
    cmp["drop_pct"] = (cmp["current_price"] - cmp["open_price"]) / cmp["open_price"] * 100
    mask_down = cmp["drop_pct"] < th.confirm_drop_pct
    cmp.loc[mask_down, "label"] = "downgraded"
    cmp.loc[mask_down, "reason"] = cmp.loc[mask_down].apply(
        lambda r: f"9:30跌破{r['drop_pct']:+.1f}%·降级({r['open_price']:.2f}→{r['current_price']:.2f})", axis=1)

    down_n = int(mask_down.sum())
    logger.warning(f"强势延续票 {down_n}/{len(cmp)} 只跌破开盘{th.confirm_drop_pct}% 降级")

    con_rw = db.connect()
    try:
        db.ensure_tables(con_rw)
        db.save_labels(con_rw, cmp, phase="confirm")
    finally:
        con_rw.close()

    title = f"竞价修正 {run_ts:%H:%M} (降级{down_n}/{len(cmp)})"
    render_table(cmp, len(cmp), title)
    write_md(cmp, len(cmp), run_ts, "confirm")
    write_xlsx(cmp, len(cmp), run_ts, "confirm")
    notify.push_feishu(_feishu_rows(cmp, len(cmp)), CONFIG.feishu_webhook, title=title)
    logger.success(f"[OK] 修正完成 {run_ts:%H:%M:%S}")
    return 0


def run_fix(args, th) -> int:
    """盘后修复:补缺失 snapshot(snapshot.Open 开盘价)+ 重跑标签"""
    logger.info("=== 盘后修复 ===")
    try:
        preset = data.load_preset()
    except FileNotFoundError as e:
        logger.error(str(e))
        return 1
    con_rw = db.connect()
    try:
        db.ensure_tables(con_rw)
        missing = db.get_missing_codes(con_rw, preset["code"].tolist())
        if missing:
            logger.info(f"缺失 {len(missing)} 只,调 snapshot.Open 补")
            open_df = data.fetch_open_snapshot(missing)
            if not open_df.empty:
                db.save_snapshot(con_rw, open_df, source="fix")
        snap = db.load_snapshot(con_rw)
        if snap.empty:
            logger.error("当日无 snapshot,无法修复")
            return 1
        df = merge_open_db(snap, preset)
        df = data.filter_abnormal(df)
        df = label_all(df, th)
        db.save_labels(con_rw, df, phase="initial")  # 覆盖 initial
    finally:
        con_rw.close()

    run_ts = datetime.now()
    render_table(df, args.top, f"竞价修复 {run_ts:%H:%M}")
    write_md(df, args.top, run_ts, "fix")
    write_xlsx(df, args.top, run_ts, "fix")
    notify.push_feishu(_feishu_rows(df, args.top), CONFIG.feishu_webhook,
                       title=f"竞价修复 {run_ts:%H:%M}")
    logger.success(f"[OK] 修复完成 {run_ts:%H:%M:%S}")
    return 0


def render_strong(df: pd.DataFrame, top_n: int, title: str) -> None:
    """简约输出:强势排序 + 线性解读(高风险已剔除,不显示)"""
    if df.empty:
        console.print("[yellow]无强势股(高风险剔除后无足够强势候选)[/yellow]")
        return
    tbl = Table(title=title, show_lines=False)
    for col, w, j in [("RK", 3, "right"), ("CODE", 11, "left"), ("涨幅%", 7, "right"),
                      ("斜率", 6, "right"), ("解读", 42, "left")]:
        tbl.add_column(col, width=w, justify=j)
    for i, r in df.head(top_n).iterrows():
        tbl.add_row(str(i + 1), str(r["code"]),
                    f"{r['last_pct']:+.2f}", f"{r['slope']:+.2f}", str(r["interp"]))
    console.print(tbl)


def _strong_rows(df: pd.DataFrame, top_n: int) -> list[dict]:
    """飞书简约:涨幅作 label,解读作 reason"""
    rows = []
    for _, r in df.head(top_n).iterrows():
        rows.append({"code": r["code"], "label_cn": f"{r['last_pct']:+.1f}%",
                     "aux_cn": "", "reason": r["interp"]})
    return rows


def write_strong_md(df: pd.DataFrame, top_n: int, run_ts: datetime) -> Path:
    CONFIG.report_dir.mkdir(parents=True, exist_ok=True)
    stamp = run_ts.strftime("%Y%m%d_%H%M%S")
    path = CONFIG.report_dir / f"auction_strong_{stamp}.md"
    lines = [f"# 竞价强势排序 - {run_ts:%Y-%m-%d %H:%M:%S}", "",
             f"高风险已剔除(惯骗≥3/资金背离/流通<20亿),按线性斜率降序。", ""]
    if df.empty:
        lines.append("无强势候选。")
    else:
        lines.append("| RK | CODE | 涨幅% | 斜率 | R² | 解读 |")
        lines.append("|---:|------|------:|-----:|---:|------|")
        for i, r in df.head(top_n).iterrows():
            lines.append(f"| {i+1} | {r['code']} | {r['last_pct']:+.2f} | "
                         f"{r['slope']:+.2f} | {r['r2']:.2f} | {r['interp']} |")
    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"MD: {path}")
    return path


def run_trend(args, th) -> int:
    """竞价趋势:9:15-9:25 每2分钟采样 → 线性拟合 → 强势排序(高风险剔除)→ 简约输出"""
    run_ts = datetime.now()
    try:
        preset = data.load_preset()
    except FileNotFoundError as e:
        logger.error(str(e))
        return 1
    codes = preset["code"].tolist()
    sample_times = CONFIG.trend.sample_times
    logger.info(f"=== 竞价趋势: {len(codes)}只 × {len(sample_times)}点(9:15-9:25 每2分钟)===")

    series = data.fetch_price_series(codes, sample_times)
    df = engine.rank_strong(series, preset, CONFIG.trend)
    logger.info(f"强势候选 {len(df)} 只(高风险已剔除)")

    title = f"竞价强势 {datetime.now():%H:%M} TOP{min(args.top, len(df))}"
    render_strong(df, args.top, title)
    if not df.empty:
        write_strong_md(df, args.top, run_ts)
        out = df.copy()
        out.insert(0, "run_ts", run_ts)
        CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
        out.to_parquet(CONFIG.output_dir / f"auction_strong_{run_ts:%Y%m%d}.parquet", index=False)
        con_rw = db.connect()
        try:
            db.ensure_tables(con_rw)
            db.save_labels(con_rw, out, phase="trend")
        finally:
            con_rw.close()
        notify.push_feishu(_strong_rows(df, args.top), CONFIG.feishu_webhook, title=title)
    logger.success(f"[OK] 竞价趋势完成 {datetime.now():%H:%M:%S}")
    return 0


def main() -> int:
    args = parse_args()
    th = CONFIG.thresholds
    if args.fix:
        return run_fix(args, th)
    if args.prepare:
        return run_prepare(args, th)
    if args.confirm:
        return run_confirm(args, th)
    return run_trend(args, th)


if __name__ == "__main__":
    sys.exit(main())
