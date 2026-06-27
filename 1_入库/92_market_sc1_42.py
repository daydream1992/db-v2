#!/usr/bin/env python3
"""市场SC宏观指标(SC1-SC42) — 每日盘后

数据来源: 二进制 vipdoc/cw/gpsh999999.dat (13字节/条)
读取方式: 4_工具/tdx_reader.py TdxReader + SC_MAPPING
宽表结构: date + 每个SC的1-2个字段(清爽中文列名, 去单位去编号)
SC1-42 indicator字节映射见 tdx_reader.SC_MAPPING
"""
# @meta table=market_sc1_42 cn=市场SC宏观指标 dir=1_入库 sort=092
# @meta schedule=daily mode=increment source=二进制

import duckdb, pandas as pd, numpy as np
import sys, re
from pathlib import Path
from loguru import logger
from datetime import datetime

# 项目路径
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / '4_工具'))

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'market_sc1_42'
MODE = 'increment'
SCHEDULE = 'daily'


def _clean_field(s: str) -> str:
    """字段清理: 去括号单位 + 去 >= % 等符号, 只留中文核心"""
    if not s:
        return ''
    s = re.sub(r'[（(].*?[）)]', '', s)       # 去括号及单位
    s = s.replace('>=', '超').replace('<=', '低')
    s = re.sub(r'[<>=%]', '', s)
    return s.strip()


def _build_col_list():
    """返回 [(sc_id, indicator, field_key, col_name), ...] 按 SC_MAPPING 顺序
    列名: {name}_{field核心}, 冲突加SC编号前缀
    """
    from tdx_reader import SC_MAPPING
    cols = []
    used = {}
    for sc_id, cfg in SC_MAPPING.items():
        for fk in ('field1', 'field2'):
            field = cfg.get(fk, '')
            if not field:
                continue
            base = f"{cfg['name']}_{_clean_field(field)}"
            col = base
            if col in used:                  # 冲突则加SC编号
                col = f"SC{sc_id:02d}_{base}"
            used[col] = sc_id
            cols.append((sc_id, cfg['indicator'], fk, col))
    return cols


def build_columns():
    """宽表列定义: date + 各SC字段(清爽中文)"""
    cols = {'date': 'DATE'}
    for _, _, _, name in _build_col_list():
        cols[name] = 'DOUBLE'
    return cols


def fetch_data():
    """读二进制 gpsh999999.dat, 生成宽表"""
    from tdx_reader import TdxReader

    reader = TdxReader()
    reader.cutoff_date = 99991231

    dat_path = reader.vipdoc / 'cw' / 'gpsh999999.dat'
    if not dat_path.exists():
        logger.warning(f"SC数据文件不存在: {dat_path}")
        return pd.DataFrame()

    data = np.fromfile(str(dat_path), dtype=np.dtype([
        ('indicator', 'u1'),
        ('date', '<u4'),
        ('value1', '<f4'),
        ('value2', '<f4'),
    ]))

    # 按 indicator 聚合列, 加速日内查找
    col_list = _build_col_list()
    ind_to_cols = {}
    for _, ind, fk, col_name in col_list:
        ind_to_cols.setdefault(ind, []).append((fk, col_name))

    dates = np.unique(data['date'])
    dates = dates[dates >= 20000101]
    # 过滤未来日期（数据文件含回测填充数据）
    today = int(datetime.now().strftime('%Y%m%d'))
    dates = dates[dates <= today]

    rows = []
    for d in dates:
        day_data = data[data['date'] == d]
        row = {'date': pd.to_datetime(str(d), format='%Y%m%d').date()}
        for ind, cols_for_ind in ind_to_cols.items():
            ind_data = day_data[day_data['indicator'] == ind]
            if len(ind_data) == 0:
                continue
            v1 = float(ind_data[0]['value1'])
            v2 = float(ind_data[0]['value2'])
            for fk, col_name in cols_for_ind:
                row[col_name] = v1 if fk == 'field1' else v2
        rows.append(row)

    result = pd.DataFrame(rows)
    if result.empty:
        logger.warning(f"{TABLE}: 无数据")
        return result

    # 补齐缺失列, 按SSOT顺序
    col_defs = build_columns()
    for col in col_defs:
        if col not in result.columns:
            result[col] = np.nan
    result = result[[c for c in col_defs if c in result.columns]]
    result = result.sort_values('date').reset_index(drop=True)
    print(f"读取SC宏观指标 共 {len(result):,} 条，{len(result.columns)} 列")
    return result


def ensure_table(con):
    col_defs = build_columns()
    cols_sql = ', '.join([f'"{k}" {v}' for k, v in col_defs.items()])
    con.execute(f'CREATE TABLE IF NOT EXISTS {TABLE} ({cols_sql})')


def save_data(con, df):
    if MODE == 'increment' and 'date' in df.columns:
        dates = df['date'].unique().tolist()
        placeholders = ','.join(['?'] * len(dates))
        con.execute(f"DELETE FROM {TABLE} WHERE date IN ({placeholders})", dates)
    elif MODE == 'full':
        con.execute(f"DELETE FROM {TABLE}")
    con.execute(f"INSERT INTO {TABLE} SELECT * FROM df")


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
        df = fetch_data()
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
