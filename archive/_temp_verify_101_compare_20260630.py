"""B: 6-29 vs 6-30 板块 Zjl 对比,判断是不是市场真信号"""
import duckdb
con = duckdb.connect(r'K:\DB数据库_v2\db\profit_radar.duckdb', read_only=True)
con.execute("SET progress_bar_time = 999999")

days = ['20260629', '20260630']
for d in days:
    print(f'=== {d} 板块 Zjl Top 10 (按主力净流入 Zjl_HB 绝对值降序) ===')
    print(f'  {"code":12s} {"Zjl":>16s} {"Zjl_HB":>16s} {"ZAF%":>8s} {"FCb":>8s}')
    rows = con.execute(f"""
        SELECT code,
               TRY_CAST(Zjl AS DOUBLE) AS Zjl,
               TRY_CAST(Zjl_HB AS DOUBLE) AS Zjl_HB,
               TRY_CAST(ZAF AS DOUBLE) AS ZAF,
               TRY_CAST(FCb AS DOUBLE) AS FCb
        FROM sjb_api_plhqL2kz_88zd
        WHERE HqDate='{d}' AND stock_type='sector'
          AND TRY_CAST(Zjl_HB AS DOUBLE) IS NOT NULL
        ORDER BY ABS(TRY_CAST(Zjl_HB AS DOUBLE)) DESC
        LIMIT 10
    """).fetchall()
    for code, zjl, hb, zaf, fcb in rows:
        def f(v):
            if v is None: return '   None'
            return f'{v:>16,.0f}' if isinstance(v, (int, float)) and abs(v) > 100 else f'{v:>8.2f}'
        print(f'  {str(code):12s} {f(zjl)} {f(hb)} {f(zaf)} {f(fcb)}')
    print()

# 关键统计:板块 Zjl 总量(确认 46 倍差异主要是板块加总导致)
print('=== 板块主力净流入跨日对比 (Zjl / Zjl_HB) ===')
print(f'  {"日期":10s}  {"板块Zjl总和":>20s}  {"板块Zjl_HB总和":>20s}  {"个股Zjl总和":>20s}')
for d in days:
    sec_zjl, sec_hb, stk_zjl, stk_hb = con.execute(f"""
        SELECT
            SUM(TRY_CAST(Zjl AS DOUBLE)) FILTER (WHERE stock_type='sector'),
            SUM(TRY_CAST(Zjl_HB AS DOUBLE)) FILTER (WHERE stock_type='sector'),
            SUM(TRY_CAST(Zjl AS DOUBLE)) FILTER (WHERE stock_type='stock'),
            SUM(TRY_CAST(Zjl_HB AS DOUBLE)) FILTER (WHERE stock_type='stock')
        FROM sjb_api_plhqL2kz_88zd
        WHERE HqDate='{d}'
    """).fetchone()
    def f(v):
        if v is None: return f'{"None":>20s}'
        return f'{v:>20,.0f}'
    print(f'  {d:10s}  {f(sec_zjl)}  {f(sec_hb)}  {f(stk_zjl)}')