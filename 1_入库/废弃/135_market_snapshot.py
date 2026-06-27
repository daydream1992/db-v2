#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""行情快照 — 盘中/盘后

数据源: TQ API (get_market_snapshot)
用途: 记录当前时刻所有A股的价格/涨跌/成交量等最新快照信息。
---
# @meta table=market_snapshot cn=行情快照 dir=1_入库 sort=135
# @meta schedule=daily mode=increment source=API(TQ:get_market_snapshot)
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
TABLE = 'market_snapshot'
MODE = 'increment'
SCHEDULE = 'daily'


def _row(item, ts):
    return {
        'snapshot_time': ts,
        'code': item.get('Code', ''),
        'name': item.get('Name', ''),
        'pre_close': float(item.get('PreClose', 0) or 0),
        'open': float(item.get('Open', 0) or 0),
        'price': float(item.get('New', 0) or 0),
        'high': float(item.get('High', 0) or 0),
        'low': float(item.get('Low', 0) or 0),
        'volume': float(item.get('Volume', 0) or 0),
        'amount': float(item.get('Amount', 0) or 0),
        'buy_price': float(item.get('Buy1Price', 0) or 0),
        'sell_price': float(item.get('Sale1Price', 0) or 0),
        'buy_vol': float(item.get('Buy1Volume', 0) or 0),
        'sell_vol': float(item.get('Sale1Volume', 0) or 0),
        'zde': float(item.get('ZDE', 0) or 0),
        'zdf': float(item.get('ZDF', 0) or 0),
        'hsl': float(item.get('HSL', 0) or 0),
        'zjlx': float(item.get('ZJLX', 0) or 0),
    }


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        result = tq.get_market_snapshot(market='5')
    except Exception as e:
        logger.error(f"{TABLE}: {e}")
        return pd.DataFrame()
    if not result:
        return pd.DataFrame()

    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    rows = [_row(x, now) for x in result]
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        snapshot_time TIMESTAMP,
        code          VARCHAR,
        name          VARCHAR,
        pre_close     DOUBLE,
        open          DOUBLE,
        price         DOUBLE,
        high          DOUBLE,
        low           DOUBLE,
        volume        DOUBLE,
        amount        DOUBLE,
        buy_price     DOUBLE,
        sell_price    DOUBLE,
        buy_vol       DOUBLE,
        sell_vol      DOUBLE,
        zde           DOUBLE,
        zdf           DOUBLE,
        hsl           DOUBLE,
        zjlx          DOUBLE
    )""")


def save_data(con, df):
    if MODE == 'increment':
        today = datetime.now().strftime('%Y-%m-%d')
        con.execute(f"""
            DELETE FROM {TABLE}
            WHERE DATE(snapshot_time) = '{today}'
        """)
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
        csv_path = os.path.join(csv_dir, f"{TABLE}_{datetime.now().strftime('%Y%m%d_%H%M')}.csv")
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
