#!/usr/bin/env python3
"""
add_meta.py — 批量给脚本添加 @meta 头部

用法：python add_meta.py [--dry-run]
"""
import re
import json
from pathlib import Path

BASE_DIR = Path(r'K:\DB数据库_v2')
TABLES_JSON = BASE_DIR / 'config' / 'tables.json'

def load_tables():
    with open(TABLES_JSON, encoding='utf-8') as f:
        return json.load(f)

def extract_table_name(filename):
    """从文件名提取表名，如 082_stock_kline_15m.py -> stock_kline_15m"""
    name = filename.stem  # 082_stock_kline_15m
    # 去掉前导数字
    m = re.match(r'^(\d+)_(\w+)$', name)
    if m:
        return m.group(2)
    return name

def extract_sort(filename):
    """从文件名提取 sort 编号，如 082_stock_kline_15m.py -> 82"""
    name = filename.stem
    m = re.match(r'^(\d+)_', name)
    if m:
        return int(m.group(1))
    return 999

def has_meta(content):
    """检查是否已有 @meta"""
    return bool(re.search(r'# @meta', content))

def add_meta(content, table_name, meta):
    """在 docstring 后添加 @meta 头部"""
    sort = extract_sort(Path(meta.get('_file', '')))
    cn = meta.get('cn', table_name)
    dir_ = meta.get('dir', '1_入库')
    schedule = meta.get('schedule', 'daily')
    mode = meta.get('mode', 'increment')
    source = meta.get('source', '-')

    meta_lines = f"""---
# @meta table={table_name} cn={cn} dir={dir_} sort={sort:03d}
# @meta schedule={schedule} mode={mode} source={source}"""

    # 在 docstring 结束后添加
    # docstring 格式："""...---""" 或 """..."""
    # 找到第一个 """ 结束位置
    match = re.search(r'^(\s*""".*?""")', content, re.DOTALL | re.MULTILINE)
    if match:
        end_pos = match.end()
        return content[:end_pos] + '\n' + meta_lines + '\n' + content[end_pos:]

    # 兜底：插在 shebang 后
    lines = content.split('\n')
    insert_pos = 1
    for i, line in enumerate(lines):
        if line.startswith('# @meta'):
            insert_pos = i
            break
        if line.startswith('"""'):
            insert_pos = i + 1
            break
        if not line.strip():
            insert_pos = i + 1

    return '\n'.join(lines[:insert_pos]) + meta_lines + '\n' + '\n'.join(lines[insert_pos:])

def process_file(script_path, tables):
    table_name = extract_table_name(script_path)
    meta = tables.get(table_name, {})
    meta['_file'] = str(script_path)

    content = script_path.read_text(encoding='utf-8')

    if has_meta(content):
        print(f"  SKIP {script_path.name} (已有 @meta)")
        return 'skip'

    new_content = add_meta(content, table_name, meta)
    script_path.write_text(new_content, encoding='utf-8')
    print(f"  OK {script_path.name}")
    return 'ok'

def main():
    import sys
    dry_run = '--dry-run' in sys.argv

    tables = load_tables()

    # 处理 1_入库
    ingestion_dir = BASE_DIR / '1_入库'
    print(f"\n1_入库/ ({len(list(ingestion_dir.glob('*.py')))} 脚本)")
    for p in sorted(ingestion_dir.glob('*.py')):
        result = process_file(p, tables)
        if dry_run and result == 'ok':
            # dry-run 模式下恢复
            pass

    # 处理 2_计算
    compute_dir = BASE_DIR / '2_计算'
    print(f"\n2_计算/ ({len(list(compute_dir.glob('*.py')))} 脚本)")
    for p in sorted(compute_dir.glob('*.py')):
        result = process_file(p, tables)

    print("\n完成")

if __name__ == '__main__':
    main()