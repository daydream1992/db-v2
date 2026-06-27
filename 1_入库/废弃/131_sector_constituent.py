#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""板块成份股映射 — 每日盘后

数据源: TQ API (get_sector_list, get_stock_list_in_sector)
用途: 建立板块代码 -> 成份股代码的映射关系，用于板块维度的数据分析。
---
# @meta table=sector_constituent cn=板块成份股映射 dir=1_入库 sort=131
# @meta schedule=daily mode=full source=API(TQ:get_stock_list_in_sector)
"""

import sys
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
TABLE = 'sector_constituent'
MODE = 'full'
SCHEDULE = 'daily'


def fetch_data():
    """获取全部板块代码 -> 成份股映射。"""
    if tq is None:
        logger.warning(f"{TABLE}: tqcenter 不可用，跳过。")
        return pd.DataFrame()

    all_rows = []
    updated_at = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    try:
        sectors = tq.get_sector_list(list_type=1)
        if not sectors:
            logger.warning(f"{TABLE}: 板块列表为空")
            return pd.DataFrame()
        logger.info(f"{TABLE}: 板块数 {len(sectors)}")
    except Exception as e:
        logger.error(f"{TABLE}: 获取板块列表失败: {e}")
        return pd.DataFrame()

    # 限制前 100 个板块作为演示，保留 CSV 输出
    for sector in sectors[:100]:
        sector_code = sector.get('Code', '')
        sector_name = sector.get('Name', '')
        try:
            stocks = tq.get_stock_list_in_sector(sector_code, list_type=1)
            if not stocks:
                continue
            for s in stocks:
                all_rows.append({
                    'sector_code': sector_code,
                    'sector_name': sector_name,
                    'stock_code': s.get('Code', ''),
                    'stock_name': s.get('Name', ''),
                    'updated_at': updated_at,
                })
        except Exception as e:
            logger.warning(f"{TABLE}: 板块 {sector_code} 取成份股失败: {e}")
            continue

    df = pd.DataFrame(all_rows)
    logger.info(f"{TABLE}: 合计 {len(df)} 条")
    return df


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        sector_code VARCHAR,
        sector_name VARCHAR,
        stock_code  VARCHAR,
        stock_name  VARCHAR,
        updated_at  TIMESTAMP
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
            logger.warning(f"○ {TABLE} 数据为空，跳过")
            return True
        save_data(con, df)

        csv_dir = r'K:\DB数据库_v2\output'
        os.makedirs(csv_dir, exist_ok=True)
        csv_path = os.path.join(csv_dir, f"{TABLE}_{datetime.now().strftime('%Y%m%d')}.csv")
        df.to_csv(csv_path, index=False, encoding='utf-8-sig')
        logger.info(f"✔ {TABLE} 入库 {len(df)} 条，CSV -> {csv_path}")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
