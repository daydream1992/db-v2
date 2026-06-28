#!/usr/bin/env python3
"""骗炮批量回测 - 日期范围批量分析 (CLI 工具, 不走 run.py 调度)

用法:
  python 2_计算/71_pianpao_batch.py --start 20250601 --end 20250613
  python 2_计算/71_pianpao_batch.py --start 20250612               # 单日
  python 2_计算/71_pianpao_batch.py --start 20250601 --end 20250613 --force

注: 本脚本无独立 @meta (无专属表, 与 70 共享5张表: pianpao_daily/daily_summary/intraday/intraday_events/intraday_periods)
"""

import sys
from pathlib import Path
import duckdb, pandas as pd
from loguru import logger
from datetime import datetime, timedelta

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

from pianpao_engine import (
    run_analysis, save_to_db, ensure_tables, print_report, DEFAULT_CONFIG
)

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
MODE = 'increment'
SCHEDULE = 'daily'


def get_trading_dates(con, start_date, end_date):
    """获取日期范围内的交易日列表"""
    start = datetime.strptime(start_date, '%Y%m%d').date()
    end = datetime.strptime(end_date, '%Y%m%d').date()

    sql = f"""
    SELECT DISTINCT date
    FROM trading_calendar
    WHERE date >= '{start}' AND date <= '{end}'
      AND is_trading = TRUE
    ORDER BY date
    """
    df = con.execute(sql).fetchdf()
    return [d.strftime('%Y%m%d') for d in df['date'].tolist()]


def get_existing_dates(con):
    """查询数据库中已有的日期"""
    try:
        rows = con.execute("SELECT DISTINCT trade_date FROM pianpao_daily_summary").fetchall()
        return {str(r[0])[:10].replace('-', '') for r in rows}
    except:
        return set()


def check_date_has_data(con, date_str):
    """检查某天是否有K线数据"""
    dd = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:]}"
    count = con.execute(f"""
        SELECT COUNT(*) FROM stock_daily_kline
        WHERE date = '{dd}'
    """).fetchone()[0]
    return count > 100


def get_stock_names(con, codes):
    """获取股票名称映射"""
    try:
        df = con.execute(f"""
            SELECT code, type as name FROM dim_security_type
            WHERE code IN ({','.join([f"'{c}'" for c in codes])})
        """).fetchdf()
        return dict(zip(df['code'], df['name']))
    except:
        return {}


def run_batch(start_date, end_date=None, force=False):
    """批量回测入口"""
    if end_date is None:
        end_date = start_date

    con = duckdb.connect(DB_PATH)
    try:
        logger.info(f"▶ 批量骗炮回测")
        logger.info(f"  日期范围: {start_date} ~ {end_date}")

        # 生成交易日列表
        all_dates = get_trading_dates(con, start_date, end_date)
        if not all_dates:
            logger.warning("  无交易日")
            return True

        logger.info(f"  交易日共 {len(all_dates)} 天")

        # 查已有数据
        if not force:
            existing = get_existing_dates(con)
            skip = [d for d in all_dates if d in existing]
            if skip:
                logger.info(f"  跳过已有数据 {len(skip)} 天: {skip[:5]}{'...' if len(skip) > 5 else ''}")
                all_dates = [d for d in all_dates if d not in existing]
        else:
            logger.info("  --force 模式，重跑所有日期")

        if not all_dates:
            logger.info("  无需处理的日期")
            return True

        # 确保表存在
        ensure_tables(con)

        # 逐日跑
        cfg = DEFAULT_CONFIG.copy()
        success, failed, empty = 0, 0, 0

        for i, target_date in enumerate(all_dates):
            dd = f"{target_date[:4]}-{target_date[4:6]}-{target_date[6:]}"
            logger.info(f"\n[{i+1}/{len(all_dates)}] {dd}")
            logger.info(f"{'─' * 40}")

            try:
                # 检查数据
                if not check_date_has_data(con, target_date):
                    logger.info(f"  跳过: 无数据(非交易日或未入库)")
                    empty += 1
                    continue

                results, sector_analysis = run_analysis(con, target_date, cfg)
                save_to_db(con, results, sector_analysis, target_date)

                if results is not None and not results.empty:
                    success += 1
                else:
                    logger.info(f"  无陷阱股票")
                    empty += 1

            except Exception as e:
                logger.error(f"  [ERROR] {e}")
                import traceback
                traceback.print_exc()
                failed += 1

        # 汇总
        logger.info(f"\n{'=' * 50}")
        logger.info(f"  批量回测完成")
        logger.info(f"  成功: {success}天 | 无骗炮: {empty}天 | 失败: {failed}天")
        logger.info(f"{'=' * 50}")

        return True

    except Exception as e:
        logger.error(f"✘ 批量回测失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        con.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='骗炮批量回测')
    parser.add_argument('--start', required=True, help='起始日期 YYYYMMDD')
    parser.add_argument('--end', default=None, help='结束日期 YYYYMMDD（默认=起始日期）')
    parser.add_argument('--force', action='store_true', help='强制重跑已有日期')
    args = parser.parse_args()

    success = run_batch(args.start, args.end, args.force)
    sys.exit(0 if success else 1)