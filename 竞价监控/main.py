#!/usr/bin/env python3
"""竞价监控雷达 — 主入口 (L4 编排)

@meta table=auction_monitor cn=竞价监控雷达 dir=竞价监控 sort=005
@meta schedule=realtime mode=monitor source=tqcenter+snapshot

执行流程:
  1. 解析参数 + 加载 config/pool
  2. 等待三时刻 → 各取一次 snapshot
  3. extract_features 三时刻 join
  4. engine.score_all 评分
  5. 输出三件套:终端 rich.Table + reports/*.md + output/*.parquet
  6. notify.push_feishu 推送(桩,失败不阻塞)
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, time
from pathlib import Path

import pandas as pd
from loguru import logger
from rich.console import Console
from rich.table import Table

import data
import notify
from config import CONFIG, THRESHOLDS
from engine import score_all

# ============ 路径 & 全局 ============
console = Console()
BASE_DIR = CONFIG.base_dir
OUTPUT_DIR = CONFIG.output_dir
REPORT_DIR = CONFIG.report_dir
POOL_PATH = CONFIG.pool_path


# ============ 参数解析 ============

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="竞价监控雷达 (A 股集合竞价实时评分)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""示例:
  python main.py                       # 等待 09:15/09:20/09:25 三时刻实盘跑
  python main.py --mock                # 跳过等待,用 mock 数据演示
  python main.py --no-wait             # 不等时刻,立即取一次(测试用)
  python main.py --pool mypool.txt     # 自定义监控池
  python main.py --top 10              # 只显示 TOP 10
""",
    )
    p.add_argument("--mock", action="store_true", help="用 mock 数据,不连 tqcenter")
    p.add_argument("--no-wait", action="store_true", help="不等待三时刻,立即采样")
    p.add_argument("--pool", type=Path, default=POOL_PATH, help="监控池文件")
    p.add_argument("--top", type=int, default=CONFIG.top_n, help="显示 TOP N")
    return p.parse_args()


# ============ 时序 ============

def wait_until(target: time, slack_s: float = 0.5) -> None:
    """等到目标时刻(早到则 sleep;已过则立即返回)

    使用 datetime.now().time() 而非 time.time(),避免时钟跳变感知不到。
    """
    now_t = datetime.now().time()
    now_s = (now_t.hour * 3600 + now_t.minute * 60 + now_t.second
             + now_t.microsecond / 1e6)
    tgt_s = (target.hour * 3600 + target.minute * 60 + target.second)
    delta = tgt_s - now_s
    if delta <= -slack_s:
        return  # 已过
    if delta > 0:
        logger.info(f"等待到 {target} (还差 {delta:.1f}s)")
        import time as _t
        _t.sleep(max(0.0, delta - slack_s))


# ============ 输出:终端 ============

def render_table(df: pd.DataFrame, top_n: int) -> None:
    """rich.Table 渲染 TOP N"""
    if df.empty:
        console.print("[yellow]无评分结果[/yellow]")
        return

    tbl = Table(title=f"竞价监控 TOP {top_n}", show_lines=False)
    tbl.add_column("RK", style="cyan", width=3, justify="right")
    tbl.add_column("CODE", style="magenta", width=11)
    tbl.add_column("SCORE", style="bold green", width=6, justify="right")
    tbl.add_column("MODE", width=8)
    tbl.add_column("PCT%", width=7, justify="right")
    tbl.add_column("TRAP", width=6, justify="right")
    tbl.add_column("VOL(手)", width=10, justify="right")
    tbl.add_column("AMT(万)", width=10, justify="right")
    tbl.add_column("REASON", width=20)

    for i, row in df.head(top_n).iterrows():
        mode_color = {"trend": "green", "dip": "blue", "weak": "yellow", "anomaly": "red"}.get(
            row.get("mode", ""), "white"
        )
        tbl.add_row(
            str(i + 1),
            str(row.get("code", "")),
            f"{row.get('score', 0):.1f}",
            f"[{mode_color}]{row.get('mode', '')}[/{mode_color}]",
            f"{row.get('pct', 0):+.2f}",
            f"{row.get('trap_ratio', 1):.3f}",
            f"{int(row.get('real_vol', 0)):,}",
            f"{float(row.get('amount', 0)) / 10000:,.1f}",
            str(row.get("reason", "")),
        )
    console.print(tbl)


# ============ 输出:MD 报告 ============

def write_md_report(df: pd.DataFrame, top_n: int, market_open: bool, run_ts: datetime) -> Path:
    """写 reports/auction_monitor_YYYYMMDD_HHMMSS.md"""
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = run_ts.strftime("%Y%m%d_%H%M%S")
    path = REPORT_DIR / f"auction_monitor_{stamp}.md"

    lines: list[str] = []
    lines.append(f"# 竞价监控报告 - {run_ts.strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append("")
    if not market_open:
        lines.append("> [WARN] 市场未开盘,所有股票 mode=anomaly")
        lines.append("")
    lines.append(f"## 评分汇总")
    if not df.empty:
        mode_counts = df["mode"].value_counts().to_dict()
        lines.append(f"- 总数: {len(df)}")
        for m in ("trend", "dip", "weak", "anomaly"):
            lines.append(f"- {m}: {mode_counts.get(m, 0)}")
    lines.append("")

    lines.append(f"## TOP {top_n}")
    lines.append("")
    if not df.empty:
        lines.append("| RK | CODE | SCORE | MODE | PCT% | TRAP | VOL(手) | AMT(万) | REASON |")
        lines.append("|---:|------|------:|------|-----:|-----:|--------:|--------:|--------|")
        for i, row in df.head(top_n).iterrows():
            lines.append(
                f"| {i+1} | {row.get('code','')} | {row.get('score',0):.1f} | "
                f"{row.get('mode','')} | {row.get('pct',0):+.2f} | "
                f"{row.get('trap_ratio',1):.3f} | {int(row.get('real_vol',0)):,} | "
                f"{float(row.get('amount',0))/10000:,.1f} | {row.get('reason','')} |"
            )
    else:
        lines.append("无数据")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")
    logger.info(f"MD 报告: {path}")
    return path


# ============ 输出:parquet ============

def write_parquet(df: pd.DataFrame, run_ts: datetime) -> Path | None:
    """写 output/auction_monitor_YYYYMMDD.parquet (同日覆盖)"""
    if df.empty:
        logger.warning("数据为空,跳过 parquet")
        return None

    try:
        import pyarrow  # noqa: F401
    except ImportError:
        logger.warning("pyarrow 未安装,跳过 parquet")
        return None

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    day = run_ts.strftime("%Y%m%d")
    path = OUTPUT_DIR / f"auction_monitor_{day}.parquet"
    out = df.copy()
    out.insert(0, "run_ts", run_ts)
    out.to_parquet(path, index=False, engine="pyarrow")
    logger.info(f"parquet 落盘: {path} ({len(out)} 行)")
    return path


# ============ 主流程 ============

def run(args: argparse.Namespace) -> int:
    run_ts = datetime.now()

    # 1. 加载监控池
    codes = data.load_pool(args.pool)
    if not codes:
        logger.error("监控池为空,退出")
        return 1

    market_open = True  # 默认市场开盘,后面会判断

    # 2. 决定数据源
    if args.mock:
        logger.info("[MOCK] 使用模拟数据,跳过 tqcenter")
        features = data.mock_features(codes)
    else:
        # 等待三时刻
        if not args.no_wait:
            for label, t in zip(("s1", "s2", "s3"), CONFIG.sampling.all()):
                wait_until(t)
                logger.info(f"取 {label} 快照 @ {datetime.now().strftime('%H:%M:%S')}")

        # 三时刻快照
        try:
            snap_t1 = data.fetch_snapshots(codes, snapshot_at=run_ts)
            if not args.no_wait:
                wait_until(CONFIG.sampling.s2)
                snap_t2 = data.fetch_snapshots(codes, snapshot_at=run_ts)
                wait_until(CONFIG.sampling.s3)
                snap_t3 = data.fetch_snapshots(codes, snapshot_at=run_ts)
            else:
                # no-wait 模式:同一时刻三份相同(实际意义弱,仅测试连通性)
                snap_t1 = data.fetch_snapshots(codes, snapshot_at=run_ts)
                snap_t2 = snap_t1.copy()
                snap_t3 = snap_t1.copy()
        except Exception as e:  # noqa: BLE001
            logger.error(f"取快照失败: {e}")
            return 1

        if snap_t1.empty:
            logger.error("快照全空(可能市场未开盘/网络问题),退出")
            return 0

        # 3. 特征提取
        features = data.extract_features(snap_t1, snap_t2, snap_t3)
        if features.empty:
            logger.error("三时刻 join 后无数据,退出")
            return 0

        # 检测市场是否开盘(所有 s3_price == last_close 视为未开盘)
        if (features["s3_price"] == features["last_close"]).all():
            market_open = False
            logger.warning("s3_price 全部等于昨收,疑似市场未开盘")

    # 4. 评分
    scored = score_all(features, CONFIG.thresholds)
    logger.info(f"评分完成 {len(scored)} 行")

    # 5. 输出三件套
    render_table(scored, args.top)
    write_md_report(scored, args.top, market_open, run_ts)
    write_parquet(scored, run_ts)

    # 6. 飞书推送(桩,失败不阻塞)
    if CONFIG.feishu_webhook:
        top_rows = scored.head(args.top).to_dict("records")
        try:
            notify.push_feishu(top_rows, webhook_url=CONFIG.feishu_webhook)
        except NotImplementedError as e:
            logger.warning(f"飞书推送未实现: {e}")
        except Exception as e:  # noqa: BLE001
            logger.error(f"飞书推送异常: {e}")
    else:
        logger.info("未配置飞书 webhook(在 CONFIG.feishu_webhook 填入可启用推送)")

    logger.success(f"[OK] 完成 {run_ts.strftime('%H:%M:%S')}")
    return 0


if __name__ == "__main__":
    args = parse_args()
    sys.exit(run(args))
