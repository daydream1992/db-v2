#!/usr/bin/env python3
"""日换手率+涨跌幅(近1年) — 每日盘后

派生自 stock_daily_kline ASOF LEFT JOIN capital_info(流通股本, LOCF)
  换手率 turnover = volume / ltgb * 100      (volume/ltgb 均为股)
  涨跌幅 pct_chg  = (close - prev_close) / prev_close * 100  (LAG 取前一交易日close)
范围: 近1年; 仅个股(JOIN dim_security_type 过滤 ETF/板块/指数/可转债/基金等)
流通股本是缓变数据(一年才变一两次), 用 ASOF JOIN 取 date<=当天的最近一条 ltgb(LOCF),
即使 capital_info 当天偶发缺失也能用最近已知股本兜底; 仍无历史股本的新股 turnover 为 NULL
---
# @meta table=stock_daily_turnover cn=日换手率涨跌幅 dir=2_计算 sort=019
# @meta schedule=daily mode=increment source=SQL派生(stock_daily_kline+capital_info ASOF/LOCF)
"""
import duckdb
from loguru import logger
from datetime import datetime, timedelta

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_daily_turnover'
MODE = 'increment'
SCHEDULE = 'daily'
YEARS_BACK = 1
LAG_DAYS = 7        # src 多取 N 天, 保证 store 起始日的 prev_close 可得
FRESH_DAYS = 3      # max(date) 在最近 N 天内视为已最新, 跳过

# 字段中文含义(gen_data_dict 自动采集)
FIELD_MAP = {
    'code':     '股票代码(带后缀)',
    'date':     '日期',
    'turnover': '换手率%(成交量/流通股本*100)',
    'pct_chg':  '涨跌幅%((close-前日close)/前日close*100)',
}
COLUMNS = list(FIELD_MAP.keys())


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code     VARCHAR,
        date     DATE,
        turnover DOUBLE,
        pct_chg  DOUBLE
    )""")


def _compute_range(con):
    """返回 (src_start, store_start)。

    首次/过期: store_start = 1 年前; 增量: store_start = 库内 max(date)(重灌当天+新)。
    src_start 始终 = store_start - LAG_DAYS, 供 LAG 取到前一交易日 close。
    """
    today = datetime.now().date()
    year_ago = today - timedelta(days=365 * YEARS_BACK)
    try:
        latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
    except Exception:
        latest = None
    if latest and latest > year_ago:
        store_start = latest
    else:
        store_start = year_ago
    src_start = store_start - timedelta(days=LAG_DAYS)
    return src_start, store_start


def save_data(con):
    """纯 SQL: stock_daily_kline LAG + ASOF JOIN capital_info(LOCF 流通股本) -> INSERT"""
    src_start, store_start = _compute_range(con)

    # 增量去重: 重灌 store_start 及之后的区间(幂等)
    try:
        latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
    except Exception:
        latest = None
    if latest:
        con.execute(f"DELETE FROM {TABLE} WHERE date >= ?", [store_start])

    logger.info(f"{TABLE}: src>={src_start}, store>={store_start}, latest={latest}")

    con.execute(f"""
        WITH src AS (
            SELECT code, date, close, volume,
                   LAG(close) OVER (PARTITION BY code ORDER BY date) AS prev_close
            FROM stock_daily_kline
            WHERE date >= ?
        )
        INSERT INTO {TABLE} (code, date, turnover, pct_chg)
        SELECT
            s.code, s.date,
            CASE WHEN c.ltgb IS NOT NULL AND c.ltgb > 0
                 THEN round(s.volume / c.ltgb * 100, 4) END AS turnover,
            CASE WHEN s.prev_close IS NOT NULL AND s.prev_close > 0
                 THEN round((s.close - s.prev_close) / s.prev_close * 100, 4) END AS pct_chg
        FROM src s
        ASOF LEFT JOIN capital_info c
            ON s.code = c.code
           AND s.date >= c.date
        JOIN dim_security_type t ON s.code = t.code
        WHERE s.date >= ?
          AND t.type IN ('科创板','沪市主板','深市主板','创业板','北交所')
    """, [src_start, store_start])

    n_new = con.execute(f"SELECT COUNT(*) FROM {TABLE} WHERE date >= ?", [store_start]).fetchone()[0]
    total = con.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
    logger.info(f"{TABLE}: 本次入库 {n_new:,} 行 (date>={store_start}), 表总计 {total:,} 行")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        if force:
            con.execute(f"DELETE FROM {TABLE}")
        ensure_table(con)
        # 新鲜度检测：比较目标表与数据源的 MAX(date)
        if not force:
            try:
                tgt_latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
                src_latest = con.execute("SELECT MAX(date) FROM stock_daily_kline").fetchone()[0]
                if tgt_latest and src_latest and tgt_latest >= src_latest:
                    logger.info(f"○ {TABLE} 已同步到数据源最新日期 {src_latest}, 跳过; force=True 可强制")
                    return True
            except Exception:
                pass
        save_data(con)
        logger.info(f"✔ {TABLE} 完成")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
