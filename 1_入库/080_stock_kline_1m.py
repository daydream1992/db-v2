#!/usr/bin/env python3
"""股票分钟K线1m — 每日盘后

数据源：通达信本地 .lc1 文件
优化：逐文件处理 + COPY 批量入库
"""
# @meta table=stock_kline_1m cn=股票分钟K线1m dir=1_入库 sort=080
# @meta schedule=daily mode=increment source=二进制

# 字段中文映射
FIELD_MAP = {
    'trade_time': '交易时间',
}

import sys
from pathlib import Path
import duckdb, pandas as pd
from loguru import logger
import tempfile
import os

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / '4_工具'))
from tdx_reader import TdxReader, _parse_single_lc_file

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_kline_1m'
MODE = 'increment'
SCHEDULE = 'daily'


def fetch_data(min_date=None):
    """读 .lc1 文件，逐文件返回（支持日期过滤）"""
    reader = TdxReader()
    files = reader._collect_files('lc1', market=None)
    for f in files:
        df = _parse_single_lc_file(f, min_date=min_date)
        if len(df) > 0:
            df['volume'] = df['volume'].astype('int64')
            df = df[['code', 'open', 'high', 'low', 'close', 'volume', 'amount', 'trade_time']]
            yield f, df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code        VARCHAR,
        trade_time  TIMESTAMP,
        open        DOUBLE,
        high        DOUBLE,
        low         DOUBLE,
        close       DOUBLE,
        volume      BIGINT,
        amount      DOUBLE
    )""")


def save_data(con, df):
    """用 COPY 导入"""
    if df.empty:
        return
    with tempfile.NamedTemporaryFile(suffix='.parquet', delete=False) as tmp:
        parquet_path = tmp.name
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
        # 获取最新日期用于过滤
        min_date = None
        if not force and MODE == 'increment':
            try:
                latest = con.execute(f"SELECT MAX(trade_time) FROM {TABLE}").fetchone()[0]
                if latest:
                    min_date = (latest + pd.Timedelta(days=1)).strftime('%Y%m%d')
                    logger.info(f"  增量模式，最小日期: {min_date}")
                else:
                    logger.info(f"  全量模式（首次入库）")
            except:
                pass

        ensure_table(con)

        total = 0
        file_count = 0
        for file_path, df in fetch_data(min_date=min_date):
            if df.empty:
                continue
            save_data(con, df)
            total += len(df)
            file_count += 1
            if file_count % 100 == 0:
                logger.info(f"  已处理 {file_count} 文件, {total:,} 条")

        if total == 0:
            logger.info(f"○ {TABLE} 无新数据")
            return True
        logger.info(f"✔ {TABLE} 完成，共 {total:,} 条 ({file_count} 文件)")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
