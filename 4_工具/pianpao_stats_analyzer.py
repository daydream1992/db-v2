#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# @meta table=N/A cn=骗炮规律统计 dir=4_工具 sort=004
# @meta schedule=manual mode=read-only source=profit_radar.duckdb
"""
骗炮规律统计 (pianpao_stats_analyzer)

纯查询、不动表不改字典的 markdown 报告生成器。位于 4_工具/ 而不是 reports/,
因为它是有规律会跑的分析工具, 不属于"临时诊断产物"。

输入:
  pianpao_daily (134k 行, 含 trap_type/lifecycle_stage/trap_confirmed/trap_direction)
  stock_daily_kline (T+1 跳点)
  trading_calendar (T+1 交易日历)

输出 (3 份 markdown, 时间戳命名, 落到 reports/):
  pianpao_stats_by_trap_type_<days>d_<timestamp>.md    单陷阱胜率榜
  pianpao_stats_by_lifecycle_<days>d_<timestamp>.md   生命周期 × 陷阱交叉
  pianpao_stats_top_bottom_<days>d_<timestamp>.md      胜率 Top/Bottom 10

口径:
  - trap_type 用 '|' 拼接, 必须 unnest 拆单标签 (否则组合淹没单类)
  - T+1 取 trading_calendar.lead() 跳过周末/节假日
  - 过滤 trap_confirmed IS NOT FALSE (只统计已确认陷阱)
  - 默认近 30 天, --days / --start+--end 可调

用法:
  python 4_工具/pianpao_stats_analyzer.py                  # 近 30 天
  python 4_工具/pianpao_stats_analyzer.py --days 7
  python 4_工具/pianpao_stats_analyzer.py --start 20260601 --end 20260625
"""
import argparse
import sys
from datetime import datetime
from pathlib import Path

import duckdb
import pandas as pd
from loguru import logger

# Windows cmd 默认 GBK, 中文 print 会乱码; 强制 UTF-8 解决
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except (AttributeError, OSError):
    pass

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
REPORTS_DIR = Path(r'K:\DB数据库_v2\reports')
MIN_SAMPLE_TABLE = 10   # by_trap_type 表格显示门槛
MIN_SAMPLE_LIFE = 5     # by_lifecycle 表格显示门槛
MIN_SAMPLE_TB = 20      # top/bottom 榜单门槛


def get_window(con, days=None, start=None, end=None):
    """解析时间窗, 返回 (start_date, end_date) 两个 date 对象。"""
    if start and end:
        s = datetime.strptime(start, '%Y%m%d').date()
        e = datetime.strptime(end, '%Y%m%d').date()
        return s, e
    if start and not end:
        s = datetime.strptime(start, '%Y%m%d').date()
        e = con.execute(
            "SELECT MAX(date) FROM trading_calendar WHERE is_trading = TRUE AND date <= CURRENT_DATE"
        ).fetchone()[0]
        return s, e
    # 默认近 N 个交易日
    n = days or 30
    rows = con.execute(f'''
        SELECT date FROM trading_calendar
        WHERE is_trading = TRUE AND date <= CURRENT_DATE
        ORDER BY date DESC LIMIT {n}
    ''').fetchall()
    return min(r[0] for r in rows), max(r[0] for r in rows)


def load_detail(con, start_date, end_date) -> pd.DataFrame:
    """拉明细: 拆 trap_type '|', JOIN T+1 K线, 算 4 个 chg。"""
    sql = f'''
    WITH exploded AS (
        SELECT
            p.trade_date, p.stock_code, p.lifecycle_stage,
            p.trap_direction, p.trap_confirmed,
            unnest(string_split(p.trap_type, '|')) AS trap_type,
            p.close_price AS t0_close
        FROM pianpao_daily p
        WHERE p.trade_date BETWEEN DATE '{start_date}' AND DATE '{end_date}'
          AND p.trap_direction IN ('bull','bear')
          AND p.trap_confirmed IS NOT FALSE
          AND p.trap_type IS NOT NULL
          AND p.trap_type <> ''
    ),
    next_td AS (
        SELECT date AS td, lead(date) OVER (ORDER BY date) AS next_td
        FROM trading_calendar WHERE is_trading = TRUE
    )
    SELECT
        e.trade_date, e.stock_code,
        e.trap_type, e.trap_direction, e.lifecycle_stage,
        e.t0_close,
        d1.open  AS t1_open, d1.high AS t1_high, d1.close AS t1_close,
        (d1.open  - e.t0_close) / e.t0_close * 100 AS t1_open_chg,
        (d1.high  - e.t0_close) / e.t0_close * 100 AS t1_max_gain,
        (d1.close - e.t0_close) / e.t0_close * 100 AS t1_close_chg,
        (d1.close > e.t0_close) AS t1_win
    FROM exploded e
    JOIN next_td n ON n.td = e.trade_date
    JOIN stock_daily_kline d1 ON d1.code = e.stock_code AND d1.date = n.next_td
    '''
    return con.execute(sql).fetchdf()


def aggregate(df: pd.DataFrame, group_cols: list) -> pd.DataFrame:
    """按 group_cols 聚合, 返回统计表。"""
    g = df.groupby(group_cols, dropna=False).agg(
        sample_n=('t1_close_chg', 'size'),
        win_rate=('t1_win', 'mean'),
        avg_t1_open_chg=('t1_open_chg', 'mean'),
        avg_t1_close_chg=('t1_close_chg', 'mean'),
        median_t1_close_chg=('t1_close_chg', 'median'),
        avg_t1_max_gain=('t1_max_gain', 'mean'),
    ).reset_index()
    # 百分比格式化 (存小数, 渲染时乘 100)
    g['win_rate'] = (g['win_rate'] * 100).round(2)
    for c in ['avg_t1_open_chg', 'avg_t1_close_chg', 'median_t1_close_chg', 'avg_t1_max_gain']:
        g[c] = g[c].round(2)
    g['sample_n'] = g['sample_n'].astype(int)
    return g


# ---------- 报告 1: by_trap_type ----------
def report_by_trap_type(df: pd.DataFrame, period_label: str) -> str:
    g = aggregate(df, ['trap_type', 'trap_direction'])
    g = g[g['sample_n'] >= MIN_SAMPLE_TABLE].sort_values('sample_n', ascending=False)

    # 反信号榜 (高样本低胜率)
    reverse = g[g['sample_n'] >= 50].sort_values('win_rate').head(5)

    lines = [
        f"# 陷阱类型胜率榜 ({period_label})",
        '',
        f"数据源: `pianpao_daily` ({period_label}) 拆 trap_type '|' 后聚合",
        f"门槛: sample_n ≥ {MIN_SAMPLE_TABLE} | 排序: 按样本数降序",
        f"列含义: win_rate = T+1 收盘>陷阱日收盘的占比; chg 单位均为 %",
        '',
        '## 主表 (样本 ≥ ' + str(MIN_SAMPLE_TABLE) + ')',
        '',
        g[['trap_type', 'trap_direction', 'sample_n', 'win_rate',
           'avg_t1_open_chg', 'avg_t1_close_chg', 'median_t1_close_chg',
           'avg_t1_max_gain']].to_markdown(index=False),
        '',
        '## 反信号榜 (样本 ≥ 50, 胜率最低 5 类)',
        '',
        reverse[['trap_type', 'trap_direction', 'sample_n', 'win_rate',
                 'avg_t1_close_chg']].to_markdown(index=False) if not reverse.empty else
        '_无可用反信号样本_',
        '',
    ]
    return '\n'.join(lines)


# ---------- 报告 2: by_lifecycle ----------
def report_by_lifecycle(df: pd.DataFrame, period_label: str) -> str:
    g = aggregate(df, ['lifecycle_stage', 'trap_type', 'trap_direction'])
    g = g[g['sample_n'] >= MIN_SAMPLE_LIFE].sort_values(
        ['lifecycle_stage', 'sample_n'], ascending=[True, False])

    lines = [
        f"# 生命周期 × 陷阱交叉榜 ({period_label})",
        '',
        f"数据源: `pianpao_daily.lifecycle_stage × trap_type × trap_direction`",
        f"门槛: sample_n ≥ {MIN_SAMPLE_LIFE} | 排序: lifecycle 内按样本数降序",
        '',
    ]
    for stage, sub in g.groupby('lifecycle_stage', dropna=False):
        stage_disp = stage if pd.notna(stage) and stage else '(空)'
        lines.append(f"## {stage_disp} ({len(sub)} 类陷阱)")
        lines.append('')
        lines.append(sub[['trap_type', 'trap_direction', 'sample_n', 'win_rate',
                          'avg_t1_open_chg', 'avg_t1_close_chg',
                          'median_t1_close_chg', 'avg_t1_max_gain']].to_markdown(index=False))
        lines.append('')
    return '\n'.join(lines)


# ---------- 报告 3: top/bottom ----------
def report_top_bottom(df: pd.DataFrame, period_label: str) -> str:
    g = aggregate(df, ['trap_type', 'trap_direction', 'lifecycle_stage'])
    g = g[g['sample_n'] >= MIN_SAMPLE_TB]

    top = g.sort_values('win_rate', ascending=False).head(10)
    bot = g.sort_values('win_rate', ascending=True).head(10)

    lines = [
        f"# 胜率 Top / Bottom 榜 ({period_label})",
        '',
        f"数据源: `trap_type × direction × lifecycle_stage` 三维聚合",
        f"门槛: sample_n ≥ {MIN_SAMPLE_TB}",
        '',
        '## Top 10 (胜率最高)',
        '',
        top[['trap_type', 'trap_direction', 'lifecycle_stage', 'sample_n',
             'win_rate', 'avg_t1_close_chg', 'avg_t1_max_gain']].to_markdown(index=False),
        '',
        '## Bottom 10 (胜率最低)',
        '',
        bot[['trap_type', 'trap_direction', 'lifecycle_stage', 'sample_n',
             'win_rate', 'avg_t1_close_chg', 'avg_t1_max_gain']].to_markdown(index=False),
        '',
    ]
    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser(description='骗炮规律总结报告')
    parser.add_argument('--days', type=int, default=30, help='近 N 个交易日 (默认 30)')
    parser.add_argument('--start', help='起始日期 YYYYMMDD (与 --end 配对)')
    parser.add_argument('--end', help='结束日期 YYYYMMDD')
    args = parser.parse_args()

    print(f"连接数据库 (read_only): {DB_PATH}")
    con = duckdb.connect(DB_PATH, read_only=True)
    try:
        start_date, end_date = get_window(con, args.days, args.start, args.end)
        if args.start and args.end:
            period_label = f"{start_date} ~ {end_date}"
        elif args.start:
            period_label = f"{start_date} ~ {end_date}"
        else:
            period_label = f"近 {args.days} 个交易日 ({start_date} ~ {end_date})"
        print(f"时间窗: {period_label}")

        print("拉明细 (拆 trap_type + JOIN T+1 K线)...")
        df = load_detail(con, start_date, end_date)
        print(f"  → 明细 {len(df)} 行")
        if df.empty:
            print("  ✗ 无数据, 退出")
            return 1

        # 整体速览
        n_stocks = df[['trade_date', 'stock_code']].drop_duplicates().shape[0]
        n_traps = df[['trap_type', 'trap_direction']].drop_duplicates().shape[0]
        print(f"  → 涉及 {n_stocks} 只股票 × {n_traps} 类陷阱组合")

        ts = datetime.now().strftime('%Y%m%d-%H%M%S')
        days_tag = f"{(end_date - start_date).days}d"
        REPORTS_DIR.mkdir(exist_ok=True)

        reports = [
            ('by_trap_type', report_by_trap_type(df, period_label)),
            ('by_lifecycle', report_by_lifecycle(df, period_label)),
            ('top_bottom', report_top_bottom(df, period_label)),
        ]
        for name, content in reports:
            fp = REPORTS_DIR / f"pianpao_stats_{name}_{days_tag}_{ts}.md"
            fp.write_text(content, encoding='utf-8')
            print(f"  [OK] {fp}")

        # 控制台打印 by_trap_type (主表)
        print('\n' + '=' * 70)
        print(reports[0][1])
        return 0
    finally:
        con.close()


if __name__ == '__main__':
    sys.exit(main())