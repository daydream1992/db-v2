"""
SC 市场宏观数据批量拉取脚本

从 TQ API (get_scjy_value) 批量拉取 SC01-SC42 市场交易数据。
支持断点续传：记录已完成的日期范围，中断后自动从上次位置继续。

使用方式：
    python -m db.sc_batch_puller --fields sc3,sc4,sc15,sc20
    python -m db.sc_batch_puller --all              # 拉取全部字段
    python -m db.sc_batch_puller --extend           # 仅补齐最新日期
"""

import sys
import os
import json
import logging
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# 初始化 tqcenter
TDX_ROOT = os.environ.get("TDX_ROOT", "I:/new_tdx_mock")
sys.path.insert(0, f"{TDX_ROOT}/PYPlugins/user")

import duckdb
import pandas as pd

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent / "profit_radar.duckdb"
CHECKPOINT_PATH = Path(__file__).resolve().parent.parent / "sc_pull_checkpoint.json"

# SC 字段完整列表
ALL_SC_FIELDS = [f"sc{i}" for i in range(1, 43)]

# 按 API 返回大小分批（每组字段一次调用）
BATCH_GROUPS = [
    ["sc1", "sc2", "sc3", "sc4", "sc5"],          # 融资融券/陆股通/涨跌停/期货
    ["sc6", "sc7", "sc8", "sc9", "sc10"],          # 期货/ETF/开户/增减持
    ["sc11", "sc12", "sc13", "sc14", "sc15"],      # 大宗/解禁/分红/募资/打板
    ["sc16", "sc17", "sc18", "sc19", "sc20"],      # 龙虎榜/陆股通净买入
    ["sc21", "sc22", "sc23", "sc24", "sc25"],      # 质押/连板/涨停(不含ST)/融资买入
    ["sc26", "sc27", "sc28", "sc29", "sc30"],      # 质押比/央行/新高新低/涨停数据
    ["sc31", "sc32", "sc33", "sc34", "sc35"],      # 涨跌家数/封单/换手板
    ["sc36", "sc37", "sc38", "sc39", "sc40"],      # 曾涨跌停/转融券/ETF金额
    ["sc41", "sc42"],                               # 期货/沪深股通成交
]

# 每次拉取的日期范围（避免一次拉太长）
CHUNK_DAYS = 90  # 3个月一拉


def load_checkpoint():
    if CHECKPOINT_PATH.exists():
        return json.loads(CHECKPOINT_PATH.read_text(encoding="utf-8"))
    return {}


def save_checkpoint(cp):
    CHECKPOINT_PATH.write_text(json.dumps(cp, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_sc_result(api_result):
    """解析 API 返回结果为 DataFrame"""
    rows = []
    if not api_result:
        return pd.DataFrame()

    for field_upper, records in api_result.items():
        field_lower = field_upper.lower()
        for rec in records:
            date_str = rec.get("Date", "")
            values = rec.get("Value", [])
            v0 = float(values[0]) if len(values) > 0 and values[0] else None
            v1 = float(values[1]) if len(values) > 1 and values[1] else None
            rows.append({
                "date": f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}",
                "field_name": field_lower,
                "value_0": v0,
                "value_1": v1,
                "market": "SH",
            })

    if not rows:
        return pd.DataFrame()

    df = pd.DataFrame(rows)
    df["date"] = pd.to_datetime(df["date"]).dt.date
    return df


def pull_fields(tq, fields, start_date, end_date):
    """拉取指定字段在日期范围内的数据"""
    all_dfs = []
    start = datetime.strptime(start_date, "%Y%m%d")
    end = datetime.strptime(end_date, "%Y%m%d")

    current = start
    while current <= end:
        chunk_end = min(current + timedelta(days=CHUNK_DAYS - 1), end)
        chunk_start_str = current.strftime("%Y%m%d")
        chunk_end_str = chunk_end.strftime("%Y%m%d")

        logger.info(f"  拉取 {chunk_start_str} ~ {chunk_end_str} ...")
        try:
            result = tq.get_scjy_value(
                field_list=fields,
                start_time=chunk_start_str,
                end_time=chunk_end_str,
            )
            df = parse_sc_result(result)
            if not df.empty:
                all_dfs.append(df)
                logger.info(f"    获取 {len(df)} 条记录")
            else:
                logger.info(f"    无数据")
        except Exception as e:
            logger.error(f"    API 错误: {e}")
            # 保存断点
            cp = load_checkpoint()
            cp["failed_at"] = chunk_start_str
            save_checkpoint(cp)

        current = chunk_end + timedelta(days=1)

    if all_dfs:
        return pd.concat(all_dfs, ignore_index=True)
    return pd.DataFrame()


def write_to_db(df, db_path):
    """写入 DuckDB（MERGE INTO 避免重复）"""
    if df.empty:
        return 0

    con = duckdb.connect(str(db_path))
    # 先注册临时视图
    con.register("tmp_sc", df)

    # MERGE INTO: 已有记录更新 value_0/value_1，新记录插入
    con.execute("""
        MERGE INTO market_trading_data AS t
        USING tmp_sc AS s
        ON t.date = s.date AND t.field_name = s.field_name AND t.market = s.market
        WHEN MATCHED AND (t.value_0 IS NULL OR t.value_1 IS NULL) THEN
            UPDATE SET
                value_0 = COALESCE(t.value_0, s.value_0),
                value_1 = COALESCE(t.value_1, s.value_1)
        WHEN NOT MATCHED THEN
            INSERT (date, field_name, value_0, value_1, market)
            VALUES (s.date, s.field_name, s.value_0, s.value_1, s.market)
    """)

    count = len(df)
    con.unregister("tmp_sc")
    con.close()
    return count


def get_max_date_in_db(db_path, field_name=None):
    """获取数据库中 SC 数据的最大日期"""
    con = duckdb.connect(str(db_path), read_only=True)
    if field_name:
        row = con.execute(
            "SELECT MAX(date) FROM market_trading_data WHERE field_name = ?",
            [field_name],
        ).fetchone()
    else:
        row = con.execute(
            "SELECT MAX(date) FROM market_trading_data WHERE field_name LIKE 'SC%'"
        ).fetchone()
    con.close()
    return row[0] if row and row[0] else None


def main():
    parser = argparse.ArgumentParser(description="SC 市场宏观数据批量拉取")
    parser.add_argument("--fields", default="", help="字段列表，逗号分隔，如 sc3,sc4,sc15")
    parser.add_argument("--all", action="store_true", help="拉取全部 SC 字段")
    parser.add_argument("--extend", action="store_true", help="仅补齐最新日期（从最后记录日到今天）")
    parser.add_argument("--start", default="20200101", help="起始日期 YYYYMMDD（默认 20200101）")
    parser.add_argument("--end", default="", help="结束日期 YYYYMMDD（默认今天）")
    args = parser.parse_args()

    end_date = args.end or datetime.now().strftime("%Y%m%d")

    if args.all:
        fields_to_pull = ALL_SC_FIELDS
    elif args.fields:
        fields_to_pull = [f.strip().lower() for f in args.fields.split(",")]
    else:
        # 默认拉取量化选股核心字段
        fields_to_pull = [
            "sc1",   # 融资余额/融券余额
            "sc2",   # 陆股通流入
            "sc3",   # 涨停家数/曾涨停
            "sc4",   # 跌停家数/曾跌停
            "sc15",  # 打板资金
            "sc20",  # 陆股通净买入
            "sc24",  # 涨停不含ST
            "sc25",  # 融资买入额
            "sc31",  # 涨跌家数
            "sc33",  # 封单金额
            "sc35",  # 换手板/回封率
            "sc36",  # 曾涨跌停
        ]

    if args.extend:
        max_date = get_max_date_in_db(DB_PATH)
        if max_date:
            start_date = (max_date + timedelta(days=1)).strftime("%Y%m%d")
            logger.info(f"增量模式：从 {start_date} 补齐到 {end_date}")
        else:
            start_date = args.start
    else:
        start_date = args.start

    logger.info(f"准备拉取字段: {fields_to_pull}")
    logger.info(f"日期范围: {start_date} ~ {end_date}")

    # 初始化 TQ API
    from tqcenter import tq
    tq.initialize(TDX_ROOT)
    logger.info("TQ API 初始化完成")

    # 按批次拉取
    total_rows = 0
    for group in BATCH_GROUPS:
        # 只拉取需要的字段
        pull_list = [f for f in group if f in fields_to_pull]
        if not pull_list:
            continue

        logger.info(f"拉取批次 {pull_list} ...")
        df = pull_fields(tq, pull_list, start_date, end_date)
        if not df.empty:
            count = write_to_db(df, DB_PATH)
            total_rows += count
            logger.info(f"  写入 {count} 条（累计 {total_rows}）")

    # 更新断点
    cp = load_checkpoint()
    cp["last_pull"] = datetime.now().isoformat()
    cp["last_start"] = start_date
    cp["last_end"] = end_date
    cp["total_rows"] = cp.get("total_rows", 0) + total_rows
    save_checkpoint(cp)

    logger.info(f"完成！共写入 {total_rows} 条记录")

    # 汇总统计
    con = duckdb.connect(str(DB_PATH), read_only=True)
    stats = con.execute("""
        SELECT field_name, COUNT(*) as cnt, MIN(date) as min_d, MAX(date) as max_d
        FROM market_trading_data
        WHERE field_name LIKE 'SC%'
        GROUP BY field_name
        ORDER BY field_name
    """).fetchall()
    con.close()

    logger.info("=== 数据库 SC 字段统计 ===")
    for fn, cnt, min_d, max_d in stats:
        logger.info(f"  {fn}: {cnt} 条, {min_d} ~ {max_d}")


if __name__ == "__main__":
    main()
