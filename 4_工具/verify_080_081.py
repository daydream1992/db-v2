import duckdb
con = duckdb.connect(r'K:\DB数据库_v2\db\profit_radar.duckdb', read_only=True)
con.execute("SET progress_bar_time = 999999")
for t in ('stock_kline_1m', 'stock_kline_5m'):
    print(f'=== {t} ===', flush=True)
    r = con.execute(f'SELECT MIN(DATE(trade_time)), MAX(DATE(trade_time)), COUNT(*) FROM {t}').fetchone()
    print(f'  日期范围: {r[0]} ~ {r[1]}  总行数: {r[2]:,}', flush=True)
    print('  近 5 日行数:', flush=True)
    rows = con.execute(f"""
        SELECT DATE(trade_time) AS d, COUNT(*) AS n, COUNT(DISTINCT code) AS codes
        FROM {t} WHERE trade_time >= TIMESTAMP '2026-06-26'
        GROUP BY 1 ORDER BY 1 DESC
    """).fetchall()
    for d, n, c in rows:
        print(f'    {d}  rows={n:>9,}  codes={c:>5}', flush=True)
    dup = con.execute(f"""
        SELECT COUNT(*) FROM (
            SELECT code, trade_time, COUNT(*) c
            FROM {t} WHERE trade_time >= TIMESTAMP '2026-06-26'
            GROUP BY 1, 2 HAVING c > 1
        )
    """).fetchone()[0]
    print(f'  当日重复键(code,trade_time): {dup}', flush=True)
    print(flush=True)