#!/usr/bin/env python3
"""单位一致性检查 v0.2 (降级稳定版)

设计原则:
  - 不知道/不猜任何字段单位
  - 只列"哪些表哪些字段同名 + 抽样值 + 类型", 让人工判断单位是否一致
  - 自动 flag 只标 TYPE_DIFF (类型不一致), 单位量级判断完全交给人
  - 零写入、零 schema 改动

为什么不做"数字量级自动检测"?
  不同股票天然差 1000 倍, 启发式阈值会乱标。单位判断永远是领域知识, 不是 SQL 能做的。

用法:
  python 4_工具/unit_check.py                  # 全量扫描, 输出到 stdout
  python 4_工具/unit_check.py --csv             # 同时输出 csv 到 reports/
  python 4_工具/unit_check.py --field Zjl       # 只看指定字段
  python 4_工具/unit_check.py --top 5           # 每个字段最多抽 5 行
  python 4_工具/unit_check.py --only TYPE_DIFF  # 只看类型不一致的字段

输出列: field_name, table_a, type_a, sample_a, table_b, type_b, sample_b, flag
        flag ∈ {'', TYPE_DIFF}
"""
# @meta table=N/A cn=单位一致性检查 dir=4_工具 sort=099
# @meta schedule=manual mode=read-only source=information_schema

import argparse
import csv as csvmod
import duckdb
from collections import defaultdict
from datetime import datetime

DB_PATH = r'K:\DB数据库_v2\db\profit_radar.duckdb'


def get_all_columns(con):
    """扫描所有表的 (table, column, type)"""
    return con.execute("""
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'main'
        ORDER BY table_name, ordinal_position
    """).fetchall()


def get_sample(con, table, column, n=3):
    """抽样非空值, 返回 list of str (try_cast 到 varchar 避免类型报错)"""
    try:
        rows = con.execute(f"""
            SELECT TRY_CAST({column} AS VARCHAR)
            FROM "{table}"
            WHERE {column} IS NOT NULL
              AND TRY_CAST({column} AS VARCHAR) IS NOT NULL
              AND TRY_CAST({column} AS VARCHAR) != ''
            LIMIT {n}
        """).fetchall()
        return [r[0] for r in rows]
    except Exception as e:
        return [f'<ERR: {type(e).__name__}>']


def find_duplicate_fields(columns):
    """找出出现在 ≥2 张表的字段名"""
    field_tables = defaultdict(list)
    for table, col, typ in columns:
        field_tables[col].append((table, typ))
    return {f: ts for f, ts in field_tables.items() if len(ts) >= 2}


def render_pairs(duplicates, con, top, csv_out=None, only_diff=False):
    """渲染跨表对照表, 只标 TYPE_DIFF"""
    header = (
        f'{"field_name":<20} {"table_a":<35} {"type_a":<12} '
        f'{"sample_a":<25} {"table_b":<35} {"type_b":<12} '
        f'{"sample_b":<25} {"flag":<10}'
    )
    sep = '-' * 180
    print(header)
    print(sep)

    csv_rows = [['field_name', 'table_a', 'type_a', 'sample_a',
                 'table_b', 'type_b', 'sample_b', 'flag']]

    diff_count = 0
    for field in sorted(duplicates.keys()):
        tables = duplicates[field]
        for i in range(len(tables)):
            for j in range(i + 1, len(tables)):
                ta, tya = tables[i]
                tb, tyb = tables[j]

                flag = 'TYPE_DIFF' if tya != tyb else ''
                if flag == 'TYPE_DIFF':
                    diff_count += 1
                if only_diff and not flag:
                    continue

                sa = ', '.join(get_sample(con, ta, field, top))
                sb = ', '.join(get_sample(con, tb, field, top))

                print(
                    f'{field:<20} {ta:<35} {tya:<12} '
                    f'{sa[:24]:<25} {tb:<35} {tyb:<12} '
                    f'{sb[:24]:<25} {flag:<10}'
                )
                csv_rows.append([field, ta, tya, sa, tb, tyb, sb, flag])

    summary = f'\n汇总: {len(duplicates)} 个跨表字段, 其中 TYPE_DIFF={diff_count}'
    print(summary)

    if csv_out:
        with open(csv_out, 'w', encoding='utf-8-sig', newline='') as f:
            w = csvmod.writer(f)
            w.writerows(csv_rows)
        print(f'[CSV] 写入 {csv_out} ({len(csv_rows)-1} 行)')


def main():
    p = argparse.ArgumentParser(description='单位一致性检查: 同名字段跨表清单')
    p.add_argument('--csv', action='store_true', help='同时输出 csv 到 reports/')
    p.add_argument('--field', type=str, help='只看指定字段名 (精确匹配)')
    p.add_argument('--top', type=int, default=3, help='每字段抽样数 (默认 3)')
    p.add_argument('--db', type=str, default=DB_PATH, help='DuckDB 路径')
    p.add_argument('--only', type=str, choices=['TYPE_DIFF'],
                   help='只显示特定 flag 的字段')
    args = p.parse_args()

    con = duckdb.connect(args.db, read_only=True)
    try:
        columns = get_all_columns(con)
        duplicates = find_duplicate_fields(columns)

        if args.field:
            duplicates = {f: ts for f, ts in duplicates.items() if f == args.field}

        print(f'=== 跨表同名字段扫描 (共 {len(duplicates)} 个字段) ===\n')
        if not duplicates:
            print('未发现跨表同名字段。')
            return

        csv_out = None
        if args.csv:
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            csv_out = f'reports/unit_check_{ts}.csv'

        render_pairs(
            duplicates, con, args.top, csv_out,
            only_diff=(args.only == 'TYPE_DIFF'),
        )
    finally:
        con.close()


if __name__ == '__main__':
    main()
