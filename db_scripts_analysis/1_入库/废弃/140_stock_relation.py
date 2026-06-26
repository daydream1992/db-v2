#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""股票所属板块 — 每日盘后

数据源: TQ API (get_relation)
用途: 记录个股对应的行业/概念/风格等板块标签。
---
# @meta table=stock_relation cn=股票所属板块 dir=1_入库 sort=140
# @meta schedule=daily mode=full source=API(TQ:get_relation)
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
TABLE = 'stock_relation'
MODE = 'full'
SCHEDULE = 'daily'


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
    for code in codes[:200]:
        try:
            info = tq.get_relation(stock_code=code)
            if not info:
                continue
            # info 通常返回一个 dict，含 板块类别 -> 板块名称列表
            for k, v in info.items():
                if isinstance(v, list):
                    for sector in v:
                        rows.append({
                            'code': code,
                            'rel_type': k,
                            'sector_code': sector.get('Code', '') if isinstance(sector, dict) else '',
                            'sector_name': sector.get('Name', '') if isinstance(sector, dict) else str(sector),
                            'updated_at': now,
                        })
                else:
                    rows.append({
                        'code': code,
                        'rel_type': k,
                        'sector_code': '',
                        'sector_name': str(v),
                        'updated_at': now,
                    })
        except Exception as e:
            logger.warning(f"{TABLE}: {code} -> {e}")
            continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code        VARCHAR,
        rel_type    VARCHAR,
        sector_code VARCHAR,
        sector_name VARCHAR,
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
