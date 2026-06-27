#!/usr/bin/env python3
"""板块成份股 — 每日盘后"""
# @meta table=sector_stocks cn=板块成份股 dir=1_入库 sort=033
# @meta schedule=daily mode=full source=二进制

import duckdb, pandas as pd
from loguru import logger
from datetime import datetime

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'sector_stocks'
MODE = 'full'
SCHEDULE = 'daily'

def fetch_data():
    """调API/读文件获取数据"""
    logger.warning(f"{TABLE}: fetch_data() 尚未实现")
    return pd.DataFrame()

def ensure_table(con):
    con.execute("""CREATE TABLE IF NOT EXISTS 表名 (
        sector_code VARCHAR,
        stock_code VARCHAR
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
