#!/usr/bin/env python3
"""
K线数据健康检查

使用方法:
  cd K:\DB数据库_v2
  python 3_策略\check_health.py        # 快速检查
  python 3_策略\check_health.py --full # 深度检查

检查项：行数、日期范围、价格异常、零成交量、High<Low
"""
# ---
# @meta table=- cn=数据健康检查 dir=3_策略 sort=002
# @meta schedule=daily mode=increment source=健康检查

import sys
from pathlib import Path
from datetime import datetime, timedelta
import duckdb
import pandas as pd
from loguru import logger

# ========== 常量 ==========
DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'

# 检查配置
KLINE_TABLES = {
    'stock_daily_kline': {'date_col': 'date', 'min_rows': 100000},
    'stock_kline_5m': {'date_col': 'trade_time', 'min_rows': 1000000},
    'stock_kline_1m': {'date_col': 'trade_time', 'min_rows': 5000000},
    'stock_kline_weekly': {'date_col': 'date', 'min_rows': 50000},
    'stock_kline_monthly': {'date_col': 'date', 'min_rows': 10000},
}


def check_table(con, table: str, config: dict, full: bool = False) -> dict:
    """检查单个表"""
    result = {'table': table, 'ok': True, 'issues': []}
    date_col = config['date_col']
    min_rows = config['min_rows']

    try:
        # 行数
        row_count = con.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        result['row_count'] = row_count

        if row_count < min_rows:
            result['issues'].append(f"行数不足: {row_count:,} < {min_rows:,}")
            result['ok'] = False

        if row_count == 0:
            result['issues'].append("无数据")
            result['ok'] = False
            return result

        # 日期范围
        if 'time' in date_col:
            date_query = f"SELECT MIN({date_col}), MAX({date_col}) FROM {table}"
        else:
            date_query = f"SELECT MIN({date_col}), MAX({date_col}) FROM {table}"

        try:
            min_date, max_date = con.execute(date_query).fetchone()
            result['min_date'] = str(min_date)[:10] if min_date else None
            result['max_date'] = str(max_date)[:10] if max_date else None
        except Exception:
            pass

        if full:
            # 深度检查：价格异常
            try:
                # 价格为0或负
                bad_price = con.execute(f"""
                    SELECT COUNT(*) FROM {table}
                    WHERE close <= 0 OR open <= 0 OR high <= 0 OR low <= 0
                """).fetchone()[0]
                if bad_price > 0:
                    result['issues'].append(f"价格异常: {bad_price:,} 条")
                    result['ok'] = False

                # 成交量为0
                bad_vol = con.execute(f"""
                    SELECT COUNT(*) FROM {table}
                    WHERE volume = 0
                """).fetchone()[0]
                if bad_vol > 0:
                    result['issues'].append(f"零成交量: {bad_vol:,} 条")

                # high < low（价格逻辑错误）
                bad_hl = con.execute(f"""
                    SELECT COUNT(*) FROM {table}
                    WHERE high < low
                """).fetchone()[0]
                if bad_hl > 0:
                    result['issues'].append(f"High<Low: {bad_hl:,} 条")
                    result['ok'] = False

            except Exception as e:
                result['issues'].append(f"深度检查失败: {e}")

    except Exception as e:
        result['issues'].append(f"检查失败: {e}")
        result['ok'] = False

    return result


def main():
    # 日志
    logger.remove()
    logger.add(sys.stderr, level='INFO', format='{time:HH:mm:ss} | {message}')

    full = '--full' in sys.argv

    logger.info("=" * 50)
    logger.info(f"K线数据健康检查 {'(深度)' if full else '(快速)'}")
    logger.info("=" * 50)

    con = duckdb.connect(DB_PATH, read_only=True)

    all_ok = True
    for table, config in KLINE_TABLES.items():
        result = check_table(con, table, config, full)

        status = "✅" if result['ok'] else "❌"
        logger.info(f"{status} {table}: {result.get('row_count', 0):,} 行")

        if result.get('min_date'):
            logger.info(f"   日期范围: {result['min_date']} ~ {result['max_date']}")

        if result['issues']:
            for issue in result['issues']:
                logger.warning(f"   - {issue}")
            all_ok = False

    con.close()

    logger.info("=" * 50)
    if all_ok:
        logger.info("✅ 所有检查通过")
    else:
        logger.warning("❌ 存在异常，请检查")
    logger.info("=" * 50)

    sys.exit(0 if all_ok else 1)


if __name__ == '__main__':
    main()