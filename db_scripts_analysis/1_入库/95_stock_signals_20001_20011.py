#!/usr/bin/env python3
"""股票信号数据(SIGNALS 20001-20011) — 每日盘后

数据来源: 文本 T0002/signals/signals_sys_*.dat (|分隔)
读取方式: 4_工具/tdx_reader.py TdxReader.read_signals()
长表结构: 每天每股票每信号一行, code/signal_code/signal_name/value
SIGNALS 20001-20011 见 tdx_reader.SIGNAL_MAPPING
"""
# @meta table=stock_signals_20001_20011 cn=股票信号数据 dir=1_入库 sort=095
# @meta schedule=daily mode=increment source=文本(T0002)

import duckdb, pandas as pd
FIELD_MAP = {'signal_code': '信号代码', 'signal_name': '信号名称', 'value': '信号值'}

import sys
from pathlib import Path
from loguru import logger
from datetime import datetime

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_signals_20001_20011'
MODE = 'increment'
SCHEDULE = 'daily'


def fetch_data():
    """读 signals 文本文件，提取 SIGNALS 20001-20011 全量信号数据"""
    from tdx_reader import TdxReader
    df = TdxReader().read_signals()
    if df.empty:
        logger.warning(f"{TABLE}: read_signals 返回空")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code VARCHAR,
        date DATE,
        value DOUBLE,
        signal_code VARCHAR,
        signal_name VARCHAR
    )""")


def save_data(con, df):
    if MODE == 'increment' and 'date' in df.columns:
        dates = df['date'].unique().tolist()
        placeholders = ','.join(['?'] * len(dates))
        con.execute(f"DELETE FROM {TABLE} WHERE date IN ({placeholders})", dates)
    elif MODE == 'full':
        con.execute(f"DELETE FROM {TABLE}")
    con.execute(f"INSERT INTO {TABLE} SELECT * FROM df")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        if not force and MODE == 'increment':
            try:
                latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
                if latest and latest >= datetime.now().date():
                    logger.info(f"○ {TABLE} 已是最新({latest})，跳过")
                    return True
            except: pass
        ensure_table(con)
        df = fetch_data()
        if df.empty:
            logger.warning(f"○ {TABLE} 数据为空，跳过")
            return True
        save_data(con, df)
        logger.info(f"✔ {TABLE} 入库完成，共 {len(df)} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
