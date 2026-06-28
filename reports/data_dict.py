#!/usr/bin/env python3
# @meta table=data_dict cn=数据字典报表 dir=reports sort=007
# @meta schedule=manual mode=report source=profit_radar.duckdb
"""数据字典报表 — 按需生成"""
import duckdb
import json
import pandas as pd
from datetime import datetime
from pathlib import Path
from loguru import logger

# ========== 路径常量 ==========
DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'data_dict'
DICT_TABLE = 'meta.data_dict'  # 数据库表名（含 schema）
MODE = 'report'
SCHEDULE = 'manual'
OUTPUT_DIR = Path(r'K:\DB数据库_v2\reports')
TABLES_JSON = Path(r'K:\DB数据库_v2\config\tables.json')
DATA_DICT_JSON = Path(r'K:\DB数据库_v2\config\data_dictionary.json')
FILE_PREFIX = 'data_dict'

# ========== 辅助函数 ==========

def load_tables_meta():
    """从 tables.json 加载表元数据"""
    with open(TABLES_JSON, encoding='utf-8') as f:
        return json.load(f)


def get_date_columns(conn, table_name: str):
    """获取表中包含日期的列"""
    cols = conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = ?",
        [table_name]
    ).df()['column_name'].tolist()

    date_patterns = ['date', 'trade_date', 'dt', 'report_date',
                     'snapshot_date', 'update_date', 'trade_time', 'hqdate']
    found = []
    for c in cols:
        c_lower = c.lower()
        for p in date_patterns:
            if p in c_lower:
                found.append(c)
                break
    return found


def scan_tables(conn, tables_meta):
    """扫描全量表，返回表维度数据"""
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
    ).df()['table_name'].tolist()

    results = []
    for idx, t in enumerate(tables, 1):
        try:
            col_count = int(conn.execute(
                "SELECT COUNT(*) FROM information_schema.columns WHERE table_name = ?",
                [t]
            ).fetchone()[0])
        except:
            col_count = 0

        row_count = 0
        date_range = '-'
        try:
            row_count = int(conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
        except:
            pass

        if row_count > 0:
            date_cols = get_date_columns(conn, t)
            for dc in date_cols:
                try:
                    # 尝试数值排序（VARCHAR存日期字符串如"20250619"时需要）
                    r = conn.execute(f"SELECT MIN(CAST({dc} AS INT)), MAX(CAST({dc} AS INT)) FROM {t}").fetchone()
                    if r[0] and r[1]:
                        date_range = f"{str(r[0])[:10]} ~ {str(r[1])[:10]}"
                        break
                except:
                    # 兜底：原始排序
                    try:
                        r = conn.execute(f"SELECT MIN({dc}), MAX({dc}) FROM {t}").fetchone()
                        if r[0] and r[1]:
                            date_range = f"{str(r[0])[:10]} ~ {str(r[1])[:10]}"
                            break
                    except:
                        continue

        # 从 tables.json 读取元数据，兜底处理不在注册表中的旧系统表
        meta = tables_meta.get(t, {})
        is_view = conn.execute(
            "SELECT table_type FROM information_schema.tables WHERE table_name = ?", [t]
        ).fetchone()
        is_view = is_view and is_view[0] == 'VIEW'

        if not meta:
            # 视图: tables.json 未登记, 用主表 cn 兜底(只针对 _labeled 视图)
            if is_view and t.endswith('_labeled'):
                main = t[:-len('_labeled')]
                main_meta = tables_meta.get(main, {})
                main_cn = main_meta.get('cn', '未登记主表')
                cn = f'{main_cn}_打标签'
                source = '视图(SQL派生)'
                schedule = '-'
                mode = '-'
                period = '-'
            # 旧系统临时/备份表兜底
            elif t.startswith('_'):
                cn = '临时表'
                source = '旧系统'
                schedule = '-'
                mode = '-'
                period = '-'
            elif '_old' in t or '_bk' in t:
                cn = t.replace('_', '').title().replace('_', ' ')
                source = '旧系统'
                schedule = '-'
                mode = '-'
                period = '-'
            elif t == '表名':
                cn = '临时表'
                source = '旧系统'
                schedule = '-'
                mode = '-'
                period = '-'
            else:
                cn = '-'; source = '-'; schedule = '-'; mode = '-'; period = '-'
        else:
            cn = meta.get('cn', '-')
            source = meta.get('source', '-')
            schedule = meta.get('schedule', '-')
            mode = meta.get('mode', '-')
            period = meta.get('period', '-')

        # 脚本路径：直接使用 tables.json 中的 dir 字段
        dir_name = meta.get('dir', '')
        sort_val = meta.get('sort', 999)
        try:
            sort_num = int(sort_val) if sort_val not in ('', None) else 999
        except (ValueError, TypeError):
            sort_num = 999
        script_path = dir_name if dir_name else '-'

        results.append({
            'idx': idx,
            'table_name': t,
            'table_name_cn': cn,
            'col_count': col_count,
            'row_count': row_count,
            'date_range': date_range,
            'schedule': schedule,
            'mode': mode,
            'period': period,
            'source': source,
            'script_path': script_path,
            'sort_key': sort_num,
        })

    results.sort(key=lambda x: (x['sort_key'], x['table_name']))
    for i, r in enumerate(results, 1):
        r['idx'] = i

    return results


def load_field_cn_map():
    """从 data_dictionary.json 加载字段级中文映射"""
    try:
        with open(DATA_DICT_JSON, encoding='utf-8') as f:
            data = json.load(f)
        # 构建 table -> {col_name: cn} 的映射
        result = {}
        for tbl, info in data.items():
            if tbl.startswith('_') or not isinstance(info, dict):
                continue
            cols = info.get('columns', [])
            if cols:
                col_map = {}
                for c in cols:
                    col_name = c.get('name', '')
                    cn = c.get('cn', '')
                    if col_name and cn and cn != 'TODO':
                        col_map[col_name] = cn
                if col_map:
                    result[tbl] = col_map
        # 调试输出
        logger.info(f"  field_cn_map 表: {list(result.keys())}")
        logger.info(f"  stock_kline_1m 映射: {result.get('stock_kline_1m', {})}")
        return result
    except Exception as e:
        logger.warning(f"加载字段映射失败: {e}")
        return {}


def scan_columns(conn, tables_meta, tables_data):
    """扫描全量列，返回列维度数据（匹配数据库结构）"""
    tables = conn.execute(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'main' ORDER BY table_name"
    ).df()['table_name'].tolist()

    # 构建表->行数映射
    row_count_map = {d['table_name']: d['row_count'] for d in tables_data}

    # 加载字段中文映射
    field_cn_map = load_field_cn_map()
    logger.info(f"  字段映射: {len(field_cn_map)} 张表有映射")

    results = []
    for t in tables:
        try:
            cols = conn.execute(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_name = ? ORDER BY ordinal_position",
                [t]
            ).df()
            meta = tables_meta.get(t, {})
            table_cn = meta.get('cn', '-')
            row_count = row_count_map.get(t, 0)
            # 获取该表的字段映射
            tbl_col_map = field_cn_map.get(t, {})
            for _, row in cols.iterrows():
                col_name = row['column_name']
                # 查询字段中文映射，兜底为空
                data_dict_col = tbl_col_map.get(col_name, '')
                results.append({
                    'table_schema': 'main',
                    'table_name': t,
                    'table_comment': table_cn,
                    'row_count': row_count,
                    'column_name': col_name,
                    'data_type': row['data_type'],
                    'is_nullable': row['is_nullable'],
                    'column_comment': '',  # 默认空（兼容性）
                    'data_dict_columns': data_dict_col,  # 字段中文映射
                })
        except:
            pass

    return results


def format_markdown(tables_data, col_data, tables_meta):
    """格式化为 Markdown"""
    lines = []
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    lines.append("# 数据字典报表")
    lines.append("")
    lines.append(f"**生成时间**: {now}")
    lines.append(f"**数据库**: `profit_radar.duckdb`")
    lines.append(f"**表总数**: {len(tables_data)} 张")
    lines.append(f"**列总数**: {len(col_data)} 个")
    lines.append("")

    # 表字典
    lines.append("## 表字典")
    lines.append("")
    header = " | ".join([
        f"{'序':^4}", f"{'表名':<30}", f"{'中文名':<14}", f"{'列':>4}",
        f"{'行数':>12}", f"{'日期范围':<24}", f"{'周期':<8}",
        f"{'模式':<8}", f"{'数据源':<14}"
    ])
    lines.append(header)
    sep = "-|-".join(['-'*4, '-'*30, '-'*14, '-'*4, '-'*12, '-'*24, '-'*8, '-'*8, '-'*14])
    lines.append(sep)
    for d in tables_data:
        col_count_val = int(d['col_count']) if d['col_count'] else 0
        row_count_val = int(d['row_count']) if d['row_count'] else 0
        row = " | ".join([
            f"{d['idx']:^4}",
            f"{d['table_name']:<30}",
            f"{d['table_name_cn']:<14}",
            f"{col_count_val:>4}",
            f"{row_count_val:>12,}",
            f"{d['date_range']:<24}",
            f"{d['schedule']:<8}",
            f"{d['mode']:<8}",
            f"{d['source']:<14}",
        ])
        lines.append(row)

    # 列字典摘要
    lines.append("")
    lines.append("## 列字典摘要（每表列数）")
    lines.append("")
    lines.append("| 序 | 表名 | 中文名 | 列数 |")
    lines.append("|--|------|--------|--|")
    current_table = None
    seq = 0
    for d in col_data:
        if d['table_name'] != current_table:
            current_table = d['table_name']
            seq += 1
            meta = tables_meta.get(current_table, {})
            if not meta:
                cn = '旧系统表' if current_table.startswith('_') or current_table == '表名' or '_old' in current_table or '_bk' in current_table else '-'
            else:
                cn = meta.get('cn', '-')
            lines.append(
                f"| {seq} | {current_table} | {cn} | {len([x for x in col_data if x['table_name'] == current_table])} |"
            )

    lines.append("")
    lines.append("> 完整列字典见 `data_dict_columns_*.csv`")
    return "\n".join(lines)


def save_reports(tables_data, col_data, tables_meta, sync_db=False):
    """保存报表
    sync_db: 是否同步到数据库 data_dict 表
    """
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now()
    prefix = now.strftime('%Y%m-%d_%H%M%S')

    # Markdown
    md_file = f"data_dict_{prefix}.md"
    md_path = OUTPUT_DIR / md_file
    md_content = format_markdown(tables_data, col_data, tables_meta)
    with open(md_path, 'w', encoding='utf-8') as f:
        f.write(md_content)

    # CSV - 表维度
    df_table = pd.DataFrame(tables_data)[
        ['idx', 'table_name', 'table_name_cn', 'col_count', 'row_count',
         'date_range', 'schedule', 'mode', 'period', 'source', 'script_path']
    ]
    df_table.columns = ['序号', '表名', '中文名', '列数', '行数', '日期范围',
                         '周期', '模式', '时段', '数据源', '脚本路径']
    csv_table_file = f"data_dict_{prefix}.csv"
    df_table.to_csv(OUTPUT_DIR / csv_table_file, index=False, encoding='utf-8-sig')

    # CSV - 列维度（兼容数据库结构）
    df_col = pd.DataFrame(col_data)[
        ['table_schema', 'table_name', 'table_comment', 'row_count',
         'column_name', 'data_type', 'is_nullable', 'column_comment', 'data_dict_columns']
    ]
    df_col.columns = ['模式', '表名', '表中文名', '行数', '列名', '数据类型', '可空', '列备注', '字段中文映射']
    csv_col_file = f"data_dict_columns_{prefix}.csv"
    df_col.to_csv(OUTPUT_DIR / csv_col_file, index=False, encoding='utf-8-sig')

    return md_path, OUTPUT_DIR / csv_table_file, OUTPUT_DIR / csv_col_file


def sync_to_db(con, col_data):
    """同步到数据库 data_dict 表"""
    logger.info("同步到数据库...")
    # 检查并添加新列
    existing_cols = set(con.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'data_dict' AND table_schema = 'meta'"
    ).df()['column_name'].tolist())
    if 'data_dict_columns' not in existing_cols:
        logger.info("  添加 data_dict_columns 列...")
        con.execute("ALTER TABLE meta.data_dict ADD COLUMN data_dict_columns VARCHAR")
    # 清空旧数据
    con.execute(f"DELETE FROM {DICT_TABLE}")
    # 批量插入
    df = pd.DataFrame(col_data)
    con.execute(f"INSERT INTO {DICT_TABLE} SELECT * FROM df")
    # 验证
    count = con.execute(f"SELECT COUNT(*) FROM {DICT_TABLE}").fetchone()[0]
    logger.info(f"  已写入 {count} 行")
    return count


def run(force=False, sync_db=True):
    """入口函数
    force: 是否强制刷新
    sync_db: 是否同步到数据库（默认开启）
    """
    logger.info(f"▶ 开始 {TABLE}")
    con = None
    try:
        logger.info("加载表元数据...")
        tables_meta = load_tables_meta()
        logger.info(f"  tables.json: {len(tables_meta)} 张")

        logger.info("连接数据库...")
        con = duckdb.connect(DB_PATH)

        logger.info("扫描表...")
        tables_data = scan_tables(con, tables_meta)
        logger.info(f"  库中表: {len(tables_data)} 张")

        logger.info("扫描列...")
        col_data = scan_columns(con, tables_meta, tables_data)
        logger.info(f"  总列数: {len(col_data)} 个")

        logger.info("保存报表...")
        md_path, csv_path, col_path = save_reports(tables_data, col_data, tables_meta)

        # 同步到数据库
        if sync_db:
            sync_to_db(con, col_data)

        logger.info(f"✔ {TABLE} 完成")
        logger.info(f"  Markdown: {md_path}")
        logger.info(f"  CSV表字典: {csv_path}")
        logger.info(f"  CSV列字典: {col_path}")
        return True

    except Exception as e:
        logger.error(f"✘ {TABLE} 失败: {e}")
        return False

    finally:
        if con:
            con.close()


if __name__ == '__main__':
    run()