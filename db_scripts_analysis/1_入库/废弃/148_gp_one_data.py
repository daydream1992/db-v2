#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""个股单条财务 — 每日盘后

数据源: TQ API (get_gp_one_data)
---
# @meta table=gp_one_data cn=个股单条财务 dir=1_入库 sort=148
# @meta schedule=daily mode=increment source=API(TQ:get_gp_one_data)
"""

import os
import duckdb
import pandas as pd
from loguru import logger
from datetime import datetime

try:
    from tqcenter import tq
    tq.initialize(__file__)
except Exception as _e:
    logger.warning(f"TQ 初始化失败: {_e}")
    tq = None

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'gp_one_data'
MODE = 'increment'
SCHEDULE = 'daily'

INDICATORS = ['J_zgb', 'J_mgsy', 'J_mgjzc', 'J_jly']


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        codes = tq.get_stock_list(market='5', list_type=0)
    except Exception as e:
        logger.error(f"{TABLE}: {e}")
        return pd.DataFrame()
    if not codes:
        return pd.DataFrame()

    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for code in codes[:50]:
        for indicator in INDICATORS:
            try:
                value = tq.get_gp_one_data(stock_code=code, indicator=indicator)
                rows.append({
                    'code': code,
                    'indicator': indicator,
                    'value': float(value) if value not in ('', None) else 0.0,
                    'updated_at': now,
                })
            except Exception:
                continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code       VARCHAR,
        indicator  VARCHAR,
        value      DOUBLE,
        updated_at TIMESTAMP
    )""")


def save_data(con, df):
    con.execute(f"INSERT INTO {TABLE} SELECT * FROM df")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        df = fetch_data()
        if df.empty:
            return True
        save_data(con, df)
        csv_dir = r'K:\DB数据库_v2\output'
        os.makedirs(csv_dir, exist_ok=True)
        csv_path = os.path.join(csv_dir, f"{TABLE}_{datetime.now().strftime('%Y%m%d')}.csv")
        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        logger.info(f"✔ {TABLE} {len(df)} -> {csv_path}")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE}: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
