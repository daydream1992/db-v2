"""
FN 财务数据批量导入

解析 vipdoc/cw/gpcw*.dat 二进制文件，导入 fact_finance_report 表。
混合存储：20 个核心字段直接列存 + 全量 584 字段 JSON 存入 raw_fields。

使用方式：
    python -m db.financial_importer
    python -m db.financial_importer --since 20200101   # 只导入 2020 年后的报告
    python -m db.financial_importer --meta              # 只建 dim_fn_meta
"""

import json
import os
import logging
import argparse
from pathlib import Path
from struct import calcsize, unpack

import duckdb
import pandas as pd
from mootdx.financial.columns import columns as fn_columns

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

BASE_PATH = Path(__file__).resolve().parent.parent
DB_PATH = BASE_PATH / "profit_radar.duckdb"
CW_PATH = Path(os.environ.get("TDX_ROOT", "I:/new_tdx_mock")) / "vipdoc/cw"

# 核心字段映射: (data_index 0-based, column_name)
# data_index = mootdx columns_index - 1 (因为 columns[0] = 'report_date')
CORE_FIELDS = {
    0:   "eps",                # FN1  基本每股收益
    1:   "eps_adjusted",       # FN2  扣非每股收益
    3:   "bvps",               # FN4  每股净资产
    5:   "roe",                # FN6  净资产收益率(%)
    6:   "ocfps",              # FN7  每股经营现金流
    39:  "total_assets",       # FN40 资产总计
    62:  "total_liabilities",  # FN63 负债合计
    63:  "share_capital",      # FN64 实收资本(股本)
    71:  "total_equity",       # FN72 所有者权益合计
    95:  "net_profit_parent",  # FN96 归母净利润
    106: "operating_cf",       # FN107 经营CF净额
    118: "investing_cf",       # FN119 投资CF净额
    127: "financing_cf",       # FN128 筹资CF净额
    231: "net_profit_parent2", # FN232 归母净利润(利润表)
    237: "total_shares",       # FN238 总股本
    501: "total_revenue_wan",  # FN502 营业总收入(万元)
}


DDL_FACT_FINANCE_REPORT = """
CREATE TABLE IF NOT EXISTS fact_finance_report (
    code VARCHAR,
    report_period DATE,
    eps DOUBLE,
    eps_adjusted DOUBLE,
    bvps DOUBLE,
    roe DOUBLE,
    ocfps DOUBLE,
    total_assets DOUBLE,
    total_liabilities DOUBLE,
    share_capital DOUBLE,
    total_equity DOUBLE,
    net_profit_parent DOUBLE,
    operating_cf DOUBLE,
    investing_cf DOUBLE,
    financing_cf DOUBLE,
    net_profit_parent2 DOUBLE,
    total_shares DOUBLE,
    total_revenue_wan DOUBLE,
    raw_fields JSON,
    PRIMARY KEY (code, report_period)
)
"""

DDL_DIM_FN_META = """
CREATE TABLE IF NOT EXISTS dim_fn_meta (
    fn_index INTEGER PRIMARY KEY,
    fn_name VARCHAR,
    fn_col VARCHAR,
    is_mapped BOOLEAN,
    unit_hint VARCHAR
)
"""


def parse_gpcw_file(filepath):
    """解析单个 gpcw 文件，返回 list of (code, report_date, [584 floats])"""
    header_fmt = '<1hI1H3L'
    stock_item_fmt = '<6s1c1L'
    header_size = calcsize(header_fmt)
    stock_item_size = calcsize(stock_item_fmt)

    with open(filepath, 'rb') as f:
        data_header = f.read(header_size)
        header = unpack(header_fmt, data_header)
        max_count = header[2]
        report_date = header[1]
        report_size = header[4]
        field_count = report_size // 4
        report_fmt = f'<{field_count}f'

        results = []
        for idx in range(max_count):
            f.seek(header_size + idx * stock_item_size)
            si = f.read(stock_item_size)
            if len(si) < stock_item_size:
                break
            stock_item = unpack(stock_item_fmt, si)
            code = stock_item[0].decode('utf-8', errors='ignore').strip('\x00')
            offset = stock_item[2]
            if offset == 0:
                continue

            f.seek(offset)
            info_data = f.read(calcsize(report_fmt))
            if len(info_data) < calcsize(report_fmt):
                continue
            fields = unpack(report_fmt, info_data)
            results.append((code, report_date, fields))

    return results


def build_rows(records):
    """将解析结果转为 DataFrame 行"""
    rows = []
    for code, report_date, fields in records:
        # 加市场后缀
        if code.startswith(('6', '5', '9')):
            full_code = f"{code}.SH"
        elif code.startswith(('0', '1', '2', '3')):
            full_code = f"{code}.SZ"
        elif code.startswith(('4', '8')):
            full_code = f"{code}.BJ"
        else:
            full_code = code

        rp_str = str(report_date)
        report_period = f"{rp_str[:4]}-{rp_str[4:6]}-{rp_str[6:8]}"

        row = {"code": full_code, "report_period": report_period}

        # 核心字段
        for fn_idx, col_name in CORE_FIELDS.items():
            row[col_name] = float(fields[fn_idx]) if fn_idx < len(fields) else None

        # 全量 JSON
        raw = {f"fn_{i}": fields[i] for i in range(len(fields))}
        row["raw_fields"] = json.dumps(raw, ensure_ascii=False)

        rows.append(row)

    return rows


def import_all_reports(since=""):
    """导入所有 gpcw 文件"""
    con = duckdb.connect(str(DB_PATH))
    con.execute(DDL_FACT_FINANCE_REPORT)

    gpcw_files = sorted(CW_PATH.glob("gpcw*.dat"))
    total_rows = 0

    for fp in gpcw_files:
        # 从文件名提取日期
        date_part = fp.stem.replace("gpcw", "")
        if since and date_part < since:
            continue

        try:
            records = parse_gpcw_file(fp)
        except Exception as e:
            logger.error(f"解析失败 {fp.name}: {e}")
            continue

        if not records:
            continue

        rows = build_rows(records)
        df = pd.DataFrame(rows)
        df = df.drop_duplicates(subset=["code", "report_period"], keep="last")

        # MERGE INTO (delete + insert)
        df["report_period"] = pd.to_datetime(df["report_period"]).dt.date
        con.register("tmp_fin", df)
        con.execute("""
            DELETE FROM fact_finance_report
            WHERE (code, report_period) IN (
                SELECT code, report_period FROM tmp_fin
            )
        """)
        con.execute("""
            INSERT INTO fact_finance_report
            SELECT * FROM tmp_fin
        """)
        con.unregister("tmp_fin")

        total_rows += len(rows)
        logger.info(f"  {fp.name}: {len(rows)} 条 (累计 {total_rows})")

    con.close()
    logger.info(f"导入完成，共 {total_rows} 条记录")
    return total_rows


def build_fn_meta():
    """构建 FN 字段元数据字典"""
    con = duckdb.connect(str(DB_PATH))
    con.execute(DDL_DIM_FN_META)

    rows = []
    for i, name in enumerate(fn_columns):
        if i == 0:
            continue  # skip report_date
        fn_idx = i  # 1-based FN index
        is_mapped = bool(name and len(name) > 0)
        rows.append({
            "fn_index": fn_idx,
            "fn_name": name if is_mapped else f"col{fn_idx}",
            "fn_col": f"fn_{fn_idx - 1}",  # 0-based data index
            "is_mapped": is_mapped,
            "unit_hint": "unknown",
        })

    # 581 columns list, but 584 data fields → add unmapped
    for extra_idx in range(len(fn_columns) - 1, 584):
        rows.append({
            "fn_index": extra_idx + 1,
            "fn_name": f"unmapped_{extra_idx}",
            "fn_col": f"fn_{extra_idx}",
            "is_mapped": False,
            "unit_hint": "unknown",
        })

    df = pd.DataFrame(rows)
    con.register("tmp_meta", df)
    con.execute("DELETE FROM dim_fn_meta")
    con.execute("INSERT INTO dim_fn_meta SELECT * FROM tmp_meta")
    con.unregister("tmp_meta")

    count = con.execute("SELECT COUNT(*) FROM dim_fn_meta").fetchone()[0]
    con.close()
    logger.info(f"dim_fn_meta: {count} 条记录")


def main():
    parser = argparse.ArgumentParser(description="FN 财务数据导入")
    parser.add_argument("--since", default="", help="只导入此日期后的报告 YYYYMMDD")
    parser.add_argument("--meta", action="store_true", help="只建元数据字典")
    parser.add_argument("--stats", action="store_true", help="只输出统计")
    args = parser.parse_args()

    if args.meta:
        build_fn_meta()
        return

    if args.stats:
        con = duckdb.connect(str(DB_PATH), read_only=True)
        try:
            print(con.execute("""
                SELECT COUNT(*) as total, COUNT(DISTINCT code) as stocks,
                       MIN(report_period) as min_rp, MAX(report_period) as max_rp
                FROM fact_finance_report
            """).fetchdf().to_string())
            print()
            print(con.execute("""
                SELECT YEAR(report_period) as yr, COUNT(*) as cnt
                FROM fact_finance_report
                GROUP BY yr ORDER BY yr DESC LIMIT 10
            """).fetchdf().to_string())
        except Exception as e:
            print(f"Error: {e}")
        con.close()
        return

    logger.info("开始导入 FN 财务数据 ...")
    import_all_reports(args.since)

    # 输出统计
    con = duckdb.connect(str(DB_PATH), read_only=True)
    try:
        stats = con.execute("""
            SELECT COUNT(*) as total, COUNT(DISTINCT code) as stocks,
                   MIN(report_period) as min_rp, MAX(report_period) as max_rp
            FROM fact_finance_report
        """).fetchone()
        logger.info(f"统计: {stats[0]} 条, {stats[1]} 只股票, {stats[2]} ~ {stats[3]}")
    except Exception:
        pass
    con.close()


if __name__ == "__main__":
    main()
