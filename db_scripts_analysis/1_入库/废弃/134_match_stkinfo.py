#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""证券信息检索（模糊匹配） — 每日盘后

数据源: TQ API (get_match_stkinfo)
用途: 测试模糊检索接口的能力；作为测试输出写入 CSV。
---
# @meta table=match_stkinfo cn=证券模糊检索结果 dir=1_入库 sort=134
# @meta schedule=once mode=full source=API(TQ:get_match_stkinfo)
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
TABLE = 'match_stkinfo'
MODE = 'full'
SCHEDULE = 'once'

TEST_KEYWORDS = ['银行', '科技', '新能源', '茅台', '华为', 'ETF', '医药']


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for kw in TEST_KEYWORDS:
        try:
            result = tq.get_match_stkinfo(kw, max_count=50)
            if not result:
                continue
            for item in result:
                rows.append({
                    'keyword': kw,
                    'code': item.get('Code', ''),
                    'name': item.get('Name', ''),
                    'updated_at': now,
                })
        except Exception as e:
            logger.warning(f"{TABLE}: {kw} -> {e}")
            continue
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        keyword    VARCHAR,
        code       VARCHAR,
        name       VARCHAR,
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
