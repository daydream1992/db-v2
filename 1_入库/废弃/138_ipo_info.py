#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""新股申购信息 — 每日盘后

数据源: TQ API (get_ipo_info)
---
# @meta table=ipo_info cn=新股申购信息 dir=1_入库 sort=138
# @meta schedule=daily mode=full source=API(TQ:get_ipo_info)
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
TABLE = 'ipo_info'
MODE = 'full'
SCHEDULE = 'daily'


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        result = tq.get_ipo_info()
    except Exception as e:
        logger.error(f"{TABLE}: {e}")
        return pd.DataFrame()
    if not result:
        return pd.DataFrame()
    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for item in result:
        rows.append({
            'code': item.get('Code', ''),
            'name': item.get('Name', ''),
            'ipo_date': item.get('IPODate', ''),
            'list_date': item.get('ListDate', ''),
            'issue_price': float(item.get('IssuePrice', 0) or 0),
            'issue_vol': float(item.get('IssueVolume', 0) or 0),
            'apply_code': item.get('ApplyCode', ''),
            'updated_at': now,
        })
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code        VARCHAR,
        name        VARCHAR,
        ipo_date    VARCHAR,
        list_date   VARCHAR,
        issue_price DOUBLE,
        issue_vol   DOUBLE,
        apply_code  VARCHAR,
        updated_at  TIMESTAMP
    )""")


def save_data(con, df):
    con.execute(f"DELETE FROM {TABLE}")
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
