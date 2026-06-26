#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股票更多信息 — 每日盘后

数据源: TQ API (get_more_info)
用途: 记录个股的扩展信息（所属行业、概念、财务简要等）。
---
# @meta table=stock_more_info cn=股票更多信息 dir=1_入库 sort=139
# @meta schedule=daily mode=full source=API(TQ:get_more_info)
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
TABLE = 'stock_more_info'
MODE = 'full'
SCHEDULE = 'daily'

MORE_FIELDS = [
    'PlateIndustry', 'PlateArea', 'PlateStyle', 'PlateNotion',
    'PE', 'PB', 'PS', 'TotalMV', 'CirculMV',
    'NetProfitYoy', 'RevenueYoy',
]


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
    for code in codes[:300]:
        try:
            info = tq.get_more_info(stock_code=code)
            if not info:
                continue
            row = {'code': code, 'updated_at': now}
            for k in MORE_FIELDS:
                v = info.get(k, '')
                try:
                    if k in ('PlateIndustry', 'PlateArea', 'PlateStyle', 'PlateNotion'):
                        row[k.lower()] = str(v)
                    else:
                        row[k.lower()] = float(v) if v not in ('', None) else 0.0
                except Exception:
                    row[k.lower()] = 0.0
            rows.append(row)
        except Exception as e:
            logger.warning(f"{TABLE}: {code} -> {e}")
            continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    str_cols = ['plateindustry', 'platearea', 'platestyle', 'platenotion']
    num_cols = [c for c in [f.lower() for f in MORE_FIELDS] if c not in str_cols]
    sql_cols = (
        ', '.join([f"{c} VARCHAR" for c in str_cols])
        + ', '
        + ', '.join([f"{c} DOUBLE" for c in num_cols])
    )
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code VARCHAR,
        {sql_cols},
        updated_at TIMESTAMP
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
