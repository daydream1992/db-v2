#!/usr/bin/env python3
"""板块BK交易数据(BK05-BK19) — 每日盘后

数据来源: 二进制 vipdoc/cw/gpsh*.dat (code>=880000, 13字节/条)
读取方式: 4_工具/tdx_reader.py TdxReader.read_bk()
宽表结构: date/code/bk_name + 15指标列
BK5-19 indicator字节映射见 tdx_reader.BK_MAPPING (BK05-19 = 0x05-0x13)
"""
# @meta table=t_bk5_19 cn=板块BK交易数据 dir=1_入库 sort=034
# @meta schedule=daily mode=increment source=二进制

import duckdb, pandas as pd, numpy as np
import sys, os, tempfile
from pathlib import Path
from loguru import logger
from datetime import datetime

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 't_bk5_19'
MODE = 'full'
SCHEDULE = 'daily'

# 列定义 SSOT: [(列名, 类型)]
# 通用缩写(pe_ttm/pb_mrq等)/标识符(date/code/bk_name)保留英文,业务指标用中文
COLUMNS = [
    ('date', 'DATE'),
    ('code', 'VARCHAR'),
    ('bk_name', 'VARCHAR'),
    ('pe_ttm', 'DOUBLE'),      # 市盈率TTM(通用缩写)
    ('pb_mrq', 'DOUBLE'),      # 市净率MRQ
    ('ps_ttm', 'DOUBLE'),      # 市销率TTM
    ('pc_ttm', 'DOUBLE'),      # 市现率TTM
    ('涨跌数', 'DOUBLE'),
    ('总市值', 'DOUBLE'),       # 亿元
    ('流通市值', 'DOUBLE'),     # 亿元
    ('涨停数', 'DOUBLE'),
    ('跌停数', 'DOUBLE'),
    ('涨停数据', 'DOUBLE'),
    ('融资融券', 'DOUBLE'),
    ('陆股通流入', 'DOUBLE'),
    ('开盘成交数', 'DOUBLE'),
    ('股息率', 'DOUBLE'),
    ('自由流通市值', 'DOUBLE'), # 亿元
]

# BK indicator 字节 -> 列名 (BK_MAPPING: BK05-19 = 0x05-0x13)
BK_TO_COLUMN = {
    'BK05': 'pe_ttm', 'BK06': 'pb_mrq', 'BK07': 'ps_ttm', 'BK08': 'pc_ttm',
    'BK09': '涨跌数', 'BK10': '总市值', 'BK11': '流通市值',
    'BK12': '涨停数', 'BK13': '跌停数', 'BK14': '涨停数据',
    'BK15': '融资融券', 'BK16': '陆股通流入', 'BK17': '开盘成交数',
    'BK18': '股息率', 'BK19': '自由流通市值',
}
COL_NAMES = [c[0] for c in COLUMNS]


def fetch_data(con):
    """读 cw 二进制文件，pivot 一次性生成宽表"""
    import numpy as np
    from pathlib import Path
    from tdx_reader import TdxReader, BK_MAPPING

    reader = TdxReader()
    reader.cutoff_date = 99991231

    cw_dir = reader.vipdoc / 'cw'
    if not cw_dir.exists():
        logger.warning(f"cw目录不存在: {cw_dir}")
        return pd.DataFrame()

    dat_files = [
        f for f in cw_dir.iterdir()
        if f.suffix == '.dat' and f.name.startswith('gpsh')
    ]
    if not dat_files:
        logger.warning(f"未找到BK数据文件")
        return pd.DataFrame()

    def extract_code(filepath: str) -> str:
        name = Path(filepath).stem
        if len(name) >= 6:
            code_str = name[4:]
            if code_str.isdigit() and 880000 <= int(code_str) < 999999:
                return f"{code_str}.SH"
        return ''

    ind_to_bk = {cfg['indicator']: (bk_id, cfg['name']) for bk_id, cfg in BK_MAPPING.items()}
    valid_inds = set(ind_to_bk.keys())
    cutoff_int = 20000101

    dtype = np.dtype([
        ('indicator', 'u1'),
        ('date', '<u4'),
        ('value1', '<f4'),
        ('value2', '<f4'),
    ])

    # 全量增量过滤：increment 模式只取库中 max(date) 之后的数据
    if MODE == 'increment':
        try:
            max_date = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
            if max_date:
                cutoff_int = int(max_date.strftime('%Y%m%d')) + 1
        except Exception:
            pass

    total_files = len(dat_files)
    parts = []

    for idx, dat_file in enumerate(dat_files):
        code = extract_code(dat_file.name)
        if not code:
            continue

        try:
            data = np.fromfile(str(dat_file), dtype=dtype)
            # 过滤有效指标 + 日期范围
            mask = np.isin(data['indicator'], list(valid_inds))
            mask &= (data['date'] >= cutoff_int) & (data['date'] <= reader.cutoff_date)
            data = data[mask]
            if len(data) == 0:
                continue

            df = pd.DataFrame(data)
            # indicator -> BK列名
            df['col'] = df['indicator'].map(lambda x: BK_TO_COLUMN[f"BK{ind_to_bk[x][0]:02d}"])
            # 透视：每个 date 一行，各指标列取 first
            piv = df.pivot_table(index='date', columns='col', values='value1', aggfunc='first').reset_index()
            piv['code'] = code
            # bk_name: 取该文件任一指标的名称
            first_ind = data['indicator'][0]
            piv['bk_name'] = ind_to_bk[first_ind][1]
            parts.append(piv)
        except Exception as e:
            logger.warning(f"解析文件失败 {dat_file.name}: {e}")
            continue

        if (idx + 1) % 500 == 0:
            logger.info(f"读取进度 {idx+1}/{total_files}...")

    if not parts:
        return pd.DataFrame()

    result = pd.concat(parts, ignore_index=True)
    # date 转为 date 类型
    result['date'] = pd.to_datetime(result['date'].astype(str), format='%Y%m%d').dt.date
    # 补齐缺失列，按 SSOT 顺序
    for col in COL_NAMES:
        if col not in result.columns:
            result[col] = None
    result = result[COL_NAMES]

    logger.info(f"宽表生成完成，共 {len(result):,} 行")
    return result


def ensure_table(con):
    cols_sql = ', '.join([f'"{name}" {typ}' for name, typ in COLUMNS])
    con.execute(f'CREATE TABLE IF NOT EXISTS {TABLE} ({cols_sql})')


def save_data(con, df):
    """COPY parquet 一次性导入"""
    if df.empty:
        return
    if MODE == 'increment' and 'date' in df.columns:
        dates = df['date'].unique().tolist()
        placeholders = ','.join(['?'] * len(dates))
        con.execute(f"DELETE FROM {TABLE} WHERE date IN ({placeholders})", dates)
    elif MODE == 'full':
        con.execute(f"DELETE FROM {TABLE}")

    # 写临时 parquet，COPY 一次性导入
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix='.parquet', delete=False) as f:
        parquet_path = f.name
    try:
        df.to_parquet(parquet_path, index=False)
        con.execute(f"COPY {TABLE} FROM '{parquet_path}' (FORMAT PARQUET)")
    finally:
        if os.path.exists(parquet_path):
            os.unlink(parquet_path)


def run(force=False):
    logger.info(f"▶ 开始 {TABLE}")
    con = duckdb.connect(DB_PATH)
    try:
        if not force and MODE == 'increment':
            try:
                latest = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
                if latest and latest >= datetime.now().date():
                    logger.info(f"○ {TABLE} 已是最新({latest})，跳过")
                    return True
            except: pass
        ensure_table(con)
        df = fetch_data(con)
        if df.empty:
            logger.warning(f"○ {TABLE} 数据为空，跳过")
            return True
        save_data(con, df)
        logger.info(f"✔ {TABLE} 入库完成，共 {len(df)} 条")
        return True
    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False
    finally:
        con.close()


if __name__ == '__main__':
    run()