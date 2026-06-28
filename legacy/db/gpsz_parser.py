"""
gpsz*.dat 二进制解析器 — 个股数据总览

格式: 13 bytes/record
  byte 0:     type_id  (uint8)   — 数据类型编号 (0x01~0x2f)
  byte 1-4:   date     (uint32 LE) — YYYYMMDD
  byte 5-8:   value1   (float32 LE)
  byte 9-12:  value2   (float32 LE)

数据源: I:\\new_tdx_mock\\vipdoc\\cw\\gpsz*.dat  (READ-ONLY)
"""
import struct
import logging
from pathlib import Path
from dataclasses import dataclass
from typing import List

log = logging.getLogger("gpsz")

RECORD_SIZE = 13

# 龙虎榜相关 type (需与 API GP02 校准后确认)
DRAGON_TIGER_TYPES = {
    0x0B: "lhb_detail",
    0x0C: "lhb_amount",
    0x1B: "lhb_count_type",
    0x26: "lhb_flag",
}

# 所有已知 type 描述
TYPE_NAMES = {
    0x01: "quarterly_summary",
    0x02: "special_event",
    0x03: "daily_main",
    0x04: "margin_rate",
    0x05: "margin_balance",
    0x06: "daily_volume_cumul",
    0x07: "margin_net_buy",
    0x08: "dividend_ex_date_a",
    0x09: "dividend_ex_date_b",
    0x0A: "rating_snapshot",
    0x0B: "lhb_detail",
    0x0C: "lhb_amount",
    0x0D: "lhb_net_amount",
    0x0E: "block_trade",
    0x0F: "block_trade_flag",
    0x10: "daily_large_cumul",
    0x11: "shareholder_change",
    0x12: "institution_summary",
    0x13: "weekly_amount",
    0x14: "weekly_ratio",
    0x15: "daily_score",
    0x16: "score_detail",
    0x18: "institution_detail",
    0x19: "daily_amount_cumul",
    0x1B: "lhb_count_type",
    0x1D: "shareholder_count",
    0x1E: "price_history",
    0x1F: "fund_flow_cumul",
    0x20: "fund_flow_detail",
    0x21: "limit_down_flag",
    0x22: "limit_up_amount",
    0x23: "margin_amount",
    0x24: "new_flag_2024",
    0x25: "flag_single",
    0x26: "lhb_flag",
    0x27: "score_ratio",
    0x28: "institution_amount",
    0x29: "price_history_old",
    0x2A: "fund_net_amount",
    0x2B: "price_detail",
    0x2C: "current_price",
    0x2D: "rating_score",
    0x2F: "derived_2025",
}


@dataclass
class GpszRecord:
    type_id: int
    date: int        # YYYYMMDD
    value1: float
    value2: float


def parse_gpsz(filepath: Path) -> List[GpszRecord]:
    """解析单个 gpsz*.dat 文件"""
    data = filepath.read_bytes()
    if len(data) % RECORD_SIZE != 0:
        log.warning(f"  {filepath.name}: size {len(data)} not divisible by {RECORD_SIZE}")
        return []

    n = len(data) // RECORD_SIZE
    records = []
    for i in range(n):
        off = i * RECORD_SIZE
        t = data[off]
        date_val = struct.unpack_from('<I', data, off + 1)[0]
        v1 = struct.unpack_from('<f', data, off + 5)[0]
        v2 = struct.unpack_from('<f', data, off + 9)[0]
        records.append(GpszRecord(t, date_val, v1, v2))
    return records


def parse_gpsz_to_df(filepath: Path, code: str = None):
    """解析 gpsz 文件并返回 DataFrame"""
    import pandas as pd

    records = parse_gpsz(filepath)
    if not records:
        return pd.DataFrame()

    if code is None:
        code = filepath.stem.replace("gpsz", "")

    rows = []
    for r in records:
        if not (19900101 <= r.date <= 20991231):
            continue
        rows.append({
            "code": code,
            "trade_date": f"{r.date // 10000}-{(r.date // 100) % 100:02d}-{r.date % 100:02d}",
            "data_type": r.type_id,
            "type_name": TYPE_NAMES.get(r.type_id, f"unknown_{r.type_id:02x}"),
            "value1": round(r.value1, 4),
            "value2": round(r.value2, 4),
        })

    return pd.DataFrame(rows)


def parse_gpsz_dragon_tiger(filepath: Path, code: str = None):
    """只提取龙虎榜相关 type 的记录"""
    import pandas as pd

    records = parse_gpsz(filepath)
    if not records:
        return pd.DataFrame()

    if code is None:
        code = filepath.stem.replace("gpsz", "")

    rows = []
    for r in records:
        if r.type_id not in DRAGON_TIGER_TYPES:
            continue
        if not (19900101 <= r.date <= 20991231):
            continue
        rows.append({
            "code": code,
            "trade_date": f"{r.date // 10000}-{(r.date // 100) % 100:02d}-{r.date % 100:02d}",
            "data_type": r.type_id,
            "type_name": DRAGON_TIGER_TYPES[r.type_id],
            "value1": round(r.value1, 4),
            "value2": round(r.value2, 4),
        })

    return pd.DataFrame(rows)


def batch_parse_gpsz(cw_dir: Path, db_path: str, filter_types=None):
    """
    批量解析 cw 目录下所有 gpsz 文件并入库

    filter_types: 只入库指定 type, 如 {0x0B, 0x0C, 0x1B, 0x26}
    """
    import duckdb
    import pandas as pd

    files = sorted(cw_dir.glob("gpsz*.dat"))
    if not files:
        log.error(f"  cw_dir 下无 gpsz 文件: {cw_dir}")
        return 0

    # 先写入临时 DB，避免主 DB 被锁定时无法写入
    tmp_db = str(Path(db_path).with_suffix(".gpsz_tmp.duckdb"))
    if Path(tmp_db).exists():
        Path(tmp_db).unlink()

    conn = duckdb.connect(tmp_db)
    conn.execute("""CREATE TABLE IF NOT EXISTS gpsz_daily (
        code VARCHAR,
        trade_date DATE,
        data_type INTEGER,
        type_name VARCHAR,
        value1 DOUBLE,
        value2 DOUBLE,
        PRIMARY KEY (code, trade_date, data_type)
    )""")

    total = len(files)
    written = 0

    for idx, f in enumerate(files):
        code = f.stem.replace("gpsz", "")
        records = parse_gpsz(f)

        rows = []
        for r in records:
            if not (19900101 <= r.date <= 20991231):
                continue
            if filter_types and r.type_id not in filter_types:
                continue
            rows.append({
                "code": code,
                "trade_date": f"{r.date // 10000}-{(r.date // 100) % 100:02d}-{r.date % 100:02d}",
                "data_type": r.type_id,
                "type_name": TYPE_NAMES.get(r.type_id, f"unknown_{r.type_id:02x}"),
                "value1": round(r.value1, 4),
                "value2": round(r.value2, 4),
            })

        if rows:
            df = pd.DataFrame(rows).drop_duplicates(
                subset=["code", "trade_date", "data_type"], keep="last"
            )
            conn.register("_tmp", df)
            conn.execute("""
                INSERT INTO gpsz_daily (code, trade_date, data_type, type_name, value1, value2)
                SELECT s.code, s.trade_date, s.data_type, s.type_name, s.value1, s.value2
                FROM _tmp s
                WHERE NOT EXISTS (
                    SELECT 1 FROM gpsz_daily t
                    WHERE t.code = s.code AND t.trade_date = s.trade_date AND t.data_type = s.data_type
                )
            """)
            conn.unregister("_tmp")
            written += len(df)
            del df

        if (idx + 1) % 500 == 0 or idx == total - 1:
            log.info(f"  gpsz 进度: {idx + 1}/{total}, 已写入 {written:,} 条")

    conn.close()

    # 合并到主 DB
    log.info("  合并到主数据库...")
    try:
        main_conn = duckdb.connect(db_path)
        main_conn.execute("PRAGMA journal_mode=WAL")
        main_conn.execute("""CREATE TABLE IF NOT EXISTS gpsz_daily (
            code VARCHAR,
            trade_date DATE,
            data_type INTEGER,
            type_name VARCHAR,
            value1 DOUBLE,
            value2 DOUBLE,
            PRIMARY KEY (code, trade_date, data_type)
        )""")
        main_conn.execute(f"""
            INSERT INTO gpsz_daily (code, trade_date, data_type, type_name, value1, value2)
            SELECT s.code, s.trade_date, s.data_type, s.type_name, s.value1, s.value2
            FROM (SELECT * FROM gpsz_daily AT '{tmp_db}') s
            WHERE NOT EXISTS (
                SELECT 1 FROM gpsz_daily t
                WHERE t.code = s.code AND t.trade_date = s.trade_date AND t.data_type = s.data_type
            )
        """)
        main_conn.close()
        Path(tmp_db).unlink()
        log.info("  合并完成，临时 DB 已清理")
    except Exception as e:
        log.warning(f"  合并到主 DB 失败: {e}")
        log.info(f"  数据已保存在临时 DB: {tmp_db}")
        log.info("  请关闭占用主 DB 的进程后手动合并")

    return written


def calibrate_with_api(gpsz_dir: Path, stock_code: str, test_date: str):
    """
    校准: 对比 gpsz 数据与 API GP02 数据的单位

    stock_code: 6位代码如 '000001'
    test_date: YYYYMMDD 如 '20260528'
    """
    fpath = gpsz_dir / f"gpsz{stock_code}.dat"
    if not fpath.exists():
        print(f"文件不存在: {fpath}")
        return

    records = parse_gpsz(fpath)
    date_int = int(test_date)

    print(f"\n=== {stock_code} @ {test_date} ===")
    for r in records:
        if r.date == date_int:
            name = TYPE_NAMES.get(r.type_id, f"type_{r.type_id:02x}")
            print(f"  type=0x{r.type_id:02x} ({name:25s})  v1={r.value1:14.2f}  v2={r.value2:14.2f}")
