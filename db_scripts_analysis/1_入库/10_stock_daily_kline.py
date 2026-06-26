#!/usr/bin/env python3
"""股票日K线 — 每日盘后

数据源：通达信本地 .day 文件 (K:\\txdlianghua\\vipdoc\\sh|sz\\lday\\)
读取方式：read_daily_parallel() 并行解析，支持日期过滤
入库方式：COPY + parquet 临时文件
增量模式：只读取数据库最新日期之后的数据
"""
# ---
# @meta table=stock_daily_kline cn=股票日K线 dir=1_入库 sort=010
# @meta schedule=daily mode=increment source=二进制

import sys
from pathlib import Path
import duckdb, pandas as pd
from loguru import logger
import tempfile
import os

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '4_工具'))
from tdx_reader import TdxReader

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_daily_kline'
MODE = 'increment'
SCHEDULE = 'daily'


def fetch_data(con):
    """并行读取 .day 文件（增量模式）"""
    reader = TdxReader()

    # 获取数据库最新日期
    try:
        latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
        if latest:
            min_date = (latest + pd.Timedelta(days=1)).strftime('%Y%m%d')
            logger.info(f"  增量模式，最小日期: {min_date}")
        else:
            min_date = None
            logger.info(f"  全量模式（首次入库）")
    except Exception:
        min_date = None

    return reader.read_daily_parallel(min_date=min_date)


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code VARCHAR,
        date DATE,
        open DOUBLE,
        high DOUBLE,
        low DOUBLE,
        close DOUBLE,
        volume BIGINT,
        amount DOUBLE,
        涨跌幅 DOUBLE,
        换手率 DOUBLE,
        前复权因子 DOUBLE
    )""")


def save_data(con, df):
    """COPY + parquet 批量入库"""
    if df.empty:
        return
    df['date'] = pd.to_datetime(df['date']).dt.date
    df['volume'] = df['volume'].astype('int64')
    df['涨跌幅'] = None
    df['换手率'] = None
    df['前复权因子'] = None

    with tempfile.NamedTemporaryFile(suffix='.parquet', delete=False) as f:
        parquet_path = f.name
    try:
        df.to_parquet(parquet_path, index=False)
        con.execute(f"COPY {TABLE} FROM '{parquet_path}' (FORMAT PARQUET)")
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        df = fetch_data(con)

        if df.empty:
            logger.info(f"○ {TABLE} 无新数据")
            return True

        save_data(con, df)
        logger.info(f"✔ {TABLE} 完成，共 {len(df):,} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()