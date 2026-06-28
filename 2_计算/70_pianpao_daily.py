#!/usr/bin/env python3
"""骗炮每日分析 - 单日分析脚本

用法:
  python 2_计算/70_pianpao_daily.py              # 分析最近交易日
  python 2_计算/70_pianpao_daily.py 20250612     # 分析指定日期
  python 2_计算/70_pianpao_daily.py 20250612 --report  # 仅打印报告
"""
# ---
# @meta table=pianpao_daily cn=骗炮每日明细 dir=2_计算 sort=070
# @meta schedule=daily mode=increment source=SQL派生

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


def find_last_trading_day(con, max_lookback=7):
    """查找最近有数据的交易日"""
    today = datetime.now().date()
    for delta in range(max_lookback):
        d = today - timedelta(days=delta)
        if d.weekday() >= 5:  # 跳过周末
            continue
        dd = d.strftime('%Y%m%d')
        # 检查该日是否有K线数据
        count = con.execute(f"""
            SELECT COUNT(*) FROM stock_daily_kline
            WHERE date = '{d}'
        """).fetchone()[0]
        if count > 100:  # 有足够多的股票数据
            return dd
    return today.strftime('%Y%m%d')


def get_stock_names(con, codes):
    """从股票名称表获取名称（如果存在）"""
    # 尝试从 dim_security_type 获取
    try:
        df = con.execute(f"""
            SELECT code, type as name FROM dim_security_type
            WHERE code IN ({','.join([f"'{c}'" for c in codes])})
        """).fetchdf()
        return dict(zip(df['code'], df['name']))
    except:
        return {}


def run(target_date=None, force=False, report_only=False):
    """单日分析入口"""
    con = duckdb.connect(DB_PATH)
    try:
        # 确定日期
        if not target_date:
            target_date = find_last_trading_day(con)
            logger.info(f"  自动检测最近交易日: {target_date}")

        dd = f"{target_date[:4]}-{target_date[4:6]}-{target_date[6:]}"

        # 增量检查
        if not force and MODE == 'increment':
            try:
                latest = con.execute("SELECT MAX(trade_date) FROM pianpao_daily_summary").fetchone()[0]
                if latest and str(latest) == dd:
                    logger.info(f"○ {dd} 已有数据，使用 --force 强制重跑")
                    return True
            except:
                pass

        logger.info(f"▶ 骗炮分析 {dd}")

        # 确保表存在
        ensure_tables(con)

        # 获取股票名称映射
        cfg = DEFAULT_CONFIG.copy()
        # 先获取候选股票列表用于获取名称
        stock_names = get_stock_names(con, [])

        # 运行分析
        results, sector_analysis = run_analysis(con, target_date, cfg, stock_names)

        if report_only:
            print_report(results, sector_analysis, target_date, cfg)
        else:
            save_to_db(con, results, sector_analysis, target_date, stock_names)
            print_report(results, sector_analysis, target_date, cfg)

        return True

    except Exception as e:
        logger.error(f"✘ 失败: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        con.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='骗炮每日分析')
    parser.add_argument('date', nargs='?', help='目标日期 YYYYMMDD（默认=最近交易日）')
    parser.add_argument('--force', action='store_true', help='强制重跑')
    parser.add_argument('--report', action='store_true', help='仅打印报告不入库')
    args = parser.parse_args()

    success = run(args.date, args.force, args.report)
    sys.exit(0 if success else 1)