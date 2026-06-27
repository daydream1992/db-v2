"""
1m 日内特征提取

从 kline_1m parquet 按日批处理提取：
  attack_wave, pullback_wave, amplitude, vwap,
  first_limit_up_time, limit_up_count, open_limit_count

使用方式：
    python -m db.intraday_feature
    python -m db.intraday_feature --date 2026-05-29   # 单日测试
    python -m db.intraday_feature --stats              # 统计
"""

import logging
import argparse
import duckdb
import pandas as pd
import numpy as np
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "profit_radar.duckdb"

DDL = """
CREATE TABLE IF NOT EXISTS dwd_stock_intraday_feature (
    code VARCHAR,
    trade_date DATE,
    attack_wave DOUBLE,
    pullback_wave DOUBLE,
    amplitude DOUBLE,
    vwap DOUBLE,
    first_limit_up_time VARCHAR,
    limit_up_count INTEGER,
    open_limit_count INTEGER,
    PRIMARY KEY (code, trade_date)
)
"""


def compute_intraday_features_day(con, trade_date):
    """计算单日所有股票的日内特征"""
    df = con.execute(f"""
    SELECT code, trade_time,
           open, high, low, close, volume, amount
    FROM kline_1m
    WHERE trade_time::DATE = '{trade_date}'
    ORDER BY code, trade_time
    """).fetchdf()

    if df.empty:
        return pd.DataFrame()

    # 获取当日日线（开盘价、昨收）
    daily = con.execute(f"""
    SELECT k.code, k.open AS day_open, k.close AS day_close,
           k.high AS day_high, k.low AS day_low,
           e.zt_price
    FROM stock_daily_kline k
    LEFT JOIN stock_extended_info e ON k.code = e.code AND k.date = e.date
    WHERE k.date = '{trade_date}'
    """).fetchdf()

    results = []
    for code, group in df.groupby("code"):
        if len(group) < 5:
            continue

        day_open = group["open"].iloc[0]
        day_high = group["high"].max()
        day_low = group["low"].min()
        day_close = group["close"].iloc[-1]

        # 攻击波: (日内最高 - 开盘) / 开盘 * 100
        attack_wave = (day_high - day_open) / day_open * 100 if day_open > 0 else 0

        # 回头波: (最高 - 收盘) / 最高 * 100
        pullback_wave = (day_high - day_close) / day_high * 100 if day_high > 0 else 0

        # 振幅: (最高-最低)/昨收 * 100 (近似用 day_open)
        amplitude = (day_high - day_low) / day_open * 100 if day_open > 0 else 0

        # VWAP
        total_amount = group["amount"].sum()
        total_volume = group["volume"].sum()
        vwap = total_amount / total_volume * 10000 if total_volume > 0 else day_close

        # 涨停价
        zt_row = daily[daily["code"] == code]
        zt_price = zt_row["zt_price"].iloc[0] if len(zt_row) > 0 and pd.notna(zt_row["zt_price"].iloc[0]) else None

        first_limit_up_time = None
        limit_up_count = 0
        open_limit_count = 0

        if zt_price and zt_price > 0:
            was_at_limit = False
            for _, bar in group.iterrows():
                if bar["high"] >= zt_price * 0.999:
                    if limit_up_count == 0:
                        first_limit_up_time = str(bar["trade_time"])[-8:]
                    limit_up_count += 1
                    if was_at_limit and bar["close"] < zt_price * 0.999:
                        open_limit_count += 1
                    was_at_limit = bar["close"] >= zt_price * 0.999

        results.append({
            "code": code,
            "trade_date": trade_date,
            "attack_wave": round(attack_wave, 2),
            "pullback_wave": round(pullback_wave, 2),
            "amplitude": round(amplitude, 2),
            "vwap": round(vwap, 3),
            "first_limit_up_time": first_limit_up_time,
            "limit_up_count": limit_up_count,
            "open_limit_count": open_limit_count,
        })

    return pd.DataFrame(results)


def build_all(con):
    """构建所有交易日的日内特征"""
    con.execute(DDL)

    dates = con.execute("""
    SELECT DISTINCT trade_time::DATE FROM kline_1m
    ORDER BY trade_time::DATE
    """).fetchall()

    dates = [d[0] for d in dates]
    logger.info(f"共 {len(dates)} 个交易日")

    total = 0
    for dt in dates:
        dt_str = str(dt)
        df = compute_intraday_features_day(con, dt_str)
        if df.empty:
            continue

        con.register("tmp_if", df)
        con.execute("""
            DELETE FROM dwd_stock_intraday_feature
            WHERE trade_date = (SELECT MIN(trade_date) FROM tmp_if)
        """)
        con.execute("INSERT INTO dwd_stock_intraday_feature SELECT * FROM tmp_if")
        con.unregister("tmp_if")

        total += len(df)
        logger.info(f"  {dt_str}: {len(df)} stocks (total {total})")

    logger.info(f"完成: {total} 条记录")


def main():
    parser = argparse.ArgumentParser(description="1m 日内特征")
    parser.add_argument("--date", default="", help="单日测试")
    parser.add_argument("--stats", action="store_true", help="统计")
    args = parser.parse_args()

    con = duckdb.connect(str(DB_PATH))
    con.execute(DDL)

    if args.stats:
        try:
            print(con.execute("""
                SELECT COUNT(*), COUNT(DISTINCT code), MIN(trade_date), MAX(trade_date)
                FROM dwd_stock_intraday_feature
            """).fetchdf().to_string())
        except Exception as e:
            print(f"Error: {e}")
        con.close()
        return

    if args.date:
        df = compute_intraday_features_day(con, args.date)
        print(df.head(20).to_string(index=False))
    else:
        build_all(con)

    con.close()


if __name__ == "__main__":
    main()
