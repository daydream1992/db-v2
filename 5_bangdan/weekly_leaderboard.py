#!/usr/bin/env python3
# @meta table=weekly_leaderboard cn=近周榜单测试 dir=reports sort=010
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""
近一周榜单测试 - 纯查询输出 markdown 报告
- 榜1: 行业板块跌幅榜
- 榜2: 个股资金净流入榜
- 榜3: 涨停梯队榜（行业+概念双维度）

不动表、不写新数据，仅做诊断分析。
"""
import duckdb
from datetime import datetime, timedelta

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'

def get_recent_trading_days(con, n=5):
    """最近 n 个交易日（避开未来日期）"""
    return con.execute(f'''
        SELECT date FROM trading_calendar
        WHERE is_trading = TRUE AND date <= CURRENT_DATE
        ORDER BY date DESC LIMIT {n}
    ''').fetchall()


def leaderboard_industry_drop(con, days=5):
    """榜1: 行业板块跌幅榜（近 N 日复利累计涨跌幅）"""
    days_list = get_recent_trading_days(con, days)
    if not days_list:
        return []
    end_date = max(d[0] for d in days_list)
    start_date = min(d[0] for d in days_list)

    df = con.execute(f'''
        WITH k AS (
            SELECT k.code, k.date, k.close,
                FIRST_VALUE(k.close) OVER (PARTITION BY k.code ORDER BY k.date) AS first_close,
                LAST_VALUE(k.close) OVER (PARTITION BY k.code ORDER BY k.date
                    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS last_close
            FROM stock_daily_kline k
            WHERE k.date BETWEEN '{start_date}' AND '{end_date}'
        )
        SELECT
            i."行业二级名称" AS ind_name,
            i."行业一级名称" AS ind_l1,
            COUNT(DISTINCT k.code) AS n_stocks,
            ROUND(AVG((k.last_close - k.first_close) / NULLIF(k.first_close, 0) * 100), 2) AS cum_pct,
            ROUND(MIN((k.last_close - k.first_close) / NULLIF(k.first_close, 0) * 100), 2) AS min_pct,
            ROUND(MAX((k.last_close - k.first_close) / NULLIF(k.first_close, 0) * 100), 2) AS max_pct
        FROM k
        JOIN stock_industry_3level i ON k.code = i.stock_code
        GROUP BY i."行业二级名称", i."行业一级名称"
        HAVING COUNT(DISTINCT k.code) >= 5
        ORDER BY cum_pct ASC
        LIMIT 15
    ''').fetchdf()
    return df, (start_date, end_date)


def leaderboard_capital_flow(con, days=5):
    """榜2: 个股资金净流入榜（近 N 日累计主力净流入）"""
    # 时间窗自适应：若主表在 days 内无数据，回退到该表最近 N 个交易日
    days_list = get_recent_trading_days(con, days)
    end_date = max(d[0] for d in days_list) if days_list else None
    start_date = min(d[0] for d in days_list) if days_list else None

    # 检查该表在主区间内的覆盖
    if end_date and start_date:
        cover = con.execute(f'''
            SELECT COUNT(*) FROM dwd_stock_capital_flow
            WHERE trade_date BETWEEN '{start_date}' AND '{end_date}'
        ''').fetchone()[0]
        if cover == 0:
            # 回退到 dwd_stock_capital_flow 自己最近的 N 个交易日
            recent = con.execute(f'''
                SELECT DISTINCT trade_date FROM dwd_stock_capital_flow
                ORDER BY trade_date DESC LIMIT {days}
            ''').fetchall()
            if recent:
                end_date = max(d[0] for d in recent)
                start_date = min(d[0] for d in recent)

    if not end_date or not start_date:
        return None, (None, None)

    df = con.execute(f'''
        SELECT
            f.code,
            i."行业二级名称" AS ind_name,
            ROUND(SUM(f."主力净流入"), 2) AS net_inflow_wan,
            ROUND(AVG(f."主力净流入"), 2) AS avg_daily_inflow,
            SUM(CASE WHEN f."是否涨停" THEN 1 ELSE 0 END) AS zt_count,
            COUNT(*) AS days_covered
        FROM dwd_stock_capital_flow f
        LEFT JOIN stock_industry_3level i ON f.code = i.stock_code
        WHERE f.trade_date BETWEEN '{start_date}' AND '{end_date}'
        GROUP BY f.code, i."行业二级名称"
        HAVING COUNT(*) >= 3
        ORDER BY net_inflow_wan DESC
        LIMIT 20
    ''').fetchdf()
    return df, (start_date, end_date)


def leaderboard_zt_ladder(con, days=5, min_lianban=2):
    """榜3: 涨停梯队榜（pianpao_daily 触板 + 连板维度）"""
    days_list = get_recent_trading_days(con, days)
    if not days_list:
        return []
    end_date = max(d[0] for d in days_list)
    start_date = min(d[0] for d in days_list)

    # 3a. 个股连板梯队
    df_lianban = con.execute(f'''
        WITH zt AS (
            SELECT stock_code, MAX(consecutive_zt) AS max_lb, COUNT(*) AS zt_days,
                LIST(DISTINCT scenario) AS scenarios, LIST(DISTINCT sectors) AS sectors_str
            FROM pianpao_daily
            WHERE trade_date BETWEEN '{start_date}' AND '{end_date}'
              AND touched_zt = TRUE
            GROUP BY stock_code
        )
        SELECT z.stock_code, z.max_lb, z.zt_days, z.scenarios, z.sectors_str,
            i."行业二级名称" AS ind_name, i."行业一级名称" AS ind_l1
        FROM zt z
        LEFT JOIN stock_industry_3level i ON z.stock_code = i.stock_code
        WHERE z.max_lb >= {min_lianban}
        ORDER BY z.max_lb DESC, z.zt_days DESC
        LIMIT 30
    ''').fetchdf()

    # 3b. 行业聚合
    df_ind = con.execute(f'''
        WITH zt AS (
            SELECT DISTINCT stock_code FROM pianpao_daily
            WHERE trade_date BETWEEN '{start_date}' AND '{end_date}'
              AND touched_zt = TRUE
        )
        SELECT i."行业二级名称" AS ind_name, COUNT(DISTINCT z.stock_code) AS zt_stocks
        FROM zt z
        JOIN stock_industry_3level i ON z.stock_code = i.stock_code
        GROUP BY i."行业二级名称"
        ORDER BY zt_stocks DESC
        LIMIT 15
    ''').fetchdf()

    # 3c. 概念板块聚合
    df_concept = con.execute(f'''
        WITH zt AS (
            SELECT DISTINCT stock_code FROM pianpao_daily
            WHERE trade_date BETWEEN '{start_date}' AND '{end_date}'
              AND touched_zt = TRUE
        )
        SELECT b."板块名称" AS concept, b."板块代码" AS concept_code,
            COUNT(DISTINCT z.stock_code) AS zt_stocks
        FROM zt z
        JOIN stock_block_relation b ON z.stock_code = b.stock_code
        WHERE b."板块类型" = '概念'
        GROUP BY b."板块名称", b."板块代码"
        ORDER BY zt_stocks DESC
        LIMIT 20
    ''').fetchdf()

    return (df_lianban, df_ind, df_concept), (start_date, end_date)


def render_md(industry_df, capital_df, zt_tuple, periods):
    """渲染 markdown 报告"""
    ind_period, cap_period, zt_period = periods
    df_lianban, df_ind, df_concept = zt_tuple

    md = []
    md.append(f"# 近一周榜单测试报告")
    md.append(f"\n生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    md.append(f"\n数据源：profit_radar.duckdb（read_only）")
    md.append(f"\n---\n")

    # 榜1
    md.append(f"\n## 榜1：行业板块跌幅榜（{ind_period[0]} ~ {ind_period[1]}）")
    md.append(f"\n数据源：`stock_daily_kline` + `stock_industry_3level`，按行业二级聚合 5 日复利累计涨跌幅（first→last close）")
    md.append(f"\n**统计规则**：成分股 ≥ 5；按累计涨跌幅升序；单位 %\n")
    md.append(industry_df.to_markdown(index=False))

    # 榜2
    cap_start, cap_end = cap_period
    if capital_df is None or len(capital_df) == 0:
        md.append(f"\n\n## 榜2：个股资金净流入榜（{cap_start} ~ {cap_end}）")
        md.append(f"\n**无可用数据**：`dwd_stock_capital_flow` 在该区间为空，请先补数（脚本：`120_dwd_stock_capital_flow.py`）")
    else:
        md.append(f"\n\n## 榜2：个股资金净流入榜（{cap_start} ~ {cap_end}）")
        md.append(f"\n数据源：`dwd_stock_capital_flow.主力净流入` + `stock_industry_3level`")
        md.append(f"\n**注意**：`dwd_stock_capital_flow` 最新日期若停更，时间窗自动适配\n")
        md.append(capital_df.to_markdown(index=False))

    # 榜3
    md.append(f"\n\n## 榜3：涨停梯队榜（{zt_period[0]} ~ {zt_period[1]}）")
    md.append(f"\n数据源：`pianpao_daily.touched_zt / consecutive_zt / scenario / sectors`\n")
    md.append(f"\n### 3a. 个股连板梯队（连板 ≥ 2）")
    md.append(df_lianban.to_markdown(index=False))
    md.append(f"\n\n### 3b. 行业聚合（涨停个股数）")
    md.append(df_ind.to_markdown(index=False))
    md.append(f"\n\n### 3c. 概念板块聚合（涨停个股数）")
    md.append(df_concept.to_markdown(index=False))

    md.append(f"\n\n---\n*本报告为测试版本，仅做查询输出，不动表不改字典*\n")
    return '\n'.join(md)


def main():
    print("连接数据库（read_only）...")
    con = duckdb.connect(DB_PATH, read_only=True)

    print("[1/3] 行业板块跌幅榜...")
    industry_df, ind_period = leaderboard_industry_drop(con, days=5)
    print(f"  → {len(industry_df)} 行，区间 {ind_period[0]} ~ {ind_period[1]}")

    print("[2/3] 个股资金净流入榜...")
    capital_df, cap_period = leaderboard_capital_flow(con, days=5)
    print(f"  → {len(capital_df)} 行，区间 {cap_period[0]} ~ {cap_period[1]}")

    print("[3/3] 涨停梯队榜...")
    zt_tuple, zt_period = leaderboard_zt_ladder(con, days=5, min_lianban=2)
    print(f"  → 个股 {len(zt_tuple[0])}，行业 {len(zt_tuple[1])}，概念 {len(zt_tuple[2])} 行")

    print("\n渲染 markdown...")
    md = render_md(industry_df, capital_df, zt_tuple, (ind_period, cap_period, zt_period))

    # 输出到 reports/
    from pathlib import Path
    out = Path(r'K:\DB数据库_v2\reports') / f"weekly_leaderboard_{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    out.write_text(md, encoding='utf-8')
    print(f"\n[OK] 已保存：{out}")

    # 同时打印到控制台
    print('\n' + '=' * 70)
    print(md)


if __name__ == '__main__':
    main()