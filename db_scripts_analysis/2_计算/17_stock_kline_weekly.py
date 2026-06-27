#!/usr/bin/env python3
"""股票周K线 — 从 stock_daily_kline 按周聚合（纯SQL流式，full模式全量重建）

数据源：stock_daily_kline（约2900万行）
聚合方式：纯 DuckDB SQL（date_trunc('week') 分组），不拉 pandas，避免 OOM
full模式：每次运行 DELETE 全表 + INSERT 全量聚合结果，秒级完成，永远干净

修复历史：
- 去 pandas.df()（全量拉取会 OOM）→ 纯 SQL INSERT...SELECT 流式
- 聚合 key strftime('%Y-W%W') → date_trunc('week')（修跨年周分组 bug）
- save_data 按 df.date min/max 删除（漏删累积多 date）→ full 模式每次 DELETE 全表
- run(force) 形同虚设 → full 模式无条件全量重建，无增量盲区
"""
# @meta table=stock_kline_weekly cn=股票周K线 dir=2_计算 sort=017
# @meta schedule=weekly mode=full source=SQL聚合

import duckdb
from loguru import logger

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_kline_weekly'
SOURCE_TABLE = 'stock_daily_kline'
MODE = 'full'
SCHEDULE = 'weekly'
PERIOD = 'week'  # date_trunc 周期
MEMORY_LIMIT = '4GB'  # DuckDB 内存上限，聚合可 spill to disk


def fetch_data(con):
    """full 模式全量重聚合：DELETE 全表 + INSERT 纯SQL流式聚合（无 pandas）"""
    logger.info(f"  清空 {TABLE} 后全量聚合 date_trunc('{PERIOD}')")
    con.execute(f"DELETE FROM {TABLE}")
    con.execute(f"""
        INSERT INTO {TABLE} (code, date, open, high, low, close, volume, amount, 涨跌幅)
        SELECT code,
               MIN(date), MIN(open), MAX(high), MIN(low), MAX(close),
               SUM(volume), SUM(amount),
               (MAX(close) - MIN(open)) / NULLIF(MIN(open), 0) * 100
        FROM {SOURCE_TABLE}
        GROUP BY code, date_trunc('{PERIOD}', date)
    """)
    total = con.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
    logger.info(f"  共聚合 {total:,} 条")


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code        VARCHAR,
        date        DATE,
        open        DOUBLE,
        high        DOUBLE,
        low         DOUBLE,
        close       DOUBLE,
        volume      BIGINT,
        amount      DOUBLE,
        涨跌幅      DOUBLE
    )""")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}（full 全量重建）")
    con = duckdb.connect(DB_PATH)
    try:
        con.execute(f"PRAGMA memory_limit='{MEMORY_LIMIT}'")
        ensure_table(con)
        fetch_data(con)
        total = con.execute(f"SELECT COUNT(*) FROM {TABLE}").fetchone()[0]
        logger.info(f"✔ {TABLE} 完成，共 {total:,} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
