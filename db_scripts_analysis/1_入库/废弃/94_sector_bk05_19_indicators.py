#!/usr/bin/env python3
"""板块BK指标(BK5-BK19) — 每日盘后

数据来源: 二进制 vipdoc/cw/gpsh*.dat (code>=880000, 13字节/条)
读取方式: 4_工具/tdx_reader.py TdxReader.read_bk()
长表结构: 每天每板块每指标一行, code/bk_code/bk_name/value_0/value_1
BK5-19 indicator字节映射见 tdx_reader.BK_MAPPING (BK5-19 = 0x05-0x13)
"""
# @meta table=sector_bk05_19_indicators cn=板块BK指标 dir=1_入库
# @meta schedule=daily mode=increment source=二进制

import duckdb, pandas as pd
import sys
from pathlib import Path
from loguru import logger
from datetime import datetime

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'sector_bk05_19_indicators'
MODE = 'increment'
SCHEDULE = 'daily'


def fetch_data():
    """读 cw 二进制文件，提取 BK5-19 全量板块指标"""
    from tdx_reader import TdxReader
    df = TdxReader().read_bk()
    if df.empty:
        logger.warning(f"{TABLE}: read_bk 返回空")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        date DATE,
        code VARCHAR,
        bk_code VARCHAR,
        bk_name VARCHAR,
        value_0 DOUBLE,
        value_1 DOUBLE
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
