#!/usr/bin/env python3
"""DB数据库_v2 Lint Engine — 12 条规则检查

Usage:
    python config/lint_engine.py              # 运行所有检查，Rich 表格输出
    python config/lint_engine.py --json       # JSON 输出
    python config/lint_engine.py --base-dir /path/to/project

也可作为库导入:
    from config.lint_engine import run_lint, LintResult
"""

import json
import re
import sys
import argparse
from collections import defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

# base_dir 默认为项目根目录（lint_engine.py 在 config/ 下）
BASE_DIR: Path = Path(__file__).parent.parent.resolve()
SCRIPT_DIRS = ["1_入库", "2_计算"]


# ========================================================================
# Data Classes
# ========================================================================

@dataclass
class LintResult:
    rule_id: str       # e.g. "R001"
    rule_name: str     # e.g. "@meta 缺失"
    severity: str      # "RED" | "YELLOW" | "BLUE"
    table: str         # table name or script name
    message: str       # human-readable description
    fix_hint: str      # suggested fix


# ========================================================================
# 规则元信息
# ========================================================================

RULES = {
    "R001": {"name": "@meta 缺失",       "severity": "RED"},
    "R002": {"name": "MODE 矛盾",        "severity": "RED"},
    "R003": {"name": "调度缺失",          "severity": "YELLOW"},
    "R004": {"name": "中文列名",          "severity": "RED"},
    "R005": {"name": "sort 编号冲突",     "severity": "YELLOW"},
    "R006": {"name": "空表未标 once",     "severity": "YELLOW"},
    "R007": {"name": "无日期列",          "severity": "BLUE"},
    "R008": {"name": "增量无去重键",      "severity": "RED"},
    "R009": {"name": "孤儿表",            "severity": "RED"},
    "R010": {"name": "循环依赖",          "severity": "RED"},
    "R011": {"name": "无下游",            "severity": "BLUE"},
    "R012": {"name": "源重复",            "severity": "YELLOW"},
}


def _make(rule_id: str, table: str, message: str, fix_hint: str = "") -> LintResult:
    """创建 LintResult 的快捷方法"""
    rule = RULES[rule_id]
    return LintResult(
        rule_id=rule_id,
        rule_name=rule["name"],
        severity=rule["severity"],
        table=table,
        message=message,
        fix_hint=fix_hint,
    )


# ========================================================================
# @meta 解析
# ========================================================================

def parse_meta(script_path: Path) -> dict:
    """从脚本头部解析 @meta 元数据

    支持:
        # @meta table=xxx cn=xxx dir=xxx sort=010
        # @meta schedule=daily mode=increment source=二进制
        # @meta note: 补充说明
    """
    try:
        content = script_path.read_text(encoding="utf-8")
    except Exception:
        return {}

    meta = {}
    for line in content.split("\n"):
        m = re.match(r"#\s*@meta\s+(.*)", line)
        if m:
            remainder = m.group(1)
            # 解析 key=value 对（支持值中含等号，如 source=SQL派生(a=b)）
            # 先提取 note: 开头的纯文本
            if remainder.strip().startswith("note:"):
                meta["note"] = remainder.strip()[5:].strip()
                continue
            for kv in remainder.split():
                parts = kv.split("=", 1)
                if len(parts) == 2:
                    meta[parts[0].strip()] = parts[1].strip()
    return meta


def scan_scripts(base_dir: Path) -> dict:
    """扫描 1_入库/ 和 2_计算/ 下所有 .py 脚本

    Returns:
        {相对路径: {"path": Path, "meta": dict, "has_meta": bool}}
    """
    scripts = {}
    for dir_name in SCRIPT_DIRS:
        dir_path = base_dir / dir_name
        if not dir_path.exists():
            continue
        # 只扫描顶层 .py，不递归子目录（废弃/等）
        for script_path in sorted(dir_path.glob("*.py")):
            meta = parse_meta(script_path)
            rel = str(script_path.relative_to(base_dir))
            scripts[rel] = {
                "path": script_path,
                "meta": meta,
                "has_meta": bool(meta),
            }
    return scripts


# ========================================================================
# 数据加载
# ========================================================================

def load_tables_json(config_dir: Path) -> dict:
    """加载 tables.json，去除 _meta 键"""
    with open(config_dir / "tables.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if k != "_meta"}


def load_data_dictionary(config_dir: Path) -> dict:
    """加载 data_dictionary.json，去除 _meta 键"""
    with open(config_dir / "data_dictionary.json", "r", encoding="utf-8") as f:
        data = json.load(f)
    return {k: v for k, v in data.items() if k != "_meta"}


# ========================================================================
# R001: @meta 缺失
# ========================================================================

def check_meta_missing(scripts_dir: dict, tables_json: dict) -> list:
    """脚本头部缺少 @meta 注释"""
    results = []
    for rel_path, info in scripts_dir.items():
        if not info["has_meta"]:
            results.append(_make(
                "R001",
                rel_path,
                f"脚本 {rel_path} 缺少 @meta 注释",
                "在脚本头部添加: # @meta table=xxx cn=xxx dir=xxx sort=NNN schedule=xxx mode=xxx source=xxx",
            ))
    return results


# ========================================================================
# R002: MODE 矛盾
# ========================================================================

def check_mode_conflict(scripts_dir: dict, tables_json: dict) -> list:
    """@meta mode 与 tables.json 不一致"""
    results = []
    # 构建 table_name → script meta 映射
    table_to_meta = {}
    for _rel, info in scripts_dir.items():
        meta = info["meta"]
        t = meta.get("table")
        if t:
            table_to_meta[t] = meta

    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        smeta = table_to_meta.get(table_name)
        if not smeta:
            continue  # R009 会覆盖

        meta_mode = smeta.get("mode")
        json_mode = tinfo.get("mode")
        if meta_mode and json_mode and meta_mode != json_mode:
            results.append(_make(
                "R002",
                table_name,
                f"@meta mode={meta_mode} 与 tables.json mode={json_mode} 不一致",
                f"统一 mode 为 {json_mode}（或更新 tables.json）",
            ))
    return results


# ========================================================================
# R003: 调度缺失
# ========================================================================

def check_schedule_missing(tables_json: dict) -> list:
    """schedule=daily 但无 cron/timer 配置（dir 不指向具体脚本）"""
    results = []
    active_schedules = {"daily", "weekly", "monthly", "intraday"}
    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        schedule = tinfo.get("schedule", "")
        if schedule not in active_schedules:
            continue
        dir_val = tinfo.get("dir", "")
        # dir 应指向一个 .py 文件，才能被调度系统运行
        if not dir_val.rstrip().endswith(".py"):
            results.append(_make(
                "R003",
                table_name,
                f"schedule={schedule} 但 dir='{dir_val}' 不指向具体脚本，无法自动调度",
                "设置 dir 为具体脚本路径，如 'python 1_入库/xxx.py'",
            ))
    return results


# ========================================================================
# R004: 中文列名
# ========================================================================

def check_chinese_columns(data_dict: dict) -> list:
    """表中有中文列名，违反命名规范"""
    results = []
    chinese_re = re.compile(r"[\u4e00-\u9fff]")
    for table_name, tinfo in data_dict.items():
        columns = tinfo.get("columns", [])
        chinese_cols = [c["name"] for c in columns if chinese_re.search(c.get("name", ""))]
        if chinese_cols:
            preview = ", ".join(chinese_cols[:5])
            if len(chinese_cols) > 5:
                preview += f" ... (共{len(chinese_cols)}个)"
            results.append(_make(
                "R004",
                table_name,
                f"包含 {len(chinese_cols)} 个中文列名: {preview}",
                "将中文列名改为英文命名，如 涨跌幅→pct_chg, 换手率→turnover",
            ))
    return results


# ========================================================================
# R005: sort 编号冲突
# ========================================================================

def check_sort_collision(tables_json: dict) -> list:
    """同一 sort 编号被多个脚本占用"""
    results = []
    sort_map = defaultdict(list)
    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        sort_val = tinfo.get("sort")
        if sort_val is not None:
            sort_map[sort_val].append(table_name)

    for sort_val, names in sort_map.items():
        if len(names) > 1:
            results.append(_make(
                "R005",
                f"sort={sort_val}",
                f"sort={sort_val} 被 {len(names)} 个表共用: {', '.join(names)}",
                "为每个表分配不同的 sort 编号",
            ))
    return results


# ========================================================================
# R006: 空表未标 once
# ========================================================================

def check_empty_full_table(tables_json: dict) -> list:
    """mode=full 且 rows=0 但 schedule≠once"""
    results = []
    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        if tinfo.get("mode") != "full":
            continue
        rows = tinfo.get("rows")
        # rows 字段在 tables.json 中为可选；仅当明确为 0 时报告
        if rows == 0 and tinfo.get("schedule") != "once":
            results.append(_make(
                "R006",
                table_name,
                f"mode=full, rows=0 但 schedule={tinfo.get('schedule')}，建议标为 once",
                "将 schedule 改为 'once' 或确认数据已入库后更新 rows",
            ))
    return results


# ========================================================================
# R007: 无日期列
# ========================================================================

def check_no_date_column(data_dict: dict) -> list:
    """表没有日期列，无法判断数据新鲜度"""
    results = []
    date_name_re = re.compile(
        r"(date|time|_at|_dt|timestamp|datetime)", re.IGNORECASE
    )
    date_type_re = re.compile(
        r"(DATE|TIMESTAMP|DATETIME)", re.IGNORECASE
    )
    for table_name, tinfo in data_dict.items():
        columns = tinfo.get("columns", [])
        if not columns:
            continue
        has_date = any(
            date_name_re.search(c.get("name", "")) or date_type_re.search(c.get("type", ""))
            for c in columns
        )
        if not has_date:
            results.append(_make(
                "R007",
                table_name,
                "表无日期列 (date/time/timestamp/_at)，无法判断数据新鲜度",
                "添加日期列如 date 或 updated_at",
            ))
    return results


# ========================================================================
# R008: 增量无去重键
# ========================================================================

def check_increment_no_dedup(tables_json: dict) -> list:
    """mode=increment 但无 dedupKey 定义"""
    results = []
    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        if tinfo.get("mode") != "increment":
            continue
        # 检查 note 字段是否提及去重键
        note = tinfo.get("note", "")
        has_dedup = (
            "去重键" in note
            or "dedupKey" in note
            or "去重" in note
            or bool(tinfo.get("dedupKey"))
        )
        if not has_dedup:
            results.append(_make(
                "R008",
                table_name,
                "mode=increment 但未定义去重键 (dedupKey)",
                "在 tables.json 中添加 note='去重键: col1+col2' 或 dedupKey 字段",
            ))
    return results


# ========================================================================
# R009: 孤儿表
# ========================================================================

def check_orphan_table(tables_json: dict, scripts_dir: dict) -> list:
    """表存在于 tables.json 但无对应脚本"""
    results = []

    # 1) 从 @meta 收集已声明的表名
    tables_in_meta = set()
    for _rel, info in scripts_dir.items():
        t = info["meta"].get("table")
        if t:
            tables_in_meta.add(t)

    # 2) 从 dir 字段解析可执行脚本路径
    def _dir_has_script(dir_val, base):
        """判断 dir 字段是否指向一个存在的 .py 脚本"""
        clean = dir_val.replace("python ", "").strip()
        if clean.endswith(".py"):
            return (base / clean).exists()
        # 形如 "2_计算/70" → 尝试匹配 2_计算/70_*.py
        parent = base / clean
        if parent.is_dir():
            # dir 仅指向目录，不算具体脚本
            return False
        if parent.parent.is_dir():
            prefix = parent.name
            for f in parent.parent.glob(f"{prefix}_*.py"):
                return True
        return False

    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        if table_name in tables_in_meta:
            continue
        dir_val = tinfo.get("dir", "")
        if _dir_has_script(dir_val, BASE_DIR):
            continue
        results.append(_make(
            "R009",
            table_name,
            f"表 {table_name} 在 tables.json 中但无对应脚本",
            "创建对应的入库/计算脚本，或在 dir 字段指定已有脚本路径",
        ))
    return results


# ========================================================================
# R010: 循环依赖
# ========================================================================

def check_circular_deps(tables_json: dict) -> list:
    """依赖图存在环（DFS 检测）"""
    results = []

    # 构建邻接表
    graph = {}
    for table_name, tinfo in tables_json.items():
        deps = tinfo.get("depends_on", [])
        if isinstance(deps, str):
            deps = [deps]
        graph[table_name] = [d for d in deps if d in tables_json]

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    cycles = []

    def dfs(node, path):
        color[node] = GRAY
        path.append(node)
        for dep in graph.get(node, []):
            if color.get(dep) == GRAY:
                idx = path.index(dep)
                cycles.append(path[idx:] + [dep])
            elif color.get(dep) == WHITE:
                dfs(dep, path)
        path.pop()
        color[node] = BLACK

    for node in graph:
        if color[node] == WHITE:
            dfs(node, [])

    seen_keys = set()
    for cycle in cycles:
        # 去重：同一条环只报一次（取排序后元组做 key）
        key = tuple(sorted(cycle[:-1]))
        if key in seen_keys:
            continue
        seen_keys.add(key)
        cycle_str = " → ".join(cycle)
        results.append(_make(
            "R010",
            cycle[0],
            f"循环依赖: {cycle_str}",
            "重构依赖关系，消除循环",
        ))
    return results


# ========================================================================
# R011: 无下游
# ========================================================================

def check_no_downstream(tables_json: dict) -> list:
    """表没有任何下游消费者"""
    results = []
    # 收集所有被依赖的表
    upstream_tables = set()
    for tinfo in tables_json.values():
        deps = tinfo.get("depends_on", [])
        if isinstance(deps, str):
            deps = [deps]
        for d in deps:
            upstream_tables.add(d)

    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        if table_name not in upstream_tables:
            # once 表通常是维度表，无下游可接受
            if tinfo.get("schedule") == "once":
                continue
            results.append(_make(
                "R011",
                table_name,
                f"表 {table_name} 没有任何下游消费者",
                "确认是否仍需保留，或添加下游依赖表",
            ))
    return results


# ========================================================================
# R012: 源重复
# ========================================================================

def check_duplicate_source(tables_json: dict) -> list:
    """多个表声明了相同的数据源"""
    results = []
    source_map = defaultdict(list)
    for table_name, tinfo in tables_json.items():
        if tinfo.get("is_view"):
            continue
        source = tinfo.get("source", "")
        if source:
            source_map[source].append(table_name)

    for source, names in source_map.items():
        if len(names) > 1:
            results.append(_make(
                "R012",
                f"source={source}",
                f"数据源 '{source}' 被 {len(names)} 个表共用: {', '.join(names)}",
                "确认是否为同一数据源的不同处理，或拆分 source 描述以区分",
            ))
    return results


# ========================================================================
# 主入口
# ========================================================================

def run_lint(base_dir=None):
    """运行全部 12 条 lint 检查，返回违规列表

    Args:
        base_dir: 项目根目录，默认为 lint_engine.py 所在的上级目录

    Returns:
        所有 LintResult 的列表，按 (severity, rule_id, table) 排序
    """
    if base_dir is None:
        base_dir = BASE_DIR

    config_dir = base_dir / "config"
    tables = load_tables_json(config_dir)
    data_dict = load_data_dictionary(config_dir)
    scripts = scan_scripts(base_dir)

    results = []
    results.extend(check_meta_missing(scripts, tables))
    results.extend(check_mode_conflict(scripts, tables))
    results.extend(check_schedule_missing(tables))
    results.extend(check_chinese_columns(data_dict))
    results.extend(check_sort_collision(tables))
    results.extend(check_empty_full_table(tables))
    results.extend(check_no_date_column(data_dict))
    results.extend(check_increment_no_dedup(tables))
    results.extend(check_orphan_table(tables, scripts))
    results.extend(check_circular_deps(tables))
    results.extend(check_no_downstream(tables))
    results.extend(check_duplicate_source(tables))

    # 按严重级别排序: RED → YELLOW → BLUE，同级别按 rule_id
    severity_order = {"RED": 0, "YELLOW": 1, "BLUE": 2}
    results.sort(key=lambda r: (severity_order.get(r.severity, 9), r.rule_id, r.table))

    return results


# ========================================================================
# CLI 输出
# ========================================================================

def print_results(results, json_output=False):
    """打印 lint 结果（Rich 表格 或 JSON）"""
    if json_output:
        data = [asdict(r) for r in results]
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return

    from rich.console import Console
    from rich.table import Table as RichTable

    console = Console()

    # 统计
    red_count = sum(1 for r in results if r.severity == "RED")
    yellow_count = sum(1 for r in results if r.severity == "YELLOW")
    blue_count = sum(1 for r in results if r.severity == "BLUE")

    console.print()
    console.print("[bold]:mag: DB数据库_v2 Lint Report[/bold]")
    console.print(
        f"   总计 [bold]{len(results)}[/bold] 条违规: "
        f"[red]{red_count} RED[/red] | "
        f"[yellow]{yellow_count} YELLOW[/yellow] | "
        f"[blue]{blue_count} BLUE[/blue]"
    )
    console.print()

    if not results:
        console.print("[green]:white_check_mark: 所有检查通过！[/green]")
        return

    # 按规则分组统计
    rule_counts = defaultdict(int)
    for r in results:
        rule_counts[r.rule_id] += 1

    # 摘要
    summary = RichTable(show_header=True, header_style="bold", title="规则摘要")
    summary.add_column("Rule", width=5)
    summary.add_column("Name", width=16)
    summary.add_column("Severity", width=8)
    summary.add_column("Count", width=6, justify="right")
    for rid in sorted(RULES):
        cnt = rule_counts.get(rid, 0)
        sev = RULES[rid]["severity"]
        sev_str = {"RED": "[red]RED[/red]", "YELLOW": "[yellow]YELLOW[/yellow]", "BLUE": "[blue]BLUE[/blue]"}.get(sev, sev)
        summary.add_row(rid, RULES[rid]["name"], sev_str, str(cnt) if cnt else "[dim]0[/dim]")
    console.print(summary)
    console.print()

    # 详情表
    table = RichTable(show_header=True, header_style="bold", title="违规详情", show_lines=False)
    table.add_column("Rule", style="dim", width=5)
    table.add_column("Severity", width=8)
    table.add_column("Table / Target", style="cyan", max_width=35)
    table.add_column("Message", max_width=65)
    table.add_column("Fix Hint", style="dim", max_width=45)

    for r in results:
        sev_str = {
            "RED": "[red]RED[/red]",
            "YELLOW": "[yellow]YELLOW[/yellow]",
            "BLUE": "[blue]BLUE[/blue]",
        }.get(r.severity, r.severity)
        table.add_row(r.rule_id, sev_str, r.table, r.message, r.fix_hint)

    console.print(table)
    console.print()


# ========================================================================
# __main__
# ========================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="DB数据库_v2 Lint Engine — 12 条规则检查")
    parser.add_argument("--json", action="store_true", help="输出 JSON 格式")
    parser.add_argument("--base-dir", type=Path, default=None, help="项目根目录 (默认自动检测)")
    args = parser.parse_args()

    base_dir = args.base_dir or BASE_DIR
    results = run_lint(base_dir)
    print_results(results, json_output=args.json)

    # 非 0 退出码表示有 RED 级别违规
    sys.exit(1 if any(r.severity == "RED" for r in results) else 0)
