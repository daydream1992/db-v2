#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""证券基本信息 — 每日盘后

数据源: TQ API (get_stock_info)
---
# @meta table=stock_basic_info cn=证券基本信息 dir=1_入库 sort=133
# @meta schedule=daily mode=full source=API(TQ:get_stock_info)
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
TABLE = 'stock_basic_info'
MODE = 'full'
SCHEDULE = 'daily'

# 要拉取的字段（按通达信文档，支持 Name/Unit/VolBase/MinPrice/XsFlag/
# ActiveCapital/J_zgb/J_ldzc/J_zc/J_ysy/J_yly/J_jly 等）
FIELD_LIST = [
    'Name', 'Unit', 'VolBase', 'MinPrice', 'XsFlag',
    'ActiveCapital', 'J_zgb', 'J_ldzc', 'J_zc', 'J_ldfz',
    'J_zbgjj', 'J_jzc', 'J_ysy', 'J_yly', 'J_jly', 'J_wfply',
    'J_start', 'blockzscode', 'BelongHS300', 'BelongRZRQ', 'BelongHSGT',
    'IsHKGP', 'IsQH', 'HSStockKind',
]


def _safe_str(v):
    if v is None:
        return ''
    return str(v)


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        stocks = tq.get_stock_list(market='5', list_type=0)
    except Exception as e:
        logger.error(f"{TABLE}: 取A股列表失败: {e}")
        return pd.DataFrame()
    if not stocks:
        return pd.DataFrame()

    # 限制范围（避免全量一次性请求过大）
    sample = stocks[:500]
    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for code in sample:
        try:
            info = tq.get_stock_info(stock_code=code, field_list=FIELD_LIST)
            if not info:
                continue
            row = {'code': code, 'updated_at': now}
            for f in FIELD_LIST:
                row[f.lower()] = _safe_str(info.get(f, ''))
            rows.append(row)
        except Exception as e:
            logger.warning(f"{TABLE}: {code} 失败: {e}")
            continue

    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    cols = ', '.join([f"{f.lower()} VARCHAR" for f in FIELD_LIST])
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code VARCHAR,
        {cols},
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
        logger.info(f"✔ {TABLE} {len(df)} -> {csv_path}")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE}: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
