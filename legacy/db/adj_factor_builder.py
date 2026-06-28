"""
前复权因子预计算

从 stock_dividend_data + stock_daily_kline 计算前复权因子，
直接 UPDATE stock_daily_kline.forward_factor 列。

算法：
  1. 对每个除权事件，从前一交易日收盘价计算除权比：
     adj_ratio = (prev_close - cash + right_price * right_ratio)
                 / (prev_close * (1 + bonus + right_ratio))
  2. 用窗口函数从最新向最早做累积乘积 (EXP(SUM(LN())) )
  3. 每个交易日的 forward_factor = 最近一个 ex_date <= 该日的 cum_factor
     最新日 = 1.0，越早越小

使用方式：
    python -m db.adj_factor_builder
    python -m db.adj_factor_builder --stock 600519.SH   # 单股测试
    python -m db.adj_factor_builder --dry-run            # 只输出统计不写入
    python -m db.adj_factor_builder --verify             # 只验证
"""

import logging
import argparse
import duckdb
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "profit_radar.duckdb"


def update_factors_sql(con, stock_code=None):
    """用纯 SQL + 窗口函数计算前复权因子"""
    where_clause = f"AND d.code = '{stock_code}'" if stock_code else ""

    # 清理可能残留的临时表
    con.execute("DROP TABLE IF EXISTS _div_adj")
    con.execute("DROP TABLE IF EXISTS _cum_factors")
    con.execute("DROP TABLE IF EXISTS _kline_new_factors")

    # 过滤未来事件：只处理 ex_date <= 最新 K 线日期
    max_kline_date = con.execute(
        "SELECT MAX(date) FROM stock_daily_kline"
    ).fetchone()[0]
    logger.info(f"  最新 K 线日期: {max_kline_date}, 过滤未来除权事件")

    # Step 1: 计算每个事件的 adj_ratio
    logger.info("Step 1: 计算 adj_ratio ...")
    con.execute(f"""
    CREATE TEMP TABLE _div_adj AS
    SELECT
        d.code, d.ex_date,
        (k.close
         - COALESCE(d.dividend_cash, 0)
         + COALESCE(d.right_issue_price, 0) * COALESCE(d.right_issue_ratio, 0))
        / (k.close
           * (1 + COALESCE(d.dividend_share, 0)
              + COALESCE(d.right_issue_ratio, 0))) AS adj_ratio
    FROM stock_dividend_data d
    INNER JOIN stock_daily_kline k
        ON d.code = k.code
        AND k.date = (
            SELECT MAX(k2.date) FROM stock_daily_kline k2
            WHERE k2.code = d.code AND k2.date < d.ex_date
        )
    WHERE (COALESCE(d.dividend_cash, 0) > 0
        OR COALESCE(d.dividend_share, 0) > 0
        OR COALESCE(d.right_issue_ratio, 0) > 0)
      AND k.close > 0
      AND d.ex_date <= '{max_kline_date}'
      {where_clause}
    """)
    n = con.execute("SELECT COUNT(*) FROM _div_adj").fetchone()[0]
    n_stocks = con.execute("SELECT COUNT(DISTINCT code) FROM _div_adj").fetchone()[0]
    logger.info(f"  {n} 个 adj_ratio, 覆盖 {n_stocks} 只股票")

    if n == 0:
        logger.info("无有效事件，跳过")
        return

    # Step 2: 窗口函数计算累积因子
    # cum_factor_i = product(adj_ratio_j for all j where ex_date_j > ex_date_i)
    # = EXP(SUM(LN(adj_ratio)) OVER (ORDER BY ex_date DESC ROWS UNBOUNDED PRECEDING .. 1 PRECEDING)
    # 但 DuckDB 窗口不支持 1 PRECEDING 偏移与 DESC 组合，改用正序 + 前向排除
    logger.info("Step 2: 计算累积因子 ...")
    con.execute("""
    CREATE TEMP TABLE _cum_factors AS
    SELECT
        code, ex_date,
        EXP(COALESCE(
            SUM(LN(adj_ratio)) OVER (
                PARTITION BY code
                ORDER BY ex_date DESC
                ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
            ),
            0.0
        )) AS cum_factor
    FROM _div_adj
    """)

    # 验证: 最新事件 cum_factor 应为 1.0
    check = con.execute("""
    SELECT SUM(CASE WHEN ABS(cum_factor - 1.0) > 0.001 THEN 1 ELSE 0 END)
    FROM (
        SELECT code, cum_factor,
               ROW_NUMBER() OVER (PARTITION BY code ORDER BY ex_date DESC) AS rn
        FROM _cum_factors
    ) WHERE rn = 1
    """).fetchone()[0]
    if check > 0:
        logger.warning(f"  {check} 只股票最新事件 cum_factor != 1.0 (异常)")

    cf_n = con.execute("SELECT COUNT(*) FROM _cum_factors").fetchone()[0]
    logger.info(f"  {cf_n} 个累积因子")

    # Step 2b: 插入哨兵行 — 覆盖首次除权前的交易日
    # cum_factor = product of ALL adj_ratios for this stock
    logger.info("Step 2b: 插入哨兵行 ...")
    con.execute("""
    INSERT INTO _cum_factors (code, ex_date, cum_factor)
    SELECT code, DATE '0001-01-01', EXP(SUM(LN(adj_ratio)))
    FROM _div_adj
    GROUP BY code
    """)
    sent_n = con.execute("SELECT COUNT(*) FROM _cum_factors").fetchone()[0] - cf_n
    logger.info(f"  插入 {sent_n} 个哨兵行")

    # Step 3: 用 ASOF JOIN 分配因子到每个交易日
    logger.info("Step 3: ASOF JOIN 分配因子 ...")
    con.execute(f"""
    CREATE TEMP TABLE _kline_new_factors AS
    SELECT sk.code, sk.date,
           COALESCE(cf.cum_factor, 1.0) AS new_factor
    FROM stock_daily_kline sk
    ASOF LEFT JOIN _cum_factors cf
        ON sk.code = cf.code AND sk.date >= cf.ex_date
    {'WHERE sk.code = \'' + stock_code + '\'' if stock_code else ''}
    """)

    # 先把没有事件的股票排除（它们保持 1.0）
    factor_stocks = con.execute("SELECT COUNT(DISTINCT code) FROM _cum_factors").fetchone()[0]
    kline_stocks = con.execute("SELECT COUNT(DISTINCT code) FROM stock_daily_kline").fetchone()[0]
    logger.info(f"  需更新 {factor_stocks} 只股票 (总 {kline_stocks} 只)")

    # Step 4: 批量 UPDATE
    logger.info("Step 4: 批量 UPDATE ...")
    con.execute(f"""
    UPDATE stock_daily_kline SET forward_factor = sub.new_factor
    FROM _kline_new_factors sub
    WHERE stock_daily_kline.code = sub.code
      AND stock_daily_kline.date = sub.date
    """)

    updated = con.execute(f"""
    SELECT COUNT(*) FROM stock_daily_kline
    WHERE forward_factor < 0.999999
    {'AND code = \'' + stock_code + '\'' if stock_code else ''}
    """).fetchone()[0]
    logger.info(f"  已更新 {updated} 行的 forward_factor")

    # 清理
    con.execute("DROP TABLE IF EXISTS _div_adj")
    con.execute("DROP TABLE IF EXISTS _cum_factors")
    con.execute("DROP TABLE IF EXISTS _kline_new_factors")


def verify_factors(con, stock_code=None):
    """验证前复权因子"""
    code_where = f"WHERE code = '{stock_code}'" if stock_code else ""

    stats = con.execute(f"""
    SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN forward_factor >= 0.999999 THEN 1 ELSE 0 END) AS unchanged,
        SUM(CASE WHEN forward_factor < 0.999999 THEN 1 ELSE 0 END) AS adjusted,
        ROUND(MIN(forward_factor), 6) AS min_f,
        ROUND(MAX(forward_factor), 6) AS max_f
    FROM stock_daily_kline {code_where}
    """).fetchone()
    logger.info(f"统计: 总={stats[0]}, 未变={stats[1]}, 已调={stats[2]}, "
                f"min={stats[3]}, max={stats[4]}")

    # 最新日因子应为 1.0
    latest = con.execute("SELECT MAX(date) FROM stock_daily_kline").fetchone()[0]
    bad = con.execute(f"""
    SELECT COUNT(*) FROM stock_daily_kline
    WHERE date = '{latest}' AND forward_factor < 0.999999
    {f'AND code = \'{stock_code}\'' if stock_code else ''}
    """).fetchone()[0]
    if bad > 0:
        logger.warning(f"最新日 {latest} 有 {bad} 只股票 factor != 1.0")
    else:
        logger.info(f"最新日 {latest} 所有股票 factor = 1.0 ✓")

    # 抽样
    sample_code = stock_code or "600519.SH"
    sample = con.execute(f"""
    SELECT date, close, ROUND(forward_factor, 6) AS ff,
           ROUND(close * forward_factor, 2) AS adj_close
    FROM stock_daily_kline
    WHERE code = '{sample_code}'
    ORDER BY date DESC LIMIT 15
    """).fetchdf()
    logger.info(f"\n{sample_code} 抽样:")
    print(sample.to_string(index=False))


def main():
    parser = argparse.ArgumentParser(description="前复权因子计算")
    parser.add_argument("--stock", default="", help="单股测试")
    parser.add_argument("--dry-run", action="store_true", help="只统计不写入")
    parser.add_argument("--verify", action="store_true", help="只验证")
    args = parser.parse_args()

    con = duckdb.connect(str(DB_PATH))

    if args.verify:
        verify_factors(con, args.stock or None)
        con.close()
        return

    stock = args.stock or None

    if args.dry_run:
        where = f"AND d.code = '{stock}'" if stock else ""
        stats = con.execute(f"""
        SELECT COUNT(*), COUNT(DISTINCT d.code)
        FROM stock_dividend_data d
        INNER JOIN stock_daily_kline k
            ON d.code = k.code
            AND k.date = (
                SELECT MAX(k2.date) FROM stock_daily_kline k2
                WHERE k2.code = d.code AND k2.date < d.ex_date
            )
        WHERE (COALESCE(d.dividend_cash, 0) > 0
            OR COALESCE(d.dividend_share, 0) > 0
            OR COALESCE(d.right_issue_ratio, 0) > 0)
          AND k.close > 0
          {where}
        """).fetchone()
        logger.info(f"可匹配事件: {stats[0]} 条, 覆盖 {stats[1]} 只股票")
    else:
        logger.info("开始计算前复权因子 ...")
        update_factors_sql(con, stock)
        verify_factors(con, stock)
        logger.info("完成")

    con.close()


if __name__ == "__main__":
    main()
