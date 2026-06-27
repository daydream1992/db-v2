#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
# @meta table=skeleton cn=骨架生成器 dir=4_工具 sort=001
# @meta schedule=manual mode=report source=项目文件
=============================================================================
 骨架文件自动生成器  gen_skeleton.py
=============================================================================

【作用】
扫描 K:\DB数据库_v2\ 项目，自动重新生成 dbv2-skeleton.md 中的
「📊 1_入库 脚本清单」「📊 2_计算 脚本清单」两张表格，以及顶部统计。

【为什么需要】
骨架文件是给 AI 接续工作用的项目索引，但脚本会不断增删，手动维护易过期。
本脚本通过解析 .py 文件里的顶部常量（TABLE / MODE / SCHEDULE）和数据源
注释，自动同步清单部分，让骨架始终反映项目真实状态。

【更新范围】
✅ 会自动更新：
   - 1_入库/ 2_计算/ 目录的脚本数量
   - 每个脚本的 TABLE / MODE / SCHEDULE / 行数 / 数据源
   - 架构速览的目录文件数

❌ 不会自动更新（仍需手工维护）：
   - 「核心文件骨架」一节（run.py 函数签名/行号、模板说明等）
   - CLI 子命令表（run.py 改了 argparse 自己同步）
   - 文件顶部的使用规则和警告

【使用方法】
   cd K:\DB数据库_v2
   python tools/gen_skeleton.py              # 重新生成清单部分
   python tools/gen_skeleton.py --dry-run    # 只打印，不写文件
   python tools/gen_skeleton.py --diff       # 显示与现有文件的差异

【触发时机建议】
   - 新增/删除 1_入库 或 2_计算 脚本后
   - 改了某脚本的 TABLE/MODE/SCHEDULE 后
   - 可挂到 git pre-commit hook 全自动跑

【数据源识别规则】
   在脚本顶部的 docstring 或注释里写明数据源，本脚本按以下优先级提取：
   1. 显式 SOURCE = '...' 常量
   2. 文件头 docstring 中的「数据源：xxx」
   3. SQL 派生：从 fetch_data(con) 函数体里 grep 'FROM xxx' 推断
   4. 兜底标 '-'

=============================================================================
"""
import re
import sys
import io
from pathlib import Path
from typing import Optional

# Windows GBK 控制台无法打印 emoji，强制 stdout 用 UTF-8
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

ROOT = Path(r'K:\DB数据库_v2')
SKELETON = ROOT / 'dbv2-skeleton.md'
INGEST_DIR = ROOT / '1_入库'
COMPUTE_DIR = ROOT / '2_计算'

# 表格列宽和顺序
COLUMNS = ['编号', '脚本名', 'TABLE', '数据源', 'MODE', '行数']


# ============= 解析单个 .py 文件 =============

def parse_script(py_path: Path) -> dict:
    """从 .py 提取 TABLE / MODE / SCHEDULE / 行数 / 数据源"""
    text = py_path.read_text(encoding='utf-8', errors='ignore')
    lines = text.splitlines()

    info = {
        'filename': py_path.stem,           # 100_lhb_daily_summary
        'sort_id': _extract_sort_id(py_path.stem),
        'name': _extract_name(py_path.stem),
        'TABLE': _grep_const(text, 'TABLE'),
        'MODE': _grep_const(text, 'MODE'),
        'SCHEDULE': _grep_const(text, 'SCHEDULE'),
        'SOURCE': _extract_source(text),
        'line_count': len(lines),
    }
    return info


def _extract_sort_id(stem: str) -> Optional[int]:
    """100_lhb_xxx → 100"""
    m = re.match(r'(\d+)_', stem)
    return int(m.group(1)) if m else None


def _extract_name(stem: str) -> str:
    """100_lhb_xxx → lhb_xxx"""
    return re.sub(r'^\d+_', '', stem)


def _grep_const(text: str, key: str) -> str:
    """提取 KEY = 'value' 或 KEY = "value" """
    m = re.search(rf"^\s*{key}\s*=\s*['\"]([^'\"]+)['\"]", text, re.MULTILINE)
    return m.group(1) if m else ''


def _extract_source(text: str) -> str:
    """按优先级提取数据源"""
    # 1. 显式 SOURCE 常量
    src = _grep_const(text, 'SOURCE')
    if src:
        return src

    # 2. docstring 或注释里的「数据源：xxx」
    m = re.search(r'数据源[：:]\s*([^\n]+)', text)
    if m:
        return m.group(1).strip()

    # 3. SQL 派生：从 fetch_data(con) 函数体 grep FROM
    if 'def fetch_data(con' in text:
        tables = re.findall(r'FROM\s+(\w+)', text, re.IGNORECASE)
        # 排除 DuckDB 系统表和子查询别名
        tables = [t for t in tables if not t.startswith(('information_', 'duckdb_'))]
        if tables:
            uniq = list(dict.fromkeys(tables))   # 保序去重
            return 'SQL:' + ','.join(uniq[:3])    # 最多列 3 个
        return 'SQL'

    # 4. 兜底
    return '-'


# ============= 生成 markdown 表格 =============

def build_table(scripts: list[dict]) -> str:
    """渲染脚本清单为 markdown 表格"""
    scripts = sorted(scripts, key=lambda s: (s['sort_id'] or 0))

    header = '| ' + ' | '.join(COLUMNS) + ' |\n'
    sep = '|' + '|'.join('------' for _ in COLUMNS) + '|\n'
    rows = []
    for s in scripts:
        row = [
            str(s['sort_id'] or ''),
            s['name'],
            s['TABLE'] or '?',
            s['SOURCE'] or '-',
            s['MODE'] or '?',
            str(s['line_count']),
        ]
        rows.append('| ' + ' | '.join(row) + ' |')
    return header + sep + '\n'.join(rows) + '\n'


# ============= 主流程：替换骨架文件中的清单 =============

def gen_new_skeleton(old_text: str) -> str:
    """读旧骨架，替换两张清单表格，返回新文本"""
    ingest_scripts = [parse_script(p) for p in INGEST_DIR.glob('*.py')]
    compute_scripts = [parse_script(p) for p in COMPUTE_DIR.glob('*.py')]

    ingest_table = build_table(ingest_scripts)
    compute_table = build_table(compute_scripts)

    # 替换「📊 1_入库 脚本清单」段落
    new_text = re.sub(
        r'(## 📊 1_入库 脚本清单（)\d+(个）\n\n)\| 编号.*?(?=\n## )',
        lambda m: f"{m.group(1)}{len(ingest_scripts)}{m.group(2)}{ingest_table}\n",
        old_text,
        flags=re.DOTALL,
    )

    # 替换「📊 2_计算 脚本清单」段落
    new_text = re.sub(
        r'(## 📊 2_计算 脚本清单（)\d+(个）\n\n)\| 编号.*?(?=\n---)',
        lambda m: f"{m.group(1)}{len(compute_scripts)}{m.group(2)}{compute_table}\n",
        new_text,
        flags=re.DOTALL,
    )

    # 更新「架构速览」里的文件数
    new_text = re.sub(
        r'\| `1_入库/` \| \d+ 个 \.py',
        f'| `1_入库/` | {len(ingest_scripts)} 个 .py',
        new_text,
    )
    new_text = re.sub(
        r'\| `2_计算/` \| \d+ 个 \.py',
        f'| `2_计算/` | {len(compute_scripts)} 个 .py',
        new_text,
    )

    return new_text


def main():
    args = set(sys.argv[1:])

    if not SKELETON.exists():
        print(f'❌ 骨架文件不存在：{SKELETON}')
        sys.exit(1)

    old_text = SKELETON.read_text(encoding='utf-8')
    new_text = gen_new_skeleton(old_text)

    if '--dry-run' in args:
        print(new_text)
        return

    if '--diff' in args:
        import difflib
        diff = difflib.unified_diff(
            old_text.splitlines(keepends=True),
            new_text.splitlines(keepends=True),
            fromfile='dbv2-skeleton.md (旧)',
            tofile='dbv2-skeleton.md (新)',
        )
        sys.stdout.writelines(diff)
        return

    if old_text == new_text:
        print('✅ 骨架已是最新，无需更新')
        return

    SKELETON.write_text(new_text, encoding='utf-8')
    ingest_n = len(list(INGEST_DIR.glob('*.py')))
    compute_n = len(list(COMPUTE_DIR.glob('*.py')))
    print(f'✅ 已更新 {SKELETON}')
    print(f'   1_入库：{ingest_n} 个脚本')
    print(f'   2_计算：{compute_n} 个脚本')


if __name__ == '__main__':
    main()
