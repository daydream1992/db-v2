"""
连板基因表 / 板块情绪宽表 批量构建

包含：
  - dwd_stock_limit_up_feature: 连板天数/首板日期
  - dws_sector_emotion: 板块情绪宽表

使用方式：
    python -m db.derived_tables --limit-up
    python -m db.derived_tables --sector-emotion
    python -m db.derived_tables --all
"""

import logging
import argparse
import duckdb
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "profit_radar.duckdb"


def build_limit_up_feature(con):
    """构建 dwd_stock_limit_up_feature"""
    con.execute("""
    CREATE TABLE IF NOT EXISTS dwd_stock_limit_up_feature (
        code VARCHAR,
        trade_date DATE,
        is_limit_up BOOLEAN,
        con_board_days INTEGER,
        first_board_date DATE,
        limit_up_type VARCHAR,
        seal_ratio DOUBLE,
        PRIMARY KEY (code, trade_date)
    )""")
    con.execute("TRUNCATE dwd_stock_limit_up_feature")
    logger.info("开始计算连板基因 ...")

    con.execute("""
    INSERT INTO dwd_stock_limit_up_feature (code, trade_date, is_limit_up, con_board_days, first_board_date)
    WITH st_stocks AS (
        -- ST股检测（is_st列全False不可靠，改用名称模式）
        SELECT code FROM stock_basic_info WHERE name LIKE '%ST%'
    ),
    with_prev AS (
        SELECT k.code, k.date, k.close, k.change_pct,
               LAG(k.close) OVER (PARTITION BY k.code ORDER BY k.date) AS prev_close,
               CASE WHEN s.code IS NOT NULL THEN 1 ELSE 0 END AS is_st
        FROM stock_daily_kline k
        LEFT JOIN st_stocks s ON k.code = s.code
    ),
    limit_up_flag AS (
        SELECT code, date, close, change_pct,
               CASE
                   -- 板块优先（含该板块ST）：创业板/科创板20%，北交所30%
                   WHEN code LIKE '688%' AND close >= ROUND(prev_close * 1.20, 2) THEN TRUE
                   WHEN code LIKE '688%' THEN FALSE
                   WHEN (code LIKE '300%' OR code LIKE '301%') AND close >= ROUND(prev_close * 1.20, 2) THEN TRUE
                   WHEN (code LIKE '300%' OR code LIKE '301%') THEN FALSE
                   WHEN code LIKE '%.BJ' AND close >= ROUND(prev_close * 1.30, 2) THEN TRUE
                   WHEN code LIKE '%.BJ' THEN FALSE
                   -- 主板ST 5%（2026-07-06前）
                   WHEN is_st AND close >= ROUND(prev_close * 1.05, 2) THEN TRUE
                   -- 主板10%
                   WHEN close >= ROUND(prev_close * 1.10, 2) THEN TRUE
                   ELSE FALSE
               END AS is_limit_up
        FROM with_prev
        WHERE prev_close IS NOT NULL
    ),
    with_break AS (
        SELECT code, date, is_limit_up,
               CASE
                   WHEN NOT is_limit_up THEN 0
                   WHEN LAG(is_limit_up) OVER (PARTITION BY code ORDER BY date) = TRUE THEN 0
                   ELSE 1
               END AS is_new_streak
        FROM limit_up_flag
    ),
    streak_groups AS (
        SELECT code, date, is_limit_up,
               SUM(is_new_streak) OVER (PARTITION BY code ORDER BY date) AS streak_id
        FROM with_break
    ),
    streak_agg AS (
        SELECT code, date, is_limit_up, streak_id,
               CASE WHEN is_limit_up
                    THEN ROW_NUMBER() OVER (PARTITION BY code, streak_id ORDER BY date)
                    ELSE 0
               END AS con_board_days,
               CASE WHEN is_limit_up
                    THEN FIRST_VALUE(date) OVER (PARTITION BY code, streak_id ORDER BY date)
                    ELSE NULL
               END AS first_board_date
        FROM streak_groups
    )
    SELECT code, date, TRUE, con_board_days, first_board_date
    FROM streak_agg
    WHERE is_limit_up = TRUE
    """)

    cnt = con.execute("SELECT COUNT(*) FROM dwd_stock_limit_up_feature").fetchone()[0]
    max_con = con.execute("SELECT MAX(con_board_days) FROM dwd_stock_limit_up_feature").fetchone()[0]
    logger.info(f"连板基因完成: {cnt} 条, 最大连板={max_con}")


def build_sector_emotion(con):
    """构建 dws_sector_emotion"""
    con.execute("""
    CREATE TABLE IF NOT EXISTS dws_sector_emotion (
        sector_code VARCHAR,
        trade_date DATE,
        limit_up_num INTEGER,
        limit_down_num INTEGER,
        up_ratio DOUBLE,
        total_mv DOUBLE,
        flow_mv DOUBLE,
        pe_ttm DOUBLE,
        pb_mrq DOUBLE,
        sector_amount DOUBLE,
        sector_turnover DOUBLE,
        PRIMARY KEY (sector_code, trade_date)
    )""")
    con.execute("TRUNCATE dws_sector_emotion")
    logger.info("开始计算板块情绪 ...")

    # 从 sector_daily_data + sector_trading_data 聚合
    con.execute("""
    INSERT INTO dws_sector_emotion
    SELECT
        sd.sector_code,
        sd.date AS trade_date,
        sd.limit_up AS limit_up_num,
        sd.limit_down AS limit_down_num,
        CASE WHEN sd.total_stocks > 0
             THEN sd.advance * 1.0 / sd.total_stocks
             ELSE NULL
        END AS up_ratio,
        sd.total_market_cap AS total_mv,
        sd.pe_ttm,
        sd.pb_mrq,
        sd.amount AS sector_amount,
        sd.turnover AS sector_turnover,
        -- 从 sector_trading_data 取流通市值 (BK11)
        (SELECT st.value_0 FROM sector_trading_data st
         WHERE st.sector_code = sd.sector_code AND st.date = sd.date
           AND st.field_name = 'BK11'
         LIMIT 1) AS flow_mv
    FROM sector_daily_data sd
    """)

    cnt = con.execute("SELECT COUNT(*) FROM dws_sector_emotion").fetchone()[0]
    logger.info(f"板块情绪完成: {cnt} 条")


def main():
    parser = argparse.ArgumentParser(description="衍生宽表构建")
    parser.add_argument("--limit-up", action="store_true", help="构建连板基因表")
    parser.add_argument("--sector-emotion", action="store_true", help="构建板块情绪表")
    parser.add_argument("--all", action="store_true", help="构建全部")
    args = parser.parse_args()

    con = duckdb.connect(str(DB_PATH))

    if args.all or args.limit_up:
        build_limit_up_feature(con)
    if args.all or args.sector_emotion:
        build_sector_emotion(con)

    if not (args.limit_up or args.sector_emotion or args.all):
        logger.info("请指定 --limit-up / --sector-emotion / --all")

    con.close()


if __name__ == "__main__":
    main()
