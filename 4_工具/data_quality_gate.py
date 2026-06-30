#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""数据质量门禁 — 重复检测 (data_quality_gate)

入库脚本在 save_data 事务内调用 assert_no_dup(): 对刚写入的分区按自然键查重,
有重复则抛 DupError → 事务 ROLLBACK → 脏数据落不进库。这是"入库后体检"的主防线。

run.py check-dup 用 sweep() 做全表/单表巡检(大表按日/按年分块防 OOM)。

设计原则:
  - assert_no_dup 必须带 where(刚写的分区), 限定范围 → 不会对亿级大表全表 GROUP BY 而 OOM
  - 全表巡检走 sweep() 的分块路径
  - 自然键 DUP_KEYS 复用 2026-06-30 全表体检已验证的键
  - stock_block_relation 的键含 板块名称+板块类型 (板块代码对指数/风格板块为'0', 不能单独作键)
"""
import duckdb
from loguru import logger

# 每张表的自然键(业务唯一性) —— 增删表须同步维护
DUP_KEYS = {
    'stock_daily_kline': ['code', 'date'],
    'stock_kline_weekly': ['code', 'date'],
    'stock_kline_monthly': ['code', 'date'],
    'stock_daily_turnover': ['code', 'date'],
    't_bk5_19': ['date', 'code'],
    'pianpao_daily': ['trade_date', 'stock_code'],
    'pianpao_daily_summary': ['trade_date'],
    'pianpao_intraday': ['trade_date', 'stock_code'],
    'pianpao_intraday_events': ['trade_date', 'stock_code', 'seq'],
    'pianpao_intraday_periods': ['trade_date', 'stock_code', 'period_name'],
    'stock_kline_1m': ['code', 'trade_time'],
    'stock_kline_5m': ['code', 'trade_time'],
    'stock_kline_15m': ['code', 'trade_time'],
    'stock_kline_30m': ['code', 'trade_time'],
    'stock_kline_60m': ['code', 'trade_time'],
    'market_sc1_42': ['date'],
    'stock_gp1_46_indicators': ['date', 'code', 'gp_code'],
    'capital_info': ['code', 'date'],
    # 板块代码对指数/风格板块为'0' (get_relation 不返回代码), 须用 名称+类型 才唯一
    'stock_block_relation': ['stock_code', '板块名称', '板块类型', 'fetch_time'],
    'sjb_api_plhqL2kz_88zd': ['HqDate', 'code'],
    'dim_security_type': ['code'],
    'dim_gp_indicator': ['gp_code'],
    'dim_88field_indicator': ['field_en'],
    'sector_stocks': ['sector_code', 'stock_code'],
}

# 大表全表 GROUP BY 会 OOM, 巡检时按此分块: (粒度, 日期表达式)
CHUNK = {
    'stock_kline_1m':  ('day',  "CAST(trade_time AS DATE)"),
    'stock_kline_5m':  ('day',  "CAST(trade_time AS DATE)"),
    'stock_kline_15m': ('day',  "CAST(trade_time AS DATE)"),
    'stock_kline_30m': ('day',  "CAST(trade_time AS DATE)"),
    'stock_kline_60m': ('day',  "CAST(trade_time AS DATE)"),
    'stock_gp1_46_indicators': ('year', 'EXTRACT(YEAR FROM "date")'),
}


class DupError(Exception):
    """入库事务内检出重复 → 调用方应 ROLLBACK。"""


def _key_sql(key: list) -> str:
    return ",".join(f'"{c}"' for c in key)


def count_dup(con, table: str, key=None, where: str = None):
    """返回 (重复键数, 超额行数)。key 默认取 DUP_KEYS[table]。
    where 限定范围(如刚写的分区); 不给则全表(大表会 OOM → 改用 sweep)。"""
    if key is None:
        if table not in DUP_KEYS:
            raise KeyError(f"{table} 未在 DUP_KEYS 登记, 传 key= 显式指定")
        key = DUP_KEYS[table]
    ks = _key_sql(key)
    w = f"WHERE {where}" if where else ""
    r = con.execute(
        f"SELECT COUNT(*), COALESCE(SUM(c-1),0) FROM "
        f"(SELECT COUNT(*) c FROM {table} {w} GROUP BY {ks} HAVING COUNT(*)>1)"
    ).fetchone()
    return int(r[0] or 0), int(r[1] or 0)


def assert_no_dup(con, table: str, where: str, key=None, label: str = None):
    """入库事务内调用: 对刚写的分区 where 查重, 有重复抛 DupError。
    必须带 where 限定分区, 避免全表 GROUP BY。"""
    if not where:
        raise ValueError("assert_no_dup 必须带 where 限定刚写入的分区范围")
    groups, excess = count_dup(con, table, key, where)
    if excess > 0:
        raise DupError(f"[{label or table}] 重复键={groups} 超额行={excess} (where: {where})")
    return True


def _count_dup_chunked(con, table: str):
    """大表分块查重: 按日(分钟K)或按年(gp)取分区值, 逐块 GROUP BY(每块内存安全)。"""
    grain, dexpr = CHUNK[table]
    key = DUP_KEYS[table]
    ks = _key_sql(key)
    vals = [r[0] for r in con.execute(f"SELECT DISTINCT {dexpr} v FROM {table} ORDER BY v").fetchall()]
    g_total = e_total = 0
    for v in vals:
        vs = str(v)
        if grain == 'day' and 'trade_time' in dexpr:
            where = f"trade_time >= TIMESTAMP '{vs} 00:00:00' AND trade_time <= TIMESTAMP '{vs} 23:59:59'"
        elif grain == 'year':
            where = f"EXTRACT(YEAR FROM \"date\") = {int(v)}"
        else:
            where = f"{dexpr} = '{vs}'"
        r = con.execute(
            f"SELECT COUNT(*), COALESCE(SUM(c-1),0) FROM "
            f"(SELECT COUNT(*) c FROM {table} WHERE {where} GROUP BY {ks} HAVING COUNT(*)>1)"
        ).fetchone()
        g_total += int(r[0] or 0)
        e_total += int(r[1] or 0)
    return g_total, e_total


def sweep(con, table: str = None, verbose: bool = True):
    """全表/单表重复巡检。大表按 CHUNK 分块防 OOM。返回 [(table, groups, excess), ...]。"""
    tables = [table] if table else list(DUP_KEYS.keys())
    out = []
    for t in tables:
        if t not in DUP_KEYS:
            if verbose:
                logger.warning(f"  {t}: 未登记自然键, 跳过")
            continue
        try:
            if t in CHUNK:
                g, e = _count_dup_chunked(con, t)
            else:
                g, e = count_dup(con, t)
            out.append((t, g, e))
            if verbose:
                flag = '✓' if e == 0 else '✗'
                logger.info(f"  {flag} {t}: 重复键={g:,} 超额={e:,}")
        except Exception as ex:
            if verbose:
                logger.error(f"  ! {t}: {ex}")
            out.append((t, -1, -1))
    return out


if __name__ == '__main__':
    # python 4_工具/data_quality_gate.py [table]
    import sys
    DB = r'K:\DB数据库_v2\db\profit_radar.duckdb'
    con = duckdb.connect(DB, read_only=True)
    con.execute("SET memory_limit='8GB'"); con.execute("SET threads=1")
    t = sys.argv[1] if len(sys.argv) > 1 else None
    print(f"=== 重复巡检 {t or '全表'} ===")
    rows = sweep(con, t)
    total_excess = sum(r[2] for r in rows if r[2] > 0)
    print(f"\n合计超额行: {total_excess:,}")
    con.close()
