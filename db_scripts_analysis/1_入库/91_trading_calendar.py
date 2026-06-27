#!/usr/bin/env python3
"""交易日历 — 每日盘后

数据来源: TQ API (get_trading_dates)
"""
# @meta table=trading_calendar cn=交易日历 dir=1_入库 sort=091
# @meta schedule=daily mode=increment source=API(TQ)

FIELD_MAP = {'is_trading': '是否交易日'}

import sys
from pathlib import Path
import duckdb, pandas as pd
from loguru import logger
from datetime import datetime, timedelta

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# TQ API 初始化
tq = None
TQ_PATHS = [
    r"K:\txdlianghua\PYPlugins\user",
    r"K:\txdlianghua\PYPlugins\user",
    r"K:\txdlianghua\PYPlugins\sys",
]
for p in TQ_PATHS:
    if Path(p).exists():
        sys.path.insert(0, p)
        try:
            from tqcenter import tq
            tq.initialize(__file__)
            break
        except Exception as e:
            logger.warning(f"TQ 初始化失败: {e}")
            break

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'trading_calendar'
MODE = 'increment'
SCHEDULE = 'daily'

YEARS = 20


def fetch_data():
    """调API/读文件获取数据"""
    global tq
    if tq is None:
        logger.warning(f"{TABLE}: tqcenter 未初始化")
        return pd.DataFrame()

    end_dt = datetime.now().strftime("%Y%m%d")
    start_dt = (datetime.now() - timedelta(days=365 * YEARS)).strftime("%Y%m%d")

    try:
        dates = tq.get_trading_dates(market='SH', start_time=start_dt, end_time=end_dt, count=0)
    except Exception as e:
        logger.warning(f"{TABLE}: 获取交易日历失败: {e}")
        return pd.DataFrame()

    if not dates:
        logger.warning(f"{TABLE}: 交易日历返回空")
        return pd.DataFrame()

    trading_set = set()
    if isinstance(dates, list):
        trading_set = set(str(d) for d in dates)
    elif isinstance(dates, pandas.DatetimeIndex) or isinstance(dates, pd.DatetimeIndex):
        trading_set = set(d.strftime("%Y-%m-%d") for d in dates)
    elif isinstance(dates, pd.DataFrame):
        # 假设DataFrame有date列
        if 'date' in dates.columns:
            trading_set = set(dates['date'].astype(str).tolist())
        else:
            trading_set = set(dates.iloc[:, 0].astype(str).tolist())

    all_dates = pd.date_range(start=start_dt, end=end_dt, freq="D")
    rows = []
    for d in all_dates:
        ds = d.strftime("%Y-%m-%d")
        is_trading = ds in trading_set or d.strftime("%Y%m%d") in trading_set
        if is_trading:
            rows.append({
                "date": d.date(),
                "is_trading": True,
                "market": "SH",
            })

    logger.info(f"{TABLE}: 获取 {len(rows)} 个交易日 ({start_dt} ~ {end_dt})")
    return pd.DataFrame(rows)

def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        date DATE,
        is_trading BOOLEAN,
        market VARCHAR
    )""")

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
            except: pass
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
        con.close()

if __name__ == '__main__':
    run()
