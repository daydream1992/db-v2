#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""自定义板块列表 — 每日盘后

数据源: TQ API (get_user_sector)
用途: 读取通达信客户端中的自定义板块列表。
---
# @meta table=user_sector cn=自定义板块列表 dir=1_入库 sort=132
# @meta schedule=daily mode=full source=API(TQ:get_user_sector)
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
TABLE = 'user_sector'
MODE = 'full'
SCHEDULE = 'daily'


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        result = tq.get_user_sector()
    except Exception as e:
        logger.error(f"{TABLE}: 获取自定义板块失败: {e}")
        return pd.DataFrame()

    if not result:
        logger.warning(f"{TABLE}: 返回空")
        return pd.DataFrame()

    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for item in result:
        rows.append({
            'code': item.get('Code', ''),
            'name': item.get('Name', ''),
            'updated_at': now,
        })
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code       VARCHAR,
        name       VARCHAR,
        updated_at TIMESTAMP
    )""")


def save_data(con, df):
    if MODE == 'full':
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
        logger.info(f"✔ {TABLE} {len(df)} 条 -> {csv_path}")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE}: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
