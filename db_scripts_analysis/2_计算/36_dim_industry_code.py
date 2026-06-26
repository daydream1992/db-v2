#!/usr/bin/env python3
"""研究行业代码维度表同步 — 从 stock_industry_3level 派生 881xxx→级别/名称/三级路径

每个 881xxx 研究行业 code → 自身级别+名称 + 完整 一级/二级/三级 路径。
同一 code 若跨级出现(如 L2/L3 同 code), 取最深级。
配套视图 t_bk5_19_industry_labeled: t_bk5_19 LEFT JOIN 本表, 给 BK 交易数据打三级行业标签。
---
# @meta table=dim_industry_code cn=研究行业代码维度表 dir=2_计算 sort=036
# @meta schedule=weekly mode=full source=SQL派生(stock_industry_3level)
# @meta note: 881xxx→级别/名称/三级路径; 视图 t_bk5_19_industry_labeled
"""

import duckdb
from loguru import logger

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'dim_industry_code'
VIEW1 = 't_bk5_19_industry_labeled'
VIEW2 = 'stock_block_relation_industry_labeled'
MODE = 'full'
SCHEDULE = 'weekly'

# 列定义 SSOT: code 标识符保留英文; 业务字段中文自描述
COLUMNS = [
    ('code', 'VARCHAR'),
    ('名称', 'VARCHAR'),
    ('级别', 'VARCHAR'),
    ('行业一级代码', 'VARCHAR'),
    ('行业一级名称', 'VARCHAR'),
    ('行业二级代码', 'VARCHAR'),
    ('行业二级名称', 'VARCHAR'),
    ('行业三级代码', 'VARCHAR'),
    ('行业三级名称', 'VARCHAR'),
]


def fetch_data(con):
    """全量重建: 从 stock_industry_3level 三级路径 UNION, dedup by code 取最深级。"""
    con.execute(f'DELETE FROM {TABLE}')
    con.execute(f"""
    INSERT INTO {TABLE}
    WITH l3 AS (
        SELECT 行业三级代码 code, 行业三级名称 名称, '三级' 级别, 3 优先级,
               行业一级代码, 行业一级名称, 行业二级代码, 行业二级名称, 行业三级代码, 行业三级名称
        FROM (SELECT DISTINCT 行业一级代码, 行业一级名称, 行业二级代码, 行业二级名称, 行业三级代码, 行业三级名称
              FROM stock_industry_3level WHERE 行业三级代码 <> '')
    ),
    l2 AS (
        SELECT 行业二级代码 code, 行业二级名称 名称, '二级' 级别, 2 优先级,
               行业一级代码, 行业一级名称, 行业二级代码, 行业二级名称, '' 行业三级代码, '' 行业三级名称
        FROM (SELECT DISTINCT 行业一级代码, 行业一级名称, 行业二级代码, 行业二级名称
              FROM stock_industry_3level WHERE 行业二级代码 <> '')
    ),
    l1 AS (
        SELECT 行业一级代码 code, 行业一级名称 名称, '一级' 级别, 1 优先级,
               行业一级代码, 行业一级名称, '' 行业二级代码, '' 行业二级名称, '' 行业三级代码, '' 行业三级名称
        FROM (SELECT DISTINCT 行业一级代码, 行业一级名称
              FROM stock_industry_3level WHERE 行业一级代码 <> '')
    ),
    all_codes AS (
        SELECT * FROM l3 UNION ALL SELECT * FROM l2 UNION ALL SELECT * FROM l1
    )
    SELECT code, 名称, 级别, 行业一级代码, 行业一级名称, 行业二级代码, 行业二级名称, 行业三级代码, 行业三级名称
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY code ORDER BY 优先级 DESC) rn
        FROM all_codes
    ) WHERE rn = 1
    """)
    n = con.execute(f'SELECT COUNT(*) FROM {TABLE}').fetchone()[0]
    # 级别分布
    for lv, cnt in con.execute(f'SELECT 级别, COUNT(*) c FROM {TABLE} GROUP BY 1 ORDER BY 1').fetchall():
        logger.info(f'  {lv}: {cnt} 个 code')
    return n


def ensure_table(con):
    cols_sql = ', '.join([f'"{name}" {typ}' for name, typ in COLUMNS])
    con.execute(f'CREATE TABLE IF NOT EXISTS {TABLE} ({cols_sql})')
    # 视图1: t_bk5_19 全量 LEFT JOIN 本表 (880xxx 等非研究行业 → 行业字段 NULL)
    con.execute(f"""
    CREATE OR REPLACE VIEW {VIEW1} AS
    SELECT b.*,
           d.级别, d.行业一级代码, d.行业一级名称,
           d.行业二级代码, d.行业二级名称, d.行业三级代码, d.行业三级名称
    FROM t_bk5_19 b
    LEFT JOIN {TABLE} d ON b.code = d.code
    """)
    # 视图2: stock_block_relation LEFT JOIN stock_industry_3level (给每条板块关系打上股票的行业归属)
    con.execute(f"""
    CREATE OR REPLACE VIEW {VIEW2} AS
    SELECT r.*,
           s.行业一级代码, s.行业一级名称,
           s.行业二级代码, s.行业二级名称,
           s.行业三级代码, s.行业三级名称
    FROM stock_block_relation r
    LEFT JOIN stock_industry_3level s ON r.stock_code = s.stock_code
    """)


def run(force=False):
    logger.info(f'▶ 同步 {TABLE} (weekly, full)')
    con = duckdb.connect(DB_PATH)
    try:
        ensure_table(con)
        total = fetch_data(con)
        logger.info(f'✔ {TABLE} 完成，共 {total} 个行业 code')
        logger.info(f'  视图 {VIEW1} + {VIEW2} 已就绪')
        return True
    except Exception as e:
        logger.error(f'✘ {TABLE} 失败: {e}')
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()
