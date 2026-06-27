#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""通达信公式列表与详情 — 每日盘后

数据源: TQ API (formula_get_all / formula_get_info)
用途: 记录当前客户端内所有公式的元信息，供调用时使用。
---
# @meta table=formula_list cn=通达信公式列表 dir=1_入库 sort=147
# @meta schedule=weekly mode=full source=API(TQ:formula)
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
TABLE = 'formula_list'
MODE = 'full'
SCHEDULE = 'weekly'


def fetch_data():
    if tq is None:
        return pd.DataFrame()
    try:
        result = tq.formula_get_all()
    except Exception as e:
        logger.error(f"{TABLE}: {e}")
        return pd.DataFrame()
    if not result:
        return pd.DataFrame()

    rows = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    for item in result:
        code = item.get('Code', '')
        try:
            detail = tq.formula_get_info(formula_code=code)
            desc = ''
            if detail and isinstance(detail, dict):
                desc = detail.get('Description', '') or ''
        except Exception:
            desc = ''
        rows.append({
            'code': code,
            'name': item.get('Name', ''),
            'category': item.get('Category', ''),
            'description': desc,
            'updated_at': now,
        })
    df = pd.DataFrame(rows)
    logger.info(f"{TABLE}: {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code        VARCHAR,
        name        VARCHAR,
        category    VARCHAR,
        description VARCHAR,
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
