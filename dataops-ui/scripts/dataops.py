#!/usr/bin/env python3
# dataops.py — DataOps UI 元数据后端（op 分发，只读）
#
# 由 /api/dataops 通过 spawn 调用，stdio 交换 JSON。
# stdin  : {"op": "...", ...其它参数}
# stdout : 单行 JSON（成功 {op,...,elapsedMs}；失败 {"error":...,"op":...,"elapsedMs":...}）
#
# 已实现 op（A 类，纯 DuckDB 只读）：
#   dbinfo      : 库版本/路径/大小/表数/连通性
#   catalog     : 全表 {table, rows, columnCount, dateCol, maxDate, exists}
#   health      : 同 catalog（新鲜度/红绿由前端按 schedule 判定，后端只给事实）
#   dictionary  : 全表列信息 {table, columns:[{name,type,nullable}]}
# C 类 op（lint/lineage/logs/orchestration）由后续追加。
#
# 路径：DB_PATH / DATAOPS_PROJECT_ROOT 可用环境变量覆盖。
import sys
import json
import time
import os
import re
import decimal
import datetime
from collections import OrderedDict

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass

import duckdb

DB_PATH = os.environ.get("DUCKDB_PATH") or r"K:\DB数据库_v2\db\profit_radar.duckdb"
PROJECT_ROOT = os.environ.get("DATAOPS_PROJECT_ROOT") or r"K:\DB数据库_v2"

# 视为"日期列"的列名（按优先级），用于新鲜度 max(date) 判定
_DATE_NAMES = (
    "date", "trade_date", "trade_time", "dt", "day", "fetch_time",
    "hqdate", "snapshot_time", "stat_date", "announce_time",
)


def _ser(o):
    if isinstance(o, (datetime.datetime, datetime.date, datetime.time)):
        return o.isoformat()
    if isinstance(o, decimal.Decimal):
        return float(o)
    if isinstance(o, (bytes, bytearray, memoryview)):
        try:
            return bytes(o).decode("utf-8")
        except Exception:
            return bytes(o).hex()
    return str(o)


def _json(obj):
    print(json.dumps(obj, ensure_ascii=False, default=_ser))


def _connect():
    return duckdb.connect(DB_PATH, read_only=True)


def _tables_with_datecol(con):
    """返回 [(table, datecol_or_None, column_count)]，按 table_name 排序。"""
    rows = con.execute(
        "select table_name, column_name, data_type from information_schema.columns "
        "where table_schema='main' order by table_name, ordinal_position"
    ).fetchall()
    by_table = OrderedDict()
    for t, c, dt in rows:
        by_table.setdefault(t, []).append((c, dt))
    out = []
    for t, cols in by_table.items():
        datecol = None
        # 1) 名字命中优先
        for c, _ in cols:
            cl = c.lower()
            if cl in _DATE_NAMES or cl.endswith("_date") or cl.endswith("_time"):
                datecol = c
                break
        # 2) 退而求其次：类型是 DATE/TIMESTAMP
        if not datecol:
            for c, dt in cols:
                if "DATE" in (dt or "").upper() or "TIMESTAMP" in (dt or "").upper():
                    datecol = c
                    break
        out.append((t, datecol, len(cols)))
    return out


def op_dbinfo(_req):
    con = _connect()
    try:
        ver = con.execute("select version()").fetchone()[0]
        tcount = con.execute(
            "select count(*) from information_schema.tables where table_schema='main'"
        ).fetchone()[0]
    finally:
        con.close()
    try:
        size = os.path.getsize(DB_PATH)
    except Exception:
        size = None
    return {
        "openOk": True,
        "version": ver,
        "dbPath": DB_PATH,
        "fileSizeBytes": size,
        "tableCount": tcount,
    }


def op_catalog(_req):
    con = _connect()
    try:
        twd = _tables_with_datecol(con)
        tables = []
        for t, datecol, ncol in twd:
            try:
                rows = con.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
            except Exception:
                rows = None
            max_date = None
            if datecol:
                try:
                    v = con.execute(f'SELECT MAX("{datecol}") FROM "{t}"').fetchone()[0]
                    max_date = str(v) if v is not None else None
                except Exception:
                    max_date = None
            tables.append({
                "table": t,
                "rows": rows,
                "columnCount": ncol,
                "dateCol": datecol,
                "maxDate": max_date,
                "exists": True,
            })
    finally:
        con.close()
    return {"tables": tables}


def op_health(req):
    # 后端只给事实（行数/maxDate）；红绿状态由前端按 schedule + 交易日判定
    return op_catalog(req)


def op_dictionary(_req):
    con = _connect()
    try:
        rows = con.execute(
            "select table_name, column_name, data_type, is_nullable from information_schema.columns "
            "where table_schema='main' order by table_name, ordinal_position"
        ).fetchall()
        by_table = OrderedDict()
        for t, c, dt, nl in rows:
            by_table.setdefault(t, []).append({"name": c, "type": dt, "nullable": nl})
    finally:
        con.close()
    return {"tables": [{"table": t, "columns": cols} for t, cols in by_table.items()]}


# 12 条 lint 规则元信息（与前端 src/lib/dataops/mock-data.ts LINT_RULES 对齐）
# 仅实现机器可静态校验的子集；需运行时/DB 状态的规则在此处标注跳过。
_LINT_RULES = [
    {"id": "R001", "name": "表名格式",          "level": "RED",    "check": True},
    {"id": "R002", "name": "@meta与代码常量一致", "level": "RED",    "check": True},
    {"id": "R003", "name": "契约签名规范",       "level": "RED",    "check": False},  # 需 AST 签名分析，跳过
    {"id": "R004", "name": "列名禁中文禁空格",   "level": "RED",    "check": False},  # 需 DB schema 扫描，跳过
    {"id": "R005", "name": "sort编号唯一",       "level": "RED",    "check": True},
    {"id": "R006", "name": "increment必须声明dedup_key", "level": "YELLOW", "check": False},  # dedup_key 非脚本常量，跳过
    {"id": "R007", "name": "必须声明date_col",   "level": "YELLOW", "check": False},  # 需 DB schema，跳过
    {"id": "R008", "name": "血缘无环",           "level": "RED",    "check": False},  # 见 op_lineage，跳过
    {"id": "R009", "name": "禁止循环import",     "level": "RED",    "check": True},
    {"id": "R010", "name": "占位@meta清理",       "level": "YELLOW", "check": True},
    {"id": "R011", "name": "DB_PATH统一来源",     "level": "BLUE",   "check": False},  # 全局硬编码扫描，跳过
    {"id": "R012", "name": "TQ初始化不重复",      "level": "BLUE",   "check": False},  # 全局样板扫描，跳过
]

_META_RE = re.compile(r"^#\s*@meta\s+(.*)$", re.M)  # 捕获整行，再按 key=val token 拆分
_KNOWN_TABLES = None  # 懒加载缓存


def _list_scripts():
    """返回 [(abs_path, dir_name, filename), ...]，扫描 1_入库 + 2_计算 的 .py。"""
    import glob
    out = []
    for d in ("1_入库", "2_计算"):
        base = os.path.join(PROJECT_ROOT, d)
        for p in sorted(glob.glob(os.path.join(base, "*.py"))):
            out.append((p, d, os.path.basename(p)))
    return out


def _parse_meta(src):
    """从脚本源码解析 @meta，返回 {table,cn,dir,sort,schedule,mode,source}（缺省 None）。

    支持单行多键：`# @meta table=foo cn=中文 dir=1_入库 sort=010`。
    """
    fields = {k: None for k in ("table", "cn", "dir", "sort", "schedule", "mode", "source")}
    kv_re = re.compile(r"(\w+)=(\S+)")
    for m in _META_RE.finditer(src):
        for km in kv_re.finditer(m.group(1)):
            key, val = km.group(1), km.group(2)
            if key in fields:
                fields[key] = val
    return fields


def _get_known_tables():
    """读取 DuckDB 表名集合（只读），失败返回空集。"""
    global _KNOWN_TABLES
    if _KNOWN_TABLES is not None:
        return _KNOWN_TABLES
    try:
        con = _connect()
        try:
            rows = con.execute(
                "select table_name from information_schema.tables where table_schema='main'"
            ).fetchall()
            _KNOWN_TABLES = {r[0] for r in rows}
        finally:
            con.close()
    except Exception:
        _KNOWN_TABLES = set()
    return _KNOWN_TABLES


def op_lint(_req):
    """C 类 op：静态扫描 1_入库/2_计算 脚本的 @meta + 源码，报告违规。

    实现的规则：R001(表名格式) / R002(@meta mode 与代码 MODE 常量一致) /
    R005(sort 撞号) / R009(import run.py) / R010(占位 @meta) / 缺 @meta 头。
    其余规则（R003/R004/R006/R007/R008/R011/R012）需运行时或全局扫描，跳过。
    """
    import ast
    violations = []
    scripts = _list_scripts()
    sort_map = {}  # sort -> [file]

    for path, d, fname in scripts:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                src = f.read()
        except Exception:
            continue
        meta = _parse_meta(src)
        table = meta.get("table")

        # 缺 @meta table= 头
        if not table:
            violations.append({
                "rule": "META", "severity": "YELLOW", "file": fname, "table": None,
                "line": None, "message": "缺少 # @meta table= 声明",
            })

        if table:
            # R001 表名格式（纯小写下划线，禁数字开头）
            if not re.match(r"^[a-z][a-z0-9_]*$", table):
                reason = "数字开头" if table[:1].isdigit() else "非小写下划线"
                violations.append({
                    "rule": "R001", "severity": "RED", "file": fname, "table": table,
                    "line": None, "message": f"表名 '{table}' {reason}（DuckDB 非法）",
                })
            # R010 占位 @meta（- / skeleton / ingest_plan）
            if table.startswith("-") or table == "skeleton" or "ingest_plan" in table:
                violations.append({
                    "rule": "R010", "severity": "YELLOW", "file": fname, "table": table,
                    "line": None, "message": "占位 @meta table=（会误收录为数据表）",
                })

        # R009 禁止 import run.py（反依赖方向）
        try:
            tree = ast.parse(src)
        except Exception:
            tree = None
        r009_hit = False
        if tree is not None:
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    for n in node.names:
                        if n.name == "run" or n.name.startswith("run."):
                            r009_hit = True
                elif isinstance(node, ast.ImportFrom):
                    if node.module and (node.module == "run" or node.module.startswith("run.")):
                        r009_hit = True
        if r009_hit:
            violations.append({
                "rule": "R009", "severity": "RED", "file": fname, "table": table,
                "line": None, "message": "反向 import run.py（应抽到 common/ 模块）",
            })

        # R002 @meta mode 与代码 MODE 常量一致
        meta_mode = meta.get("mode")
        if meta_mode:
            mode_val = None
            if tree is not None:
                for node in ast.walk(tree):
                    if isinstance(node, ast.Assign):
                        for tgt in node.targets:
                            if isinstance(tgt, ast.Name) and tgt.id == "MODE":
                                if isinstance(node.value, ast.Constant):
                                    mode_val = str(node.value.value)
                                elif isinstance(node.value, ast.Attribute):
                                    mode_val = node.value.attr
            if mode_val and mode_val != meta_mode:
                violations.append({
                    "rule": "R002", "severity": "RED", "file": fname, "table": table,
                    "line": None, "message": f"@meta mode={meta_mode} 与代码 MODE={mode_val!r} 不一致",
                })

        # R005 sort 撞号（收集，循环结束后判定）
        sort_val = meta.get("sort")
        if sort_val:
            sort_map.setdefault(sort_val, []).append(fname)

    # R005 判定
    for sort_val, files in sort_map.items():
        if len(files) > 1:
            violations.append({
                "rule": "R005", "severity": "RED", "file": "/".join(files), "table": None,
                "line": None, "message": f"sort={sort_val} {len(files)}脚本撞号",
            })

    rules_checked = sum(1 for r in _LINT_RULES if r["check"])
    return {
        "violations": violations,
        "rulesChecked": rules_checked,
        "rulesTotal": len(_LINT_RULES),
        "scriptCount": len(scripts),
    }


def op_lineage(_req):
    """C 类 op：表↔脚本血缘图（尽力而为，静态扫描）。

    边定义：script --writes--> @meta table；script --reads--> 源码中引用的已知表名
    （FROM/JOIN <tbl>、字符串字面量命中已知表名、ensure_table("<tbl>")）。
    局限：字符串匹配可能漏报/误报（如注释里的表名、动态拼接的表名）；不解析视图依赖。
    """
    nodes = []
    edges = []
    seen_nodes = set()
    known_tables = _get_known_tables()

    def add_node(node_id, label, group):
        if node_id not in seen_nodes:
            seen_nodes.add(node_id)
            nodes.append({"id": node_id, "label": label, "group": group})

    scripts = _list_scripts()
    for path, d, fname in scripts:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                src = f.read()
        except Exception:
            continue
        meta = _parse_meta(src)
        table = meta.get("table")
        script_id = f"script:{fname}"
        add_node(script_id, fname, "script")

        if table:
            add_node(table, table, "table")
            edges.append({"from": script_id, "to": table, "type": "writes"})

        # 读取依赖：扫描已知表名在源码中的出现（排除自身 writes 表）
        for tbl in known_tables:
            if tbl == table:
                continue
            # FROM/JOIN <tbl> 或 字符串字面量 "tbl"/'tbl' 或 bare word
            pat = r"(?:from|join)\s+[\"'`]?%s[\"'`]?\b|['\"]%s['\"]" % (re.escape(tbl), re.escape(tbl))
            if re.search(pat, src, re.I):
                add_node(tbl, tbl, "table")
                edges.append({"from": script_id, "to": tbl, "type": "reads"})

    return {"nodes": nodes, "edges": edges,
            "note": "静态扫描源码字符串/FROM/JOIN，尽力而为，可能漏报动态表名"}


# 日志行解析：覆盖 loguru `YYYY-MM-DD HH:MM:SS.mmm | LEVEL | ...` 与
# logging `YYYY-MM-DD HH:MM:SS,mmm - LEVEL - ...` 与 `[YYYY-MM-DD HH:MM:SS] LEVEL ...`
_LOG_PATTERNS = [
    re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*\|\s*(?P<level>\w+)\s*\|.*?-\s*(?P<msg>.*)$"),
    re.compile(r"^(?P<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?)\s*-\s*(?P<level>\w+)\s*-\s*(?P<msg>.*)$"),
    re.compile(r"^\[(?P<ts>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\]\s*(?P<level>\w+)\s*(?P<msg>.*)$"),
]
_VALID_LEVELS = {"DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL", "TRACE", "SUCCESS"}


def _parse_log_line(line):
    """返回 {ts, level, message}；无法解析时 level=INFO、message=原文、ts=None。"""
    for pat in _LOG_PATTERNS:
        m = pat.match(line)
        if m:
            level = m.group("level").upper()
            if level not in _VALID_LEVELS:
                # 第二种模式里 LEVEL 位可能是模块名，降级为原文
                continue
            return {"ts": m.group("ts"), "level": level, "message": m.group("msg").rstrip()}
    return {"ts": None, "level": "INFO", "message": line.rstrip()}


def op_logs(_req):
    """C 类 op：tail 最近日志文件（只读）。

    读 K:\\DB数据库_v2\\logs\\，取 mtime 最新的若干文件，合并后取最后 500 行解析。
    """
    log_dir = os.path.join(PROJECT_ROOT, "logs")
    if not os.path.isdir(log_dir):
        return {"lines": [], "fileCount": 0, "truncated": False, "error": f"日志目录不存在: {log_dir}"}

    # 只取 .log 文件，按 mtime 倒序
    try:
        entries = [
            (os.path.join(log_dir, n), os.path.getmtime(os.path.join(log_dir, n)))
            for n in os.listdir(log_dir)
            if n.lower().endswith(".log") and os.path.isfile(os.path.join(log_dir, n))
        ]
    except Exception:
        entries = []
    entries.sort(key=lambda x: x[1], reverse=True)

    if not entries:
        return {"lines": [], "fileCount": 0, "truncated": False}

    limit = int(_req.get("limit", 500)) if isinstance(_req, dict) else 500
    limit = max(1, min(limit, 500))

    # 逐文件倒着读，凑满 limit 行
    collected = []  # [(file_basename, line)]
    used_files = []
    for fpath, _mtime in entries:
        if len(collected) >= limit:
            break
        try:
            with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
        except Exception:
            continue
        used_files.append(os.path.basename(fpath))
        # 取该文件末尾若干行，prepend
        need = limit - len(collected)
        chunk = lines[-need:] if len(lines) > need else lines
        collected = [(os.path.basename(fpath), ln.rstrip("\n")) for ln in chunk] + collected

    out_lines = []
    for fname, raw in collected[-limit:]:
        parsed = _parse_log_line(raw)
        parsed["file"] = fname
        out_lines.append(parsed)

    return {
        "lines": out_lines,
        "fileCount": len(used_files),
        "truncated": len(out_lines) >= limit,
    }


def op_orchestration(_req):
    """C 类 op：DAG/调度/最新数据日期（来自 @meta + DuckDB max(date) 代理）。

    不编造运行历史（项目无运行记录），lastDataDate 仅是数据最新日期的代理。
    """
    scripts_meta = []
    scripts = _list_scripts()
    for path, d, fname in scripts:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                src = f.read()
        except Exception:
            continue
        meta = _parse_meta(src)
        if not meta.get("table"):
            continue
        scripts_meta.append({
            "file": fname,
            "table": meta.get("table"),
            "cn": meta.get("cn"),
            "dir": meta.get("dir") or d,
            "sort": meta.get("sort"),
            "schedule": meta.get("schedule"),
            "mode": meta.get("mode"),
            "source": meta.get("source"),
        })

    # 取每表 max(datecol) 作为最新数据日期代理
    last_dates = {}
    try:
        con = _connect()
        try:
            for t, datecol, _ncol in _tables_with_datecol(con):
                if not datecol:
                    continue
                try:
                    v = con.execute(f'SELECT MAX("{datecol}") FROM "{t}"').fetchone()[0]
                    if v is not None:
                        last_dates[t] = str(v)[:10]
                except Exception:
                    pass
        finally:
            con.close()
    except Exception:
        pass

    for s in scripts_meta:
        s["lastDataDate"] = last_dates.get(s["table"])

    return {
        "scripts": scripts_meta,
        "note": "lastDataDate 是数据最新日期的代理，非真实运行记录",
    }


DISPATCH = {
    "dbinfo": op_dbinfo,
    "catalog": op_catalog,
    "health": op_health,
    "dictionary": op_dictionary,
    "lint": op_lint,
    "lineage": op_lineage,
    "logs": op_logs,
    "orchestration": op_orchestration,
}


def main():
    t0 = time.time()
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        _json({"error": f"无法解析输入 JSON: {e}", "elapsedMs": 0})
        return
    op = req.get("op")
    fn = DISPATCH.get(op)
    if not fn:
        _json({"error": f"未知 op: {op}", "op": op, "elapsedMs": int((time.time() - t0) * 1000)})
        return
    try:
        res = fn(req)
        _json({**res, "op": op, "elapsedMs": int((time.time() - t0) * 1000)})
    except Exception as e:
        _json({"error": str(e), "op": op, "elapsedMs": int((time.time() - t0) * 1000)})


if __name__ == "__main__":
    main()
