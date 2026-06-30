#!/usr/bin/env python3
"""股票板块关系 — 每日盘后

数据源: TQ API (get_relation) — 每只股票取其归属的全部板块(行业/概念/风格/指数)
读取方式: 全市场股票(遍历板块成分股去重) → 逐只 get_relation → 关系宽表
限流: ≤5次/秒 (API_DELAY=0.2), 全量约17分钟 (见 memory get_relation-api)
---
# @meta table=stock_block_relation cn=股票板块关系 dir=1_入库 sort=262
# @meta schedule=daily mode=increment source=API(TQ:get_relation)
# @meta note: 去重键 stock_code+板块代码+fetch_time日期, 同日重跑覆盖; get_relation 实测0.05s延时0失败, 全量~6分钟
"""

FIELD_MAP = {
    'stock_code': '股票代码',
    'fetch_time': '采集时间',
}

import os, sys, time, json
from pathlib import Path
from datetime import datetime

import duckdb
import pandas as pd
from loguru import logger

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# TQ API 初始化 (真实路径 K:\txdlianghua, 同 104/35)
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
            _tq.initialize(os.path.abspath(__file__))   # 需绝对路径定位客户端 (同 101_jb/104/35)
            tq = _tq   # 仅初始化成功后才赋值
            break
        except Exception as _e:
            logger.warning(f"TQ 初始化失败({_p}): {_e}")
            tq = None

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'stock_block_relation'
MODE = 'increment'
SCHEDULE = 'daily'

API_DELAY = 0.05   # get_relation 限流垫 (memory 称≤5次/秒, 实测 tqcenter 内部排队, 0.05s 足够; 失败多再调大)

# 列定义 SSOT: stock_code/fetch_time 标识符保留英文; 业务字段中文自描述
COLUMNS = [
    ('stock_code', 'VARCHAR'),
    ('板块代码', 'VARCHAR'),
    ('板块名称', 'VARCHAR'),
    ('板块类型', 'VARCHAR'),
    ('成分股数', 'INTEGER'),
    ('fetch_time', 'TIMESTAMP'),
]
COL_NAMES = [c[0] for c in COLUMNS]


def fetch_data():
    """全市场股票 → 逐只 get_relation → 板块关系宽表"""
    if tq is None:
        logger.warning(f"{TABLE}: tqcenter 未初始化，跳过")
        return pd.DataFrame()

    # 1. 全市场股票: 遍历板块成分股去重 (同 104)
    sectors = tq.get_sector_list()
    logger.info(f"{TABLE}: 板块总数 {len(sectors)}")
    all_stocks = set()
    for i, sector in enumerate(sectors):
        try:
            in_sec = tq.get_stock_list_in_sector(sector)
            if in_sec:
                all_stocks.update(in_sec)
        except Exception as e:
            logger.debug(f"板块 {sector} 成分股失败: {e}")
        if (i + 1) % 100 == 0:
            logger.info(f"  板块进度 {i+1}/{len(sectors)}, 累计股票 {len(all_stocks)}")
    stocks = sorted(all_stocks)
    logger.info(f"{TABLE}: 全量股票 {len(stocks)}, 开始逐只 get_relation (预计 ~{len(stocks)*API_DELAY/60:.0f} 分钟)")

    # 2. 逐只 get_relation (≤5次/秒限流)
    rows = []
    failed = []
    fetch_time = datetime.now()
    t0 = time.time()
    for i, stock in enumerate(stocks):
        try:
            rels = tq.get_relation(stock_code=stock)
            if rels:
                for r in rels:
                    rows.append({
                        'stock_code': stock,
                        '板块代码': r.get('BlockCode', ''),
                        '板块名称': r.get('BlockName', ''),
                        '板块类型': r.get('BlockType', ''),
                        '成分股数': r.get('GPNume', ''),
                        'fetch_time': fetch_time,
                    })
            else:
                failed.append(stock)
        except Exception as e:
            failed.append(stock)
            logger.debug(f"{stock} get_relation 失败: {e}")
        if API_DELAY:
            time.sleep(API_DELAY)
        if (i + 1) % 200 == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed if elapsed > 0 else 0
            eta = (len(stocks) - i - 1) / rate if rate > 0 else 0
            logger.info(f"  get_relation 进度 {i+1}/{len(stocks)} ({rate:.1f}只/秒, 剩余~{eta:.0f}s, 失败{len(failed)})")

    logger.info(f"{TABLE}: 关系 {len(rows)} 条, 失败 {len(failed)} 只, 耗时 {time.time()-t0:.0f}秒")
    if failed:
        fail_path = PROJECT_ROOT / 'logs' / f'{TABLE}_failed_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        fail_path.parent.mkdir(exist_ok=True)
        with open(fail_path, 'w', encoding='utf-8') as f:
            json.dump(failed, f, ensure_ascii=False)
        logger.warning(f"  失败股票清单 → {fail_path}")

    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    # 成分股数 (API 返回字符串) → 整数 (空值容错)
    df['成分股数'] = pd.to_numeric(df['成分股数'], errors='coerce').astype('Int64')
    for col in COL_NAMES:
        if col not in df.columns:
            df[col] = None
    return df[COL_NAMES]


def ensure_table(con):
    cols_sql = ', '.join([f'"{name}" {typ}' for name, typ in COLUMNS])
    con.execute(f'CREATE TABLE IF NOT EXISTS {TABLE} ({cols_sql})')


def save_data(con, df):
    # 去重: 自然键=(stock_code,板块名称,板块类型,fetch_time)。板块代码对指数/风格板块为'0'
    # (get_relation 对这类板块不返回代码 → 板块代码='0'是正常特征, 不是脏数据),
    # 故去重必须用 板块名称+板块类型, 不能用板块代码。
    df = df.drop_duplicates(['stock_code', '板块名称', '板块类型', 'fetch_time'])
    # 按日覆盖: 删今日旧行再插 (同日重跑幂等), 事务包裹
    con.execute("BEGIN")
    try:
        con.execute(f"DELETE FROM {TABLE} WHERE CAST(fetch_time AS DATE) = CURRENT_DATE")
        con.execute(f"INSERT INTO {TABLE} SELECT * FROM df")
        con.execute("COMMIT")
    except Exception:
        con.execute("ROLLBACK")
        raise


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        # 同日跳过 (避免日内重复17分钟拉取)
        if not force:
            try:
                cnt = con.execute(
                    f"SELECT COUNT(*) FROM {TABLE} WHERE CAST(fetch_time AS DATE) = CURRENT_DATE"
                ).fetchone()[0]
                if cnt > 0:
                    logger.info(f"○ {TABLE} 今日已入库({cnt}条), 跳过 (force=True 强制)")
                    return True
            except Exception:
                pass
        ensure_table(con)
        df = fetch_data()
        if df.empty:
            logger.warning(f"○ {TABLE} 数据为空, 跳过")
            return True
        save_data(con, df)
        logger.info(f"✔ {TABLE} 入库完成, 共 {len(df):,} 条")
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
