#!/usr/bin/env python3
# sql_query.py — DataOps UI 只读查询执行器（Python sidecar）
#
# 由 src/app/api/sql/route.ts 通过 spawn 调用，stdio 交换 JSON。
# Node 侧已做：关键字白名单 + LIMIT 注入 + 超时 kill。
# 本脚本再加一层：read_only 连库（物理上无法 DDL/DML）+ 行数硬上限。
#
# 协议：
#   stdin  : 一行 JSON {"sql","explain":bool,"limit":int,"dbPath":str}
#   stdout : 一行 JSON
#            正常查询: {"columns":[],"rows":[[]],"rowCount":N,"rowsAffected":N,"truncated":bool,"elapsedMs":N}
#            EXPLAIN  : {"explainText":"...物理计划原文...","elapsedMs":N}
#            出错      : {"error":"...","elapsedMs":N}
#   永远 exit 0（错误也走 stdout JSON），方便 Node 解析。

import sys
import json
import time
import os
import decimal
import datetime

# Windows 默认 stdout 编码可能是 gbk，强制 utf-8，避免中文表名/数据乱码
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
except Exception:
    pass

import duckdb

MAX_LIMIT = 5000  # 行数硬上限，防 SELECT * 打爆（最大表 1.98 亿行）


def _ser(o):
    """JSON 默认序列化器：处理 DuckDB 返回的 datetime/Decimal/bytes 等非原生类型。"""
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


def main():
    t0 = time.time()

    # 1. 解析输入
    try:
        req = json.loads(sys.stdin.read() or "{}")
    except Exception as e:
        print(json.dumps({"error": f"无法解析输入 JSON: {e}", "elapsedMs": 0}, ensure_ascii=False))
        return

    sql = (req.get("sql") or "").strip()
    if not sql:
        print(json.dumps({"error": "空 SQL", "elapsedMs": int((time.time() - t0) * 1000)}, ensure_ascii=False))
        return

    explain = bool(req.get("explain"))
    try:
        limit = int(req.get("limit") or 1000)
    except Exception:
        limit = 1000
    limit = max(1, min(limit, MAX_LIMIT))

    db_path = (
        req.get("dbPath")
        or os.environ.get("DUCKDB_PATH")
        or r"K:\DB数据库_v2\db\profit_radar.duckdb"
    )

    con = None
    try:
        # 2. read_only 连库 —— 即使注入 DELETE 也会被库本身拒绝
        con = duckdb.connect(db_path, read_only=True)

        if explain:
            # DuckDB EXPLAIN 返回 (explain_key, explain_value)：logical_plan / physical_plan
            rows = con.execute(f"EXPLAIN {sql}").fetchall()
            phys = ""
            for k, v in rows:
                if k == "physical_plan":
                    phys = v
            if not phys and rows:
                phys = rows[-1][1]
            print(json.dumps(
                {"explainText": phys, "elapsedMs": int((time.time() - t0) * 1000)},
                ensure_ascii=False, default=_ser,
            ))
            return

        # 3. 普通查询：fetchmany 多取 1 行用于判断是否截断
        cur = con.execute(sql)
        cols = [d[0] for d in cur.description] if cur.description else []
        fetched = cur.fetchmany(limit + 1)
        truncated = len(fetched) > limit
        rows = fetched[:limit]
        print(json.dumps({
            "columns": cols,
            "rows": rows,
            "rowCount": len(rows),
            "rowsAffected": len(rows),
            "truncated": truncated,
            "elapsedMs": int((time.time() - t0) * 1000),
        }, ensure_ascii=False, default=_ser))

    except Exception as e:
        print(json.dumps(
            {"error": str(e), "elapsedMs": int((time.time() - t0) * 1000)},
            ensure_ascii=False, default=_ser,
        ))
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
