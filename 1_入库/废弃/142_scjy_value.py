#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""市场交易数据（日期维度） — 近30日

数据源: TQ API (get_scjy_value_by_date)
---
# @meta table=scjy_value cn=市场交易数据 dir=1_入库 sort=142
# @meta schedule=daily mode=increment source=API(TQ:get_scjy_value_by_date)
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
TABLE = 'scjy_value'
MODE = 'increment'
SCHEDULE = 'daily'
DAYS_BACK = 30

FIELDS = ['TotalMV', 'CirculMV', 'PE', 'PB', 'Turnover', 'Volume', 'Amount', 'RiseCount', 'FallCount', 'FlatCount']


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for back in range(DAYS_BACK):
        d = (datetime.now() - timedelta(days=back)).strftime('%Y-%m-%d')
        try:
            info = tq.get_scjy_value_by_date(trading_date=d)
            if not info:
                continue
            row = {'trade_date': d, 'updated_at': now}
            for k in FIELDS:
                row[k.lower()] = float(info.get(k, 0) or 0)
            rows.append(row)
        except Exception:
            continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    cols = ', '.join([f"{k.lower()} DOUBLE" for k in FIELDS])
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        trade_date VARCHAR,
        {cols},
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
