#!/usr/bin/env python3
"""股票行业三级分类 — 每周

数据源: TQ API (get_stock_list + get_stock_list_in_sector)
读取方式: 研究行业1/2/3级板块(list_type=16/17/18) → 遍历每个板块取成份股 → 建反向映射
宽表结构: stock_code + 行业1/2/3级(代码+名称) + updated_at 快照
---
# @meta table=stock_industry_3level cn=股票行业三级分类 dir=1_入库 sort=035
# @meta schedule=weekly mode=full source=API(TQ:get_stock_list+get_stock_list_in_sector)
"""

FIELD_MAP = {
    'stock_code': '股票代码',
    'updated_at': '本批刷新时间',
}

import os, sys
from pathlib import Path
from datetime import datetime

import duckdb
import pandas as pd
from loguru import logger

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent

# TQ API 初始化 (真实路径 K:\txdlianghua, 同 104_stock_financial_data)
tq = None
TQ_PATHS = [
    r"K:\txdlianghua\PYPlugins\user",
    r"K:\txdlianghua\PYPlugins\sys",
]
for _p in TQ_PATHS:
    if Path(_p).exists():
        sys.path.insert(0, _p)
        try:
            from tqcenter import tq as _tq
            _tq.initialize(os.path.abspath(__file__))   # 需绝对路径定位客户端 (同 101_jb/104)
            tq = _tq   # 仅初始化成功后才赋值
            break
        except Exception as _e:
            logger.warning(f"TQ 初始化失败({_p}): {_e}")
            tq = None

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_industry_3level'
MODE = 'full'
SCHEDULE = 'weekly'

# 研究行业 1/2/3 级对应的 list_type
LEVELS = [(1, '16'), (2, '17'), (3, '18')]

# 列定义 SSOT: [(列名, 类型)]
# 业务字段(无通用英文缩写)用中文列名(自描述); stock_code/updated_at 为标识符保留英文
COLUMNS = [
    ('stock_code', 'VARCHAR'),
    ('行业一级代码', 'VARCHAR'),
    ('行业一级名称', 'VARCHAR'),
    ('行业二级代码', 'VARCHAR'),
    ('行业二级名称', 'VARCHAR'),
    ('行业三级代码', 'VARCHAR'),
    ('行业三级名称', 'VARCHAR'),
    ('updated_at', 'TIMESTAMP'),
]
COL_NAMES = [c[0] for c in COLUMNS]


def fetch_data():
    """调 TQ API 获取股票→研究行业1/2/3级的反向映射，生成宽表。"""
    if tq is None:
        logger.warning(f"{TABLE}: tqcenter 未初始化，跳过")
        return pd.DataFrame()

    # 1. 取每个层级的板块代码+名称
    level_data = {}  # {level: [{Code, Name}]}
    for level, lt in LEVELS:
        try:
            blocks = tq.get_stock_list(lt, list_type=1)  # list_type=1 返回代码+名称
        except Exception as e:
            logger.warning(f"{TABLE}: 取行业{level}级板块失败: {e}")
            blocks = None
        if blocks:
            level_data[level] = blocks
            logger.info(f"{TABLE}: 行业{level}级 {len(blocks)} 个板块")
        else:
            # 降级：只取代码列表，名称留空
            try:
                codes = tq.get_stock_list(lt)
            except Exception as e:
                logger.warning(f"{TABLE}: 降级取行业{level}级代码失败: {e}")
                codes = None
            level_data[level] = [{'Code': c, 'Name': ''} for c in (codes or [])]
            logger.info(f"{TABLE}: 行业{level}级 {len(level_data[level])} 个板块（无名称）")

    # 2. 遍历每个板块取成份股，建立 stock -> {level: {code, name}} 反向映射
    stock_to_industry = {}
    start_time = datetime.now()
    for level, _lt in LEVELS:
        blocks = level_data.get(level, [])
        if not blocks:
            continue
        for block in blocks:
            code = block.get('Code', '')
            name = block.get('Name', '')
            if not code:
                continue
            try:
                stocks = tq.get_stock_list_in_sector(code)
            except Exception as e:
                logger.warning(f"{TABLE}: 板块 {code} 取成份股失败: {e}")
                continue
            if not stocks:
                continue
            for sc in stocks:
                if sc not in stock_to_industry:
                    stock_to_industry[sc] = {}
                stock_to_industry[sc][level] = {'code': code, 'name': name}
        elapsed = (datetime.now() - start_time).total_seconds()
        logger.info(f"{TABLE}: 行业{level}级完成，覆盖 {len(stock_to_industry)} 只股票，耗时 {elapsed:.1f}秒")

    if not stock_to_industry:
        logger.warning(f"{TABLE}: 反向映射为空，跳过")
        return pd.DataFrame()

    # 3. 展成宽表
    updated_at = datetime.now()
    rows = []
    for sc, levels in sorted(stock_to_industry.items()):
        row = {'stock_code': sc, 'updated_at': updated_at}
        for level, label in [(1, '一'), (2, '二'), (3, '三')]:
            code_col = f'行业{label}级代码'
            name_col = f'行业{label}级名称'
            info = levels.get(level)
            if info:
                row[code_col] = info['code']
                row[name_col] = info['name']
            else:
                row[code_col] = ''
                row[name_col] = ''
        rows.append(row)

    df = pd.DataFrame(rows)
    # 按 SSOT 顺序补齐缺失列
    for col in COL_NAMES:
        if col not in df.columns:
            df[col] = None
    df = df[COL_NAMES]
    logger.info(f"{TABLE}: 宽表生成完成，共 {len(df):,} 行")
    return df


def ensure_table(con):
    cols_sql = ', '.join([f'"{name}" {typ}' for name, typ in COLUMNS])
    con.execute(f'CREATE TABLE IF NOT EXISTS {TABLE} ({cols_sql})')


def save_data(con, df):
    if MODE == 'increment' and 'date' in df.columns:
        dates = df['date'].unique().tolist()
        placeholders = ','.join(['?'] * len(dates))
        con.execute(f"DELETE FROM {TABLE} WHERE date IN ({placeholders})", dates)
    elif MODE == 'full':
        con.execute(f"DELETE FROM {TABLE}")
    con.execute(f"INSERT INTO {TABLE} SELECT * FROM df")


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        if not force and MODE == 'increment':
            try:
                latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
                if latest and latest >= datetime.now().date():
                    logger.info(f"○ {TABLE} 已是最新({latest})，跳过")
                    return True
            except Exception:
                pass
        ensure_table(con)
        df = fetch_data()
        if df.empty:
            logger.warning(f"○ {TABLE} 数据为空，跳过")
            return True
        save_data(con, df)
        logger.info(f"✔ {TABLE} 入库完成，共 {len(df)} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        try:
            tq.close()
        except Exception:
            pass
        con.close()


if __name__ == '__main__':
    run()
