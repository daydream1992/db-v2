#!/usr/bin/env python3
"""一致性健康检查

复用 gen_data_dict 生成的数据, 报告三类问题:
  [RED] 孤儿表: DB有, 无脚本
  [YEL] 死脚本: 有脚本, DB无表 (未跑过或脚本出错)
  [BLU] 三方失同步: @meta <-> data_dictionary <-> tables.json 对不上
"""
import sys, json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))

from run import get_all_scripts_meta, load_tables
from config.gen_data_dict import build_data_dict, check_integrity


def main():
    print('=' * 60)
    print('一致性健康检查')
    print('=' * 60)

    scripts_meta = get_all_scripts_meta()
    tables_json = load_tables()
    data_dict = build_data_dict()

    n_red = n_yel = n_blu = 0

    # 1. 孤儿/测试/维度表由 data_dict 给出
    print('\n[孤儿表] (DB有, 无对应脚本):')
    orphans = [k for k, v in data_dict.items() if k != '_meta' and v.get('orphan')]
    if orphans:
        for t in orphans:
            print(f'  [RED] {t}  -> DROP 或补脚本')
            n_red += 1
    else:
        print('  [OK] 无')

    # 2. 死脚本: 脚本有@meta, DB无对应表
    print('\n[死脚本] (有@meta, DB无对应表):')
    import duckdb
    con = duckdb.connect(str(BASE_DIR / 'db' / 'profit_radar.duckdb'), read_only=True)
    db_tables = set(con.execute("SHOW TABLES").fetchdf()['name'].tolist())
    con.close()

    for name, meta in scripts_meta.items():
        if name not in db_tables:
            print(f'  [YEL] {name}  -> 跑一次入库或归档')
            n_yel += 1
    if n_yel == 0:
        print('  [OK] 无')

    # 3. tables.json 失同步
    print('\n[三方失同步] (tables.json vs 脚本@meta):')
    json_keys = set(tables_json.keys())
    meta_keys = set(scripts_meta.keys())

    # 多表产物/配套维度表: 在DB但无独立@meta, 属正常, 用 data_dict 的标记豁免
    exempt = set()
    for k, v in data_dict.items():
        if k == '_meta': continue
        if v.get('multi_table') or v.get('is_dim') or v.get('is_view') or v.get('is_test'):
            exempt.add(k)

    only_in_json = json_keys - meta_keys
    only_in_meta = meta_keys - json_keys

    if only_in_json:
        for k in only_in_json:
            if k == '_meta': continue
            if k in exempt:
                continue  # 多表产物/维度表/视图, 正常
            print(f'  [BLU] tables.json有但@meta无: {k}')
            n_blu += 1
    if only_in_meta:
        for k in only_in_meta:
            print(f'  [BLU] @meta有但tables.json无: {k}')
            n_blu += 1
    if n_blu == 0:
        print('  [OK] 无')

    # 4. 字段中文 TODO 警告
    issues = check_integrity(data_dict)
    todo_count = sum(1 for i in issues if i.startswith('[YEL]'))
    if todo_count:
        print(f'\n[字段中文待补] {todo_count} 个表存在 TODO:')
        for i in issues[:10]:
            if i.startswith('[YEL]'):
                print(f'  {i}')
        if todo_count > 10:
            print(f'  ... 还有 {todo_count-10} 个')

    # 汇总
    print('\n' + '=' * 60)
    total = n_red + n_yel + n_blu
    if total == 0 and todo_count == 0:
        print('[OK] 一致性检查通过')
    else:
        print(f'[汇总] RED={n_red}  YEL={n_yel}  BLU={n_blu}  TODO={todo_count}')
    print('=' * 60)

    return 0 if total == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
