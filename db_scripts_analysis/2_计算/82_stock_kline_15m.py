#!/usr/bin/env python3
"""股票15分钟K线 — 从5分钟K线聚合（纯SQL流式，按日循环）

数据源：stock_kline_5m（约2亿行）
聚合方式：纯 DuckDB SQL（first/last/max/min/sum），不拉 pandas，避免 OOM
增量模式：只聚合目标表最新日期之后的交易日，逐日 DELETE+INSERT 幂等
"""
# ---
# @meta table=stock_kline_15m cn=股票15分钟K线 dir=2_计算 sort=082
# @meta schedule=daily mode=increment source=SQL聚合

import duckdb
from loguru import logger

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_kline_15m'
SOURCE_TABLE = 'stock_kline_5m'
MODE = 'increment'
SCHEDULE = 'daily'
BATCH_SIZE = 3  # 每3条5分钟=15分钟
MEMORY_LIMIT = '4GB'  # DuckDB 内存上限，防止聚合 OOM


def fetch_data(con, force=False):
    """从 SOURCE_TABLE 聚合 K线（纯SQL流式聚合 + 按日循环，避免OOM）"""
    # 1. 目标表最新日期（增量起点）
    if force:
        min_date = None
        logger.info("  force=True，全量重聚合")
    else:
        try:
            latest = con.execute(f"SELECT MAX(DATE(trade_time)) FROM {TABLE}").fetchone()[0]
            min_date = str(latest) if latest else None
            logger.info(f"  增量起点: {min_date or '无(全量)'}")
        except Exception:
            min_date = None

    # 2. 源表缺失的交易日（timestamp范围过滤命中zone-map，避免 DATE() 全表扫1.98亿行）
    cond = (f"trade_time > TIMESTAMP '{min_date} 23:59:59'"
            if min_date else "trade_time >= DATE '2024-01-01'")
    days = [d[0] for d in con.execute(f"""
        SELECT DISTINCT DATE(trade_time) AS d
        FROM {SOURCE_TABLE}
        WHERE {cond}
        ORDER BY d
    """).fetchall()]

    if not days:
        logger.info("  无新数据")
        return

    logger.info(f"  需聚合 {len(days)} 个交易日（{BATCH_SIZE}条5分钟=目标周期）")

    total = 0
    for i, day in enumerate(days):
        day_str = str(day)
        rng = (f"trade_time >= TIMESTAMP '{day_str} 00:00:00' "
               f"AND trade_time < TIMESTAMP '{day_str} 00:00:00' + INTERVAL 1 DAY")

        # 删除目标表该日旧数据（幂等，可重复运行）
        con.execute(f"DELETE FROM {TABLE} WHERE {rng}")

        # 纯SQL聚合：ROW_NUMBER按code分区内行序//BATCH_SIZE分桶，组内按trade_time取first/last
        con.execute(f"""
            INSERT INTO {TABLE} (code, trade_time, open, high, low, close, volume, amount)
            SELECT code,
                   first(trade_time ORDER BY trade_time),
                   first(open ORDER BY trade_time),
                   max(high), min(low),
                   last(close ORDER BY trade_time),
                   sum(volume), sum(amount)
            FROM (
              SELECT code, trade_time, open, high, low, close, volume, amount,
                     (ROW_NUMBER() OVER (PARTITION BY code ORDER BY trade_time) - 1) // {BATCH_SIZE} AS bucket
              FROM {SOURCE_TABLE}
              WHERE {rng}
            ) t
            GROUP BY code, bucket
        """)

        inserted = con.execute(f"SELECT COUNT(*) FROM {TABLE} WHERE {rng}").fetchone()[0]
        total += inserted
        logger.info(f"  [{i+1}/{len(days)}] {day_str} +{inserted:,} 条")

    logger.info(f"  共聚合 {total:,} 条")


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code VARCHAR,
        trade_time TIMESTAMP,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume BIGINT,
        amount DOUBLE
    )""")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        con.execute(f"PRAGMA memory_limit='{MEMORY_LIMIT}'")
        ensure_table(con)
        fetch_data(con, force)
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
