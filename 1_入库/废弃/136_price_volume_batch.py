#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""批量价量 — 回溯近 30 日

数据源: TQ API (get_market_snapshot 或批量接口)
用途: 对一组股票，批量获取近 N 日价量，用于观察批量接口 vs 单个接口的差异。
---
# @meta table=price_volume_batch cn=批量价量回溯 dir=1_入库 sort=136
# @meta schedule=daily mode=increment source=API(TQ:price-vol batch)
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
TABLE = 'price_volume_batch'
MODE = 'increment'
SCHEDULE = 'daily'


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

    sample = codes_raw[:20]
    # 批量价量通常使用 get_kline_data，这里按文档最常见的“批量单值获取”写法
    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for code in sample:
        try:
            # 尝试批量 get_kline_data：20 根日K（属于价量信息）
            kline = tq.get_kline_data(stock_code=code, period='1d', count=30)
            if not kline:
                continue
            for bar in kline:
                rows.append({
                    'code': code,
                    'trade_date': bar.get('DateTime', ''),
                    'open': float(bar.get('Open', 0) or 0),
                    'close': float(bar.get('Close', 0) or 0),
                    'high': float(bar.get('High', 0) or 0),
                    'low': float(bar.get('Low', 0) or 0),
                    'volume': float(bar.get('Volume', 0) or 0),
                    'amount': float(bar.get('Amount', 0) or 0),
                    'updated_at': now,
                })
        except Exception as e:
            logger.warning(f"{TABLE}: {code} 失败: {e}")
            continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code       VARCHAR,
        trade_date VARCHAR,
        open       DOUBLE,
        close      DOUBLE,
        high       DOUBLE,
        low        DOUBLE,
        volume     DOUBLE,
        amount     DOUBLE,
        updated_at TIMESTAMP
    )""")


def save_data(con, df):
    if MODE == 'increment':
        today = datetime.now().strftime('%Y-%m-%d')
        con.execute(f"""
            DELETE FROM {TABLE}
            WHERE DATE(updated_at) = '{today}'
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
