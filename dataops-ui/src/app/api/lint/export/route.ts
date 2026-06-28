import { NextResponse } from 'next/server'
import { LINT_RULES } from '@/lib/dataops/mock-data'
import { APP_CONFIG } from '@/lib/dataops/config'

/**
 * GET /api/lint/export
 * Returns a Python linter script implementing all 12 lint rules as a downloadable file.
 */
export async function GET() {
  const script = generatePythonLinter()

  return new NextResponse(script, {
    status: 200,
    headers: {
      'Content-Type': 'text/x-python; charset=utf-8',
      'Content-Disposition': 'attachment; filename="lint_engine.py"',
    },
  })
}

function generatePythonLinter(): string {
  const rulesJson = JSON.stringify(LINT_RULES, null, 4)
  const repoUrl = APP_CONFIG.gitHubRepo
  const branch = APP_CONFIG.gitHubBranch

  return `#!/usr/bin/env python3
"""
lint_engine.py — DataOps Lint Engine
=====================================
自动校验 db-v2 数据库元数据合规性，实现 12 条 lint 规则。

用法:
    python lint_engine.py                  # 运行全部规则，输出 JSON 报告
    python lint_engine.py --format md      # 输出 Markdown 报告
    python lint_engine.py --rules R001,R004  # 只运行指定规则
    python lint_engine.py --config ./config  # 指定配置目录

数据源:
    config/tables.json          — 表级元数据
    config/data_dictionary.json — 列定义（字段名、类型、中文含义）

规则级别:
    RED    — 阻断，必须修复才能合并
    YELLOW — 警告，建议修复
    BLUE   — 建议，可选优化

生成时间: ${new Date().toISOString().slice(0, 19)}
来源仓库: ${repoUrl} (${branch})
"""

import json
import os
import re
import sys
import argparse
from pathlib import Path
from datetime import datetime
from typing import Any


# ─── 规则定义（源自前端 LINT_RULES）──────────────────────────────
RULES_META = ${rulesJson}


# ─── 数据加载 ─────────────────────────────────────────────────
def load_json(path: str) -> Any:
    """加载 JSON 文件，失败时抛出异常。"""
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_config(config_dir: str) -> dict:
    """
    从配置目录加载 tables.json 和 data_dictionary.json。

    Args:
        config_dir: 配置目录路径，默认为 ./config

    Returns:
        dict: {"tables": [...], "dictionary": {...}}
    """
    tables_path = os.path.join(config_dir, 'tables.json')
    dict_path = os.path.join(config_dir, 'data_dictionary.json')

    tables = load_json(tables_path) if os.path.exists(tables_path) else {}
    dictionary = load_json(dict_path) if os.path.exists(dict_path) else {}

    return {"tables": tables, "dictionary": dictionary}


# ─── Lint 规则实现 ───────────────────────────────────────────

def check_r001(tables: dict, dictionary: dict) -> list[dict]:
    """
    R001: 表名格式
    表名必须纯小写下划线，禁数字开头。

    合规: stock_daily_kline, capital_info
    违规: StockDaily, 1st_table, my-table
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        name = t.get('table', '')
        if not re.match(r'^[a-z][a-z0-9_]*$', name):
            violations.append({
                "table": name,
                "detail": f"表名 '{name}' 不符合小写下划线格式或数字开头",
                "fix": "改为纯小写下划线命名，如 stock_daily_kline",
            })
    return violations


def check_r002(tables: dict, dictionary: dict) -> list[dict]:
    """
    R002: @meta与代码常量一致
    YAML 的 mode/schedule 必须与脚本常量 MODE/SCHEDULE 一致。

    检查 tables.json 中的 mode 和 schedule 字段是否与脚本实际常量匹配。
    注：纯配置检查无法完全验证脚本常量，此处检查元数据自洽性。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        mode = t.get('mode', '')
        schedule = t.get('schedule', '')
        # 检查 mode 是否为合法值
        if mode and mode not in ('increment', 'full'):
            violations.append({
                "table": t.get('table', ''),
                "detail": f"mode='{mode}' 不是合法值 (increment/full)",
                "fix": "统一为 increment 或 full",
            })
        # 检查 schedule 是否为合法值
        if schedule and schedule not in ('daily', 'weekly', 'monthly', 'once'):
            violations.append({
                "table": t.get('table', ''),
                "detail": f"schedule='{schedule}' 不是合法值 (daily/weekly/monthly/once)",
                "fix": "统一为 daily/weekly/monthly/once",
            })
    return violations


def check_r003(tables: dict, dictionary: dict) -> list[dict]:
    """
    R003: 契约签名规范
    入库脚本必须实现 BaseIngest 子类或标准 fetch_data/save_data 签名。

    检查 1_入库 目录下的脚本是否遵循标准入口签名。
    注：纯元数据检查仅能验证配置完整性，脚本签名需 AST 分析。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        if t.get('dir') == '1_入库' or t.get('source_detail', '').startswith('tdx_reader'):
            source_detail = t.get('source_detail', '')
            # 检查是否有 source_detail 描述
            if not source_detail:
                violations.append({
                    "table": t.get('table', ''),
                    "detail": "入库脚本缺少 source_detail 描述，无法确认签名规范",
                    "fix": "在 tables.json 中补充 source_detail 字段",
                })
    return violations


def check_r004(tables: dict, dictionary: dict) -> list[dict]:
    """
    R004: 列名禁中文禁空格
    列名必须全小写下划线，中文含义放 FIELD_MAP / dim 表。

    合规: code, date, close_price
    违规: 涨跌幅, 总市值, stock code (含空格)
    """
    violations = []
    for table_name, table_dict in dictionary.items():
        if not isinstance(table_dict, dict):
            continue
        columns = table_dict.get('columns', [])
        chinese_cols = []
        for col in columns:
            col_name = col.get('name', '') if isinstance(col, dict) else ''
            # 检查是否含中文字符
            if re.search(r'[\\u4e00-\\u9fff]', col_name):
                chinese_cols.append(col_name)
            # 检查是否含空格
            elif ' ' in col_name:
                violations.append({
                    "table": table_name,
                    "detail": f"列 '{col_name}' 含空格",
                    "fix": f"将空格替换为下划线，中文含义放 FIELD_MAP",
                })
        if chinese_cols:
            violations.append({
                "table": table_name,
                "detail": f"列 {','.join(chinese_cols)} 含中文",
                "fix": f"rename 为英文列名，中文含义放 FIELD_MAP 或 dim 表",
            })
    return violations


def check_r005(tables: dict, dictionary: dict) -> list[dict]:
    """
    R005: sort编号唯一
    sort 编号全局唯一，禁撞号。

    检查 tables.json 中所有表的 sort 字段是否有重复。
    """
    violations = []
    table_list = _get_table_list(tables)
    sort_map: dict[str, list[str]] = {}
    for t in table_list:
        sort_val = str(t.get('sort', ''))
        if sort_val:
            sort_map.setdefault(sort_val, []).append(t.get('table', ''))
    for sort_val, table_names in sort_map.items():
        if len(table_names) > 1:
            violations.append({
                "table": '/'.join(table_names),
                "detail": f"sort={sort_val} {len(table_names)}表撞号",
                "fix": "多表产物可保持，但建议分配子编号 (如 070/071/072...)",
            })
    return violations


def check_r006(tables: dict, dictionary: dict) -> list[dict]:
    """
    R006: increment必须声明dedup_key
    增量模式的表必须声明去重键，避免重复行。

    检查 mode=increment 的表是否都有 dedup_key 声明。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        mode = t.get('mode', '')
        dedup_key = t.get('dedup_key', t.get('dedupKey', []))
        if mode == 'increment' and not dedup_key:
            violations.append({
                "table": t.get('table', ''),
                "detail": f"mode=increment 但未声明 dedup_key",
                "fix": "在 tables.json 中补充 dedup_key 字段",
            })
    return violations


def check_r007(tables: dict, dictionary: dict) -> list[dict]:
    """
    R007: 必须声明date_col
    每表需声明 date_col 用于健康度/新鲜度判定。

    检查所有表是否都声明了 date_col 字段。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        is_view = t.get('isView', False)
        date_col = t.get('date_col', t.get('dateCol', None))
        if not is_view and not date_col:
            violations.append({
                "table": t.get('table', ''),
                "detail": "未声明 date_col",
                "fix": "在 tables.json 中补充 date_col 字段（如 'date', 'trade_time'）",
            })
    return violations


def check_r008(tables: dict, dictionary: dict) -> list[dict]:
    """
    R008: 血缘无环
    depends_on 构成的 DAG 不得有环。

    使用拓扑排序检测依赖关系图中是否存在环。
    """
    violations = []
    table_list = _get_table_list(tables)

    # 构建邻接表
    graph: dict[str, list[str]] = {}
    all_tables = set()
    for t in table_list:
        name = t.get('table', '')
        all_tables.add(name)
        deps = t.get('depends_on', [])
        graph[name] = [d for d in deps if d in all_tables or True]

    # 拓扑排序检测环
    visited: set[str] = set()
    in_stack: set[str] = set()
    cycle_tables: set[str] = set()

    def dfs(node: str) -> bool:
        visited.add(node)
        in_stack.add(node)
        for neighbor in graph.get(node, []):
            if neighbor in in_stack:
                cycle_tables.add(neighbor)
                cycle_tables.add(node)
                return True
            if neighbor not in visited:
                if dfs(neighbor):
                    return True
        in_stack.discard(node)
        return False

    for t in all_tables:
        if t not in visited:
            dfs(t)

    if cycle_tables:
        violations.append({
            "table": f"({','.join(sorted(cycle_tables))})",
            "detail": f"depends_on 存在环: {', '.join(sorted(cycle_tables))}",
            "fix": "检查并移除循环依赖",
        })

    return violations


def check_r009(tables: dict, dictionary: dict) -> list[dict]:
    """
    R009: 禁止循环import
    入库脚本禁止 import run.py（反依赖方向）。

    注：此规则需要 AST 分析脚本源码，元数据层面无法完全检测。
    此处标记需要 AST 检查的脚本。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        source_detail = t.get('source_detail', '')
        # 检测可能存在反向依赖的脚本
        if 'from run import' in source_detail or 'import run' in source_detail:
            violations.append({
                "table": t.get('table', ''),
                "detail": f"反向 import run.py: {source_detail}",
                "fix": "抽到 common/trading.py 或其他公共模块",
            })
    return violations


def check_r010(tables: dict, dictionary: dict) -> list[dict]:
    """
    R010: 占位@meta清理
    工具/策略脚本不得带 @meta table=（会被误收录为数据表）。

    检查 dir 为非数据目录的脚本是否被标记为数据表。
    """
    violations = []
    table_list = _get_table_list(tables)
    for t in table_list:
        table_name = t.get('table', '')
        # 检测占位符表名
        if table_name.startswith('-') or table_name == 'skeleton' or 'ingest_plan' in table_name:
            violations.append({
                "table": f"({table_name}.py)",
                "detail": f"@meta table={table_name} 误标",
                "fix": "删除 @meta 行",
            })
    return violations


def check_r011(tables: dict, dictionary: dict) -> list[dict]:
    """
    R011: DB_PATH统一来源
    DB_PATH 应来自 common/config，禁散落硬编码。

    注：此规则需要扫描脚本源码中的硬编码路径，元数据层面无法检测。
    """
    violations = []
    # 此规则需要 AST 扫描，标记为需人工检查
    violations.append({
        "table": "(全局)",
        "detail": "需 AST 扫描确认：检查脚本中硬编码的 DB_PATH",
        "fix": "迁 common/config.DB_PATH",
    })
    return violations


def check_r012(tables: dict, dictionary: dict) -> list[dict]:
    """
    R012: TQ初始化不重复
    TQ 初始化样板应抽 common/tq_client（当前 9 份重复）。

    注：此规则需要扫描脚本源码中的 TQ 初始化代码，元数据层面无法检测。
    """
    violations = []
    table_list = _get_table_list(tables)
    tq_tables = []
    for t in table_list:
        source = t.get('source', '')
        if 'API(TQ)' in source or 'tqcenter' in source.lower():
            tq_tables.append(t.get('table', ''))
    if len(tq_tables) > 3:
        violations.append({
            "table": "(全局)",
            "detail": f"{len(tq_tables)} 个脚本使用 TQ API，可能存在重复初始化样板",
            "fix": "迁 common/tq_client.init_tq()",
        })
    return violations


# ─── 辅助函数 ────────────────────────────────────────────────

def _get_table_list(tables: Any) -> list[dict]:
    """
    统一处理 tables 数据格式。
    tables.json 可能是 dict{table_name: config} 或 list[config]。
    """
    if isinstance(tables, list):
        return tables
    if isinstance(tables, dict):
        # 可能是 {table_name: config} 格式
        result = []
        for key, val in tables.items():
            if isinstance(val, dict):
                entry = {"table": key, **val}
                result.append(entry)
            else:
                result.append({"table": key, "value": val})
        return result
    return []


# ─── 报告生成 ────────────────────────────────────────────────

def run_all_rules(config_dir: str, rule_ids: list[str] | None = None) -> dict:
    """
    运行所有（或指定的）lint 规则，生成报告。

    Args:
        config_dir: 配置目录路径
        rule_ids: 指定运行的规则 ID 列表，如 ['R001', 'R004']

    Returns:
        dict: lint 报告
    """
    data = load_config(config_dir)
    tables = data["tables"]
    dictionary = data["dictionary"]

    rule_funcs = {
        "R001": check_r001,
        "R002": check_r002,
        "R003": check_r003,
        "R004": check_r004,
        "R005": check_r005,
        "R006": check_r006,
        "R007": check_r007,
        "R008": check_r008,
        "R009": check_r009,
        "R010": check_r010,
        "R011": check_r011,
        "R012": check_r012,
    }

    results = []
    total_violations = 0
    passing = 0

    for rule_id, func in rule_funcs.items():
        if rule_ids and rule_id not in rule_ids:
            continue

        # 查找规则元信息
        meta = next((r for r in RULES_META if r.get('id') == rule_id), {})
        level = meta.get('level', 'UNKNOWN')
        name = meta.get('name', rule_id)
        description = meta.get('description', func.__doc__ or '')

        try:
            violations = func(tables, dictionary)
        except Exception as e:
            violations = [{"table": "(error)", "detail": str(e), "fix": "检查配置文件格式"}]

        violation_count = len(violations)
        total_violations += violation_count
        if violation_count == 0:
            passing += 1

        results.append({
            "id": rule_id,
            "name": name,
            "level": level,
            "description": description.strip().split('\\n')[0] if description else '',
            "violations": violations,
            "violation_count": violation_count,
            "status": "PASS" if violation_count == 0 else "FAIL",
        })

    pass_rate = round((passing / len(results)) * 100) if results else 0

    report = {
        "generated_at": datetime.now().isoformat(),
        "config_dir": os.path.abspath(config_dir),
        "total_rules": len(results),
        "passing": passing,
        "failing": len(results) - passing,
        "pass_rate": f"{pass_rate}%",
        "total_violations": total_violations,
        "results": results,
    }

    return report


def format_markdown(report: dict) -> str:
    """
    将 lint 报告格式化为 Markdown。

    Args:
        report: run_all_rules() 返回的报告字典

    Returns:
        str: Markdown 格式的报告
    """
    lines = [
        "# DataOps Lint Report",
        "",
        f"> 生成时间: {report['generated_at']}",
        f"> 配置目录: {report['config_dir']}",
        "",
        "## 概览",
        "",
        f"| 指标 | 值 |",
        f"|------|-----|",
        f"| 规则总数 | {report['total_rules']} |",
        f"| 通过 | {report['passing']} |",
        f"| 失败 | {report['failing']} |",
        f"| 通过率 | {report['pass_rate']} |",
        f"| 总违规数 | {report['total_violations']} |",
        "",
        "## 目录",
        "",
    ]

    # 目录
    for r in report["results"]:
        icon = "✅" if r["status"] == "PASS" else "❌" if r["level"] == "RED" else "⚠️" if r["level"] == "YELLOW" else "ℹ️"
        lines.append(f"{icon} [{r['id']} {r['name']}](#{r['id'].lower()}-{r['name'].replace(' ', '-')}) — {r['violation_count']} violations")

    lines.append("")
    lines.append("---")
    lines.append("")

    # 详细规则
    for r in report["results"]:
        level_badge = {"RED": "🔴 RED", "YELLOW": "🟡 YELLOW", "BLUE": "🔵 BLUE"}.get(r["level"], r["level"])
        status_badge = "✅ PASS" if r["status"] == "PASS" else "❌ FAIL"
        lines.append(f"## {r['id']}: {r['name']}")
        lines.append("")
        lines.append(f"**级别**: {level_badge} | **状态**: {status_badge} | **违规数**: {r['violation_count']}")
        lines.append("")
        lines.append(f"> {r['description']}")
        lines.append("")

        if r["violations"]:
            lines.append("| 表 | 详情 | 修复建议 |")
            lines.append("|-----|------|----------|")
            for v in r["violations"]:
                table = v.get("table", "")
                detail = v.get("detail", "")
                fix = v.get("fix", "")
                lines.append(f"| {table} | {detail} | {fix} |")
        else:
            lines.append("*无违规 ✅*")

        lines.append("")
        lines.append("---")
        lines.append("")

    lines.append(f"*报告由 lint_engine.py 自动生成 — {report['generated_at']}*")
    return "\\n".join(lines)


# ─── 主入口 ──────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="DataOps Lint Engine — 校验 db-v2 元数据合规性",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python lint_engine.py                     # 运行全部规则，输出 JSON
  python lint_engine.py --format md         # 输出 Markdown 报告
  python lint_engine.py --rules R001,R004   # 只运行指定规则
  python lint_engine.py --config ./config   # 指定配置目录
        """,
    )
    parser.add_argument(
        '--config', '-c',
        default='./config',
        help='配置目录路径 (默认: ./config)',
    )
    parser.add_argument(
        '--format', '-f',
        choices=['json', 'md'],
        default='json',
        help='输出格式: json 或 md (默认: json)',
    )
    parser.add_argument(
        '--rules', '-r',
        default=None,
        help='指定运行的规则 ID，逗号分隔，如 R001,R004',
    )
    parser.add_argument(
        '--output', '-o',
        default=None,
        help='输出文件路径 (默认: stdout)',
    )

    args = parser.parse_args()

    # 解析指定规则
    rule_ids = None
    if args.rules:
        rule_ids = [r.strip().upper() for r in args.rules.split(',')]

    # 运行规则
    report = run_all_rules(args.config, rule_ids)

    # 格式化输出
    if args.format == 'md':
        output = format_markdown(report)
    else:
        output = json.dumps(report, ensure_ascii=False, indent=2)

    # 写入文件或 stdout
    if args.output:
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write(output)
        print(f"报告已写入: {args.output}")
    else:
        print(output)

    # 返回码：有 RED 违规则返回 1
    has_red = any(r["level"] == "RED" and r["status"] == "FAIL" for r in report["results"])
    sys.exit(1 if has_red else 0)


if __name__ == '__main__':
    main()
`
}
