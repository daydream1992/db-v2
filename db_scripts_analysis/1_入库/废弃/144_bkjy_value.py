#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块交易数据（指定日期） — 近30日

数据源: TQ API (get_bkjy_value_by_date)
---
# @meta table=bkjy_value cn=板块交易数据 dir=1_入库 sort=144
# @meta schedule=daily mode=increment source=API(TQ:get_bkjy_value_by_date)
"""

import os
import duckdb
import pandas as pd
from loguru import logger
from datetime import datetime, timedelta

try:
    from tqcenter import tq
    tq.initialize(__file__)
except Exception as _e:
    logger.warning(f"TQ 初始化失败: {_e}")
    tq = None

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'bkjy_value'
MODE = 'increment'
SCHEDULE = 'daily'
DAYS_BACK = 10


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        sectors = tq.get_sector_list(list_type=0)
    except Exception as e:
        logger.error(f"{TABLE}: {e}")
        return pd.DataFrame()
    if not sectors:
        return pd.DataFrame()

    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for s in sectors[:50]:
        code = s.get('Code', '')
        name = s.get('Name', '')
        for back in range(DAYS_BACK):
            d = (datetime.now() - timedelta(days=back)).strftime('%Y-%m-%d')
            try:
                info = tq.get_bkjy_value_by_date(sector_code=code, trading_date=d)
                if not info:
                    continue
                rows.append({
                    'sector_code': code,
                    'sector_name': name,
                    'trade_date': d,
                    'close': float(info.get('Close', 0) or 0),
                    'zdf': float(info.get('ZDF', 0) or 0),
                    'volume': float(info.get('Volume', 0) or 0),
                    'amount': float(info.get('Amount', 0) or 0),
                    'zjlx': float(info.get('ZJLX', 0) or 0),
                    'updated_at': now,
                })
            except Exception:
                continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        sector_code VARCHAR,
        sector_name VARCHAR,
        trade_date  VARCHAR,
        close       DOUBLE,
        zdf         DOUBLE,
        volume      DOUBLE,
        amount      DOUBLE,
        zjlx        DOUBLE,
        updated_at  TIMESTAMP
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
