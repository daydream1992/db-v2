#!/usr/bin/env python3
"""
validate_tables.py — 表配置一致性校验

对比四方一致性，报告差异：
  1. DB 实际表
  2. 脚本文件 (1_入库 / 2_计算)
  3. tables.json 配置
  4. 脚本头部 @meta

用法：python validate_tables.py
退出码：0=全部一致, 1=发现问题
"""
import re
import sys
import json
import duckdb
from pathlib import Path
from collections import defaultdict

# Windows 控制台 UTF-8 输出
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BASE_DIR = Path(r'K:\DB数据库_v2')
TABLES_JSON = BASE_DIR / 'config' / 'tables.json'
DB_PATH = BASE_DIR / 'db' / 'profit_radar.duckdb'
DIR_ORDER = ['1_入库', '2_计算']

# 校验的字段（@meta 与 tables.json 必须一致）
CHECK_FIELDS = ['cn', 'schedule', 'mode', 'source', 'dir']


def load_tables_json():
    with open(TABLES_JSON, encoding='utf-8') as f:
        return json.load(f)


def get_db_tables():
    conn = duckdb.connect(str(DB_PATH))
    try:
        rows = conn.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema = 'main'"
        ).fetchall()
        return {r[0] for r in rows}
    finally:
        conn.close()


def extract_table_name(filename):
    name = Path(filename).stem
    m = re.match(r'^(\d+)_(\w+)$', name)
    return m.group(2) if m else name


def parse_meta(content):
    meta = {}
    for line in content.split('\n'):
        m = re.match(r'#\s*@meta\s+(.*)', line)
        if m:
            for kv in m.group(1).split():
                parts = kv.split('=', 1)
                if len(parts) == 2:
                    meta[parts[0].strip()] = parts[1].strip()
    return meta


def scan_scripts():
    """扫描脚本，返回 {table_name: {path, meta, dir}}"""
    result = {}
    for d in DIR_ORDER:
        dir_path = BASE_DIR / d
        if not dir_path.exists():
            continue
        for script_path in sorted(dir_path.glob('*.py')):
            content = script_path.read_text(encoding='utf-8')
            meta = parse_meta(content)
            table_name = meta.get('table') or extract_table_name(script_path.name)
            result[table_name] = {'path': script_path, 'meta': meta, 'dir': d}
    return result


def run():
    tables_json = load_tables_json()
    db_tables = get_db_tables()
    scripts = scan_scripts()

    json_tables = {k: v for k, v in tables_json.items() if not k.startswith('_')}
    json_keys = set(json_tables)
    script_keys = set(scripts)

    issues = []

    # 1. 孤儿配置：tables.json 有，脚本无（generator 指定的工具脚本除外）
    for t in sorted(json_keys - script_keys):
        gen = json_tables[t].get('generator')
        if gen and (BASE_DIR / gen).exists():
            continue
        issues.append(('孤儿配置', t, 'tables.json 有配置但无对应脚本'))

    # 2. 漏登记：脚本有，tables.json 无
    for t in sorted(script_keys - json_keys):
        issues.append(('漏登记', t, '脚本存在但 tables.json 无配置'))

    # 3. 未登记 DB 表：DB 有，tables.json 无（且无脚本，避免与漏登记重复）
    for t in sorted(db_tables - json_keys - script_keys):
        issues.append(('未登记DB表', t, 'DB 表存在但 tables.json 无配置'))

    # 4. 无 DB 表：tables.json 有，DB 无
    for t in sorted(json_keys - db_tables):
        issues.append(('无DB表', t, 'tables.json 有配置但 DB 表不存在'))

    # 5. @meta 与 tables.json 字段不一致
    for t in sorted(json_keys & script_keys):
        meta = scripts[t]['meta']
        cfg = json_tables[t]
        for field in CHECK_FIELDS:
            mv = meta.get(field)
            cv = cfg.get(field)
            if mv and cv and str(mv) != str(cv):
                issues.append(('字段不一致', t, f'{field}: @meta=[{mv}] vs json=[{cv}]'))
        ms, cs = meta.get('sort'), cfg.get('sort')
        if ms and cs and str(int(ms)) != str(int(cs)):
            issues.append(('字段不一致', t, f'sort: @meta=[{ms}] vs json=[{cs}]'))

    # ========== 输出 ==========
    print('=' * 60)
    print('表配置一致性校验报告')
    print('=' * 60)
    print(f'tables.json 配置 : {len(json_keys)} 表')
    print(f'脚本文件         : {len(script_keys)} 个')
    print(f'DB 实际表        : {len(db_tables)} 张')
    print('-' * 60)

    if not issues:
        print('结果: OK 全部一致')
        return True

    by_cat = defaultdict(list)
    for cat, table, msg in issues:
        by_cat[cat].append((table, msg))

    print(f'发现问题: {len(issues)} 个')
    for cat in ['孤儿配置', '漏登记', '未登记DB表', '无DB表', '字段不一致']:
        if cat in by_cat:
            print(f'\n[{cat}] ({len(by_cat[cat])})')
            for table, msg in by_cat[cat]:
                print(f'  {table:<30} {msg}')

    print('\n' + '=' * 60)
    return False


if __name__ == '__main__':
    sys.exit(0 if run() else 1)
