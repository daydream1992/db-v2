#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股本数据（近30日） — 每日盘后

数据源: TQ API (get_gb_info_by_date)
用途: 记录一组股票最近 N 个交易日的总股本/流通股本。
---
# @meta table=capital_info cn=股本数据回溯 dir=1_入库 sort=137
# @meta schedule=daily mode=increment source=API(TQ:get_gb_info_by_date)
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
TABLE = 'capital_info'
MODE = 'increment'
SCHEDULE = 'daily'
DAYS_BACK = 30


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        codes_raw = tq.get_stock_list(market='5', list_type=0)
    except Exception as e:
        logger.error(f"{TABLE}: 取股票列表失败: {e}")
        return pd.DataFrame()
    if not codes_raw:
        return pd.DataFrame()

    sample = codes_raw[:50]
    today = datetime.now()
    rows = []
    now = today.strftime('%Y-%m-%d %H:%M:%S')

    for code in sample:
        for back in range(DAYS_BACK):
            d = (today - timedelta(days=back)).strftime('%Y-%m-%d')
            try:
                info = tq.get_gb_info_by_date(stock_code=code, trading_date=d)
                if not info:
                    continue
                rows.append({
                    'code': code,
                    'trade_date': d,
                    'zgb': float(info.get('ZGB', 0) or 0),
                    'ldgb': float(info.get('LDGB', 0) or 0),
                    'ltgb': float(info.get('LTGB', 0) or 0),
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
        trade_date VARCHAR,
        zgb        DOUBLE,
        ldgb       DOUBLE,
        ltgb       DOUBLE,
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
