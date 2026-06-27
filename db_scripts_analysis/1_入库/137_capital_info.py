#!/usr/bin/env python3
"""股本数据（最近1年） — 每日盘后

数据源: tqcenter API get_gb_info_by_date(stock_code, start_date, end_date)
用途: 全市场所有股票 × 最近1年每个交易日的 总股本(Zgb)/流通股本(Ltgb)
返回样本: [{'Date':20260105,'Zgb':256119392.0,'Ltgb':256119392.0}, ...] (单位:股)
股票全集: stock_daily_kline 去重(code已带后缀,正是API要求格式)
入库: 增量去重(date>=start重灌)+断点续传+分批COPY parquet
---
# @meta table=capital_info cn=股本数据(近1年) dir=1_入库 sort=137
# @meta schedule=daily mode=increment source=tqcenter API(get_gb_info_by_date)
"""
import sys, os, time, json, tempfile
from datetime import datetime, timedelta
from pathlib import Path

import duckdb, pandas as pd
from loguru import logger

# tqcenter 在通达信安装目录(绝对路径), 见 memory tqcenter-real-path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\sys')
from tqcenter import tq
tq.initialize(os.path.abspath(__file__))

# 复用 run.py 的交易日判定
sys.path.insert(0, str(PROJECT_ROOT))
from run import _last_trading_day

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'capital_info'
MODE = 'increment'
SCHEDULE = 'daily'
YEARS_BACK = 1          # 首次回补年数
BATCH_STOCKS = 500      # 每攒多少股 flush 一次入库
FRESH_DAYS = 3          # max(date) 在最近N天内视为已最新, 跳过
# 历史缺口自检(治本): 增量用全局max(date), API偶发失败/新股延迟上市的股历史永久缺口。
# 当记录数过少的股票超过阈值, 自动触发全量回补(365天前重拉+清空重灌)修复。
SPARSE_RECORD_CUTOFF = 50      # 单股记录数 < 此值视为有历史缺口(近1年正常约243个交易日)
SPARSE_STOCK_THRESHOLD = 100   # 缺口股超过此数 -> 触发全量回补

# 字段中文含义(gen_data_dict 自动采集)
FIELD_MAP = {
    'code':       '股票代码(带交易所后缀)',
    'date':       '日期',
    'zgb':        '总股本(股)',
    'ltgb':       '流通股本(股)',
    'updated_at': '入库时间',
}
COLUMNS = list(FIELD_MAP.keys())


def _count_sparse_stocks(con) -> int:
    """历史缺口自检: capital_info 记录数过少的股票数。

    近1年正常每股应有约 243 个交易日记录; API偶发失败/回补不全会让缺口股记录极少
    (极端如全年仅最近1天)。返回 < SPARSE_RECORD_CUTOFF 条的股票数。
    """
    try:
        return con.execute(f"""
            SELECT COUNT(*) FROM (
                SELECT code FROM {TABLE}
                GROUP BY code HAVING COUNT(*) < {SPARSE_RECORD_CUTOFF}
            )
        """).fetchone()[0]
    except Exception:
        return 0


def _int_to_date_str(d) -> str:
    """API Date(double 20260105) -> 'YYYY-MM-DD'"""
    s = str(int(d)) if d else ''
    if len(s) != 8:
        return ''
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _get_all_codes(con):
    """股票全集: stock_daily_kline 去重(code已带后缀, 正是API要求格式)"""
    rows = con.execute("SELECT DISTINCT code FROM stock_daily_kline ORDER BY code").fetchall()
    return [r[0] for r in rows if r[0]]


def ensure_table(con):
    con.execute(f"""CREATE TABLE IF NOT EXISTS {TABLE} (
        code       VARCHAR,
        date       DATE,
        zgb        DOUBLE,
        ltgb       DOUBLE,
        updated_at TIMESTAMP
    )""")


def _flush(con, rows):
    """分批 COPY parquet 入库(纯插入, 去重已在循环前统一处理)"""
    if not rows:
        return 0
    df = pd.DataFrame(rows, columns=COLUMNS)
    df['date'] = pd.to_datetime(df['date'], format='%Y-%m-%d', errors='coerce').dt.date
    df['updated_at'] = pd.to_datetime(df['updated_at'], errors='coerce')
    df = df.dropna(subset=['date'])
    if df.empty:
        return 0
    pq = tempfile.NamedTemporaryFile(suffix='.parquet', delete=False).name
    try:
        df.to_parquet(pq, index=False)
        # Windows 反斜杠路径替换, 避免 DuckDB 字符串转义
        pq_safe = pq.replace('\\', '/')
        con.execute(f"COPY {TABLE} FROM '{pq_safe}' (FORMAT PARQUET)")
    finally:
        if os.path.exists(pq):
            os.unlink(pq)
    return len(df)


def fetch_and_save(con, force=False):
    """逐股调 API 拉最近1年股本, 分批入库。

    起始日: 首次/force/历史缺口过多 = 365天前(全量回补, 清空重灌);
           否则 = 库内全局max(date)(增量, 重灌最新区间)。
    断点续传: 任意时刻中断, 下次自动从 max(date) 续。
    """
    now = datetime.now()
    # 历史缺口自检: 记录数过少的股票(近1年正常约243条, 缺口股极少)
    sparse_n = _count_sparse_stocks(con)
    try:
        latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
    except Exception:
        latest = None
    # 起点决策: force / 首次 / 历史缺口过多 -> 全量回补(365天前, 清空重灌)
    # 否则增量(从库内全局max起, 仅重灌最新区间)
    do_full = force or not latest or sparse_n > SPARSE_STOCK_THRESHOLD
    if do_full:
        start_date_str = (now - timedelta(days=365 * YEARS_BACK)).strftime('%Y%m%d')
        if latest:
            con.execute(f"DELETE FROM {TABLE}")
            logger.info(f"{TABLE}: 全量回补 start={start_date_str}(近{YEARS_BACK}年), 已清空; force={force} 缺口股={sparse_n}")
        else:
            logger.info(f"{TABLE}: 首次回补 start={start_date_str}(近{YEARS_BACK}年); 缺口股={sparse_n}")
    else:
        start_date_str = latest.strftime('%Y%m%d')
        # 入库前一次性删除待覆盖区间, 避免重复行
        sd = f"{latest.strftime('%Y-%m-%d')}"
        con.execute(f"DELETE FROM {TABLE} WHERE date >= CAST('{sd}' AS DATE)")
        logger.info(f"{TABLE}: 增量 start={start_date_str}(库内max), 已清理 date>={sd}; 缺口股={sparse_n}")

    all_codes = _get_all_codes(con)
    todo = all_codes
    logger.info(f"{TABLE}: 区间 {start_date_str}~至今, 待拉 {len(todo)} 股")

    rows = []
    failed = []
    total_in = 0
    t0 = time.time()
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')

    for i, code in enumerate(todo):
        try:
            data = tq.get_gb_info_by_date(stock_code=code, start_date=start_date_str, end_date='')
            if data:
                for item in data:
                    ds = _int_to_date_str(item.get('Date'))
                    if not ds:
                        continue
                    rows.append({
                        'code': code,
                        'date': ds,
                        'zgb': float(item.get('Zgb', 0) or 0),
                        'ltgb': float(item.get('Ltgb', 0) or 0),
                        'updated_at': now_str,
                    })
        except Exception as e:
            failed.append((code, str(e)))

        if (i + 1) % BATCH_STOCKS == 0:
            total_in += _flush(con, rows)
            rows = []
            el = time.time() - t0
            rate = (i + 1) / el if el > 0 else 0
            rem = (len(todo) - i - 1) / rate if rate > 0 else 0
            logger.info(f"  进度 {i+1}/{len(todo)} ({rate:.1f}股/秒, 已入 {total_in:,} 行, 剩 ~{rem:.0f}s)")

    total_in += _flush(con, rows)  # 收尾
    el = time.time() - t0
    logger.info(f"取数入库完成: 耗时 {el:.1f}s, 入库 {total_in:,} 行, 失败 {len(failed)} 股")

    if failed:
        fp = PROJECT_ROOT / 'logs' / f'{TABLE}_failed_{now.strftime("%Y%m%d_%H%M%S")}.json'
        fp.parent.mkdir(exist_ok=True)
        with open(fp, 'w', encoding='utf-8') as f:
            json.dump(failed, f, ensure_ascii=False, indent=2)
        logger.warning(f"失败股已存: {fp}")
    return total_in, len(failed)


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        # 新鲜度检测: max(date) >= 最后一个交易日 才视为已最新跳过
        # 比单纯">=今天-3天"准: 3天窗口内就算有缺口(如周一缺周五)也不会被补
        # 但即使当天已新, 若历史缺口过多(稀疏股>阈值)仍要回补, 不跳过
        if not force:
            try:
                latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
                last_td = _last_trading_day(con)
                if latest and last_td and latest >= last_td:
                    sparse_n = _count_sparse_stocks(con)
                    if sparse_n <= SPARSE_STOCK_THRESHOLD:
                        logger.info(f"○ {TABLE} 已最新(max={latest}, 最后交易日={last_td}, 缺口股={sparse_n}), 跳过; force=True 可强制")
                        return True
                    logger.info(f"  {TABLE} 当天已新但有历史缺口(缺口股={sparse_n}>{SPARSE_STOCK_THRESHOLD}), 触发全量回补")
                elif latest and last_td:
                    logger.info(f"  {TABLE} 滞后(max={latest}, 最后交易日={last_td}), 触发增量补数")
            except Exception:
                pass
        total, nfail = fetch_and_save(con, force=force)
        logger.info(f"✔ {TABLE} 完成: {total:,} 行, 失败 {nfail} 股")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        tq.close()
        con.close()


if __name__ == '__main__':
    run()
