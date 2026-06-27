#!/usr/bin/env python3
"""证券类型维表同步 — 从stock_daily_kline表提取分类"""
# @meta table=dim_security_type cn=证券类型维表 dir=2_计算 sort=001
# @meta schedule=daily mode=increment source=SQL派生

import duckdb
from loguru import logger

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'dim_security_type'


def fetch_data(con):
    """从K线表提取并分类所有证券code"""
    sql = """
    INSERT INTO dim_security_type (code, type, market, prefix, is_active)
    WITH all_codes AS (
        SELECT DISTINCT code FROM stock_daily_kline
    )
    SELECT
        code,
        CASE
            WHEN code LIKE '51%' OR code LIKE '56%' OR code LIKE '58%' OR code LIKE '15%' THEN 'ETF'
            WHEN code LIKE '88%' THEN '板块'
            WHEN code LIKE '11%' OR code LIKE '12%' OR code LIKE '13%' THEN '可转债'
            WHEN code LIKE '688%' OR code LIKE '689%' THEN '科创板'
            WHEN code LIKE '600%' OR code LIKE '601%' OR code LIKE '603%' OR code LIKE '605%' THEN '沪市主板'
            WHEN code LIKE '000%' OR code LIKE '002%' OR code LIKE '001%' OR code LIKE '003%' THEN '深市主板'
            WHEN code LIKE '300%' OR code LIKE '301%' OR code LIKE '302%' THEN '创业板'
            WHEN code LIKE '92%' OR code LIKE '82%' OR code LIKE '81%' OR code LIKE '899%' THEN '北交所'
            WHEN code LIKE '900%' OR code LIKE '200%' OR code LIKE '204%' THEN 'B股'
            WHEN code LIKE '16%' OR code LIKE '50%' OR code LIKE '18%' OR code LIKE '52%' OR code LIKE '55%' THEN '基金'
            WHEN code LIKE '399%' OR code LIKE '395%' OR code LIKE '530%' THEN '指数'
            WHEN code LIKE '999%' OR code LIKE 'TEST%' THEN '测试'
            ELSE '其他'
        END as type,
        CASE
            WHEN code LIKE '%.SH' THEN 'SH'
            WHEN code LIKE '%.BJ' THEN 'BJ'
            ELSE 'SZ'
        END as market,
        SUBSTRING(code, 1, 3) as prefix,
        TRUE as is_active
    FROM all_codes
    ON CONFLICT (code) DO UPDATE SET
        type = EXCLUDED.type,
        market = EXCLUDED.market,
        prefix = EXCLUDED.prefix,
        is_active = TRUE,
        updated_at = now()
    """
    con.execute(sql)
    # 兜底：修正不在 stock_daily_kline 源的边缘 .BJ code（旧二分法遗留 market='SZ'）
    con.execute("UPDATE dim_security_type SET market='BJ', updated_at=now() WHERE code LIKE '%.BJ' AND market <> 'BJ'")
    # is_active 真实语义：最新交易日有交易=TRUE（停牌/退市/边缘品种=FALSE）
    con.execute("""
        UPDATE dim_security_type
        SET is_active = code IN (
                SELECT code FROM stock_daily_kline
                WHERE date = (SELECT MAX(date) FROM stock_daily_kline)
            ),
            updated_at = now()
    """)

    stats = con.execute("""
        SELECT type, COUNT(*) as cnt
        FROM dim_security_type
        GROUP BY type
        ORDER BY cnt DESC
    """).fetchall()

    for t, cnt in stats:
        logger.info(f'  {t}: {cnt}')

    return con.execute('SELECT COUNT(*) FROM dim_security_type').fetchone()[0]


def ensure_table(con):
    con.execute("""CREATE TABLE IF NOT EXISTS dim_security_type (
        code        VARCHAR PRIMARY KEY,
        type        VARCHAR,
        market      VARCHAR,
        prefix      VARCHAR,
        is_active   BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )""")


def run(force=False):
    logger.info(f'▶ 同步 {TABLE}')
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)

        if not force:
            try:
                latest = con.execute('SELECT MAX(updated_at) FROM dim_security_type').fetchone()[0]
                if latest:
                    logger.info(f'  上次更新: {latest}')
            except:
                pass

        total = fetch_data(con)
        logger.info(f'✔ {TABLE} 完成，共 {total} 条')
        return True
    except Exception as e:
        logger.error(f'✘ {TABLE} 失败: {e}')
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
