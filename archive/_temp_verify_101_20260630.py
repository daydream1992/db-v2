"""101_jb_api_plhqL2kz_88zd 入库后验收 v2 - TRY_CAST 强转数值"""
import duckdb
from pathlib import Path

DB = r'K:\DB数据库_v2\db\profit_radar.duckdb'
TABLE = 'sjb_api_plhqL2kz_88zd'

con = duckdb.connect(DB, read_only=True)
con.execute("SET progress_bar_time = 999999")

print('=' * 60)
print(f'【{TABLE} 验收】')
print('=' * 60)

# 1. 总行数 + HqDate 分布
r = con.execute(f'SELECT COUNT(*), COUNT(DISTINCT HqDate), COUNT(DISTINCT code) FROM {TABLE}').fetchone()
print(f'\n[1] 全表概览')
print(f'    总行数: {r[0]:,}')
print(f'    快照日数: {r[1]}')
print(f'    标的数:   {r[2]:,}')

print(f'\n[2] 近 7 个 HqDate')
for d, n, c in con.execute(f'''
    SELECT HqDate, COUNT(*) AS rows, COUNT(DISTINCT code) AS codes
    FROM {TABLE} GROUP BY 1 ORDER BY 1 DESC LIMIT 7
''').fetchall():
    flag = ' <-- 今日(待验)' if str(d) == '20260630' else ''
    print(f'    {d}  rows={n:>9,}  codes={c:>5}{flag}')

# 2. 重复键检查
print(f'\n[3] 重复键检查 (HqDate, code)')
dup = con.execute(f'''
    SELECT COUNT(*) FROM (
        SELECT HqDate, code, COUNT(*) c FROM {TABLE}
        GROUP BY 1, 2 HAVING c > 1
    )
''').fetchone()[0]
print(f'    重复键数: {dup} (应为 0)')

# 3. 6-30 当日 L2 主力数据 - 用 TRY_CAST 强转
print(f'\n[4] 6-30 当日 L2 主力数据 (TRY_CAST 强转)')
l2_cols = ['Zjl', 'Zjl_HB', 'TotalBVol', 'TotalSVol', 'FCAmo', 'FCb']
row_630 = con.execute(f"SELECT COUNT(*) FROM {TABLE} WHERE HqDate='20260630'").fetchone()[0]
print(f'    当日总行数: {row_630:,}')

print(f'    {"字段":12s}  {"类型":8s}  {"填充率":>14s}  {"均值":>16s}  {"最大值":>16s}')
for col in l2_cols:
    # 先查表里这列的实际类型
    col_type = con.execute(f"""
        SELECT data_type FROM information_schema.columns
        WHERE table_name='{TABLE}' AND column_name='{col}'
    """).fetchone()
    ctype = col_type[0] if col_type else 'N/A'
    # 用 TRY_CAST 尝试转 DOUBLE 算统计
    filled, total, avg_v, max_v = con.execute(f"""
        SELECT
            COUNT(TRY_CAST("{col}" AS DOUBLE)) AS filled,
            COUNT(*) AS total,
            AVG(TRY_CAST("{col}" AS DOUBLE)) AS avg_v,
            MAX(TRY_CAST("{col}" AS DOUBLE)) AS max_v
        FROM {TABLE} WHERE HqDate='20260630'
    """).fetchone()
    rate = filled / total * 100 if total else 0
    avg_s = f'{avg_v:>16,.1f}' if avg_v is not None else f'{"None":>16s}'
    max_s = f'{max_v:>16,.1f}' if max_v is not None else f'{"None":>16s}'
    print(f'    {col:12s}  {ctype:<8s}  {filled:>5,}/{total:,} ({rate:5.1f}%)  {avg_s}  {max_s}')

# 4. 抽样主力数据 - 显示可读的字段(转 DOUBLE 后)
print(f'\n[5] 主力数据抽样 (6-30 有 Zjl_HB 的,按 ABS 排序,前 5 行)')
print(f'    {"code":<12s} {"stock_type":<10s} {"Zjl":>14s} {"Zjl_HB":>14s} '
      f'{"TotalBVol":>14s} {"TotalSVol":>14s} {"FCb":>14s}')
samples = con.execute(f"""
    SELECT code, stock_type,
           TRY_CAST(Zjl AS DOUBLE), TRY_CAST(Zjl_HB AS DOUBLE),
           TRY_CAST(TotalBVol AS DOUBLE), TRY_CAST(TotalSVol AS DOUBLE),
           TRY_CAST(FCb AS DOUBLE)
    FROM {TABLE}
    WHERE HqDate='20260630' AND TRY_CAST(Zjl_HB AS DOUBLE) IS NOT NULL
    ORDER BY ABS(TRY_CAST(Zjl_HB AS DOUBLE)) DESC
    LIMIT 5
""").fetchall()
if not samples:
    print('    (无 6-30 有 Zjl_HB 数据的行)')
else:
    for code, st, zjl, zjl_hb, tbv, tsv, fcb in samples:
        def fmt(v):
            if v is None:
                return f'{"None":>14s}'
            return f'{v:>14,.1f}'
        print(f'    {str(code):<12s} {str(st):<10s} {fmt(zjl)} {fmt(zjl_hb)} '
              f'{fmt(tbv)} {fmt(tsv)} {fmt(fcb)}')

# 5. stock_type 分布
print(f'\n[6] 6-30 stock_type 分布')
for st, n in con.execute(f"""
    SELECT stock_type, COUNT(*) FROM {TABLE}
    WHERE HqDate='20260630' GROUP BY 1 ORDER BY 1
""").fetchall():
    print(f'    {st:<10s}  {n:>5,}')

# 6. parquet 文件
pq = Path(DB).parent / f'{TABLE}.parquet'
print(f'\n[7] parquet 文件')
if pq.exists():
    sz = pq.stat().st_size
    print(f'    路径: {pq}')
    print(f'    大小: {sz:,} bytes ({sz/1024/1024:.1f} MB)')
else:
    print(f'    不存在: {pq}')

# 7. 与 6-29 主力数据总量对比(确认主力数据量合理)
print(f'\n[8] 主力数据规模跨日对比')
print(f'    {"HqDate":10s}  {"Zjl_sum":>20s}  {"Zjl_HB_sum":>20s}  {"TotalBVol_sum":>20s}')
for d, zs, zhs, tbs in con.execute(f"""
    SELECT HqDate,
           SUM(TRY_CAST(Zjl AS DOUBLE)),
           SUM(TRY_CAST(Zjl_HB AS DOUBLE)),
           SUM(TRY_CAST(TotalBVol AS DOUBLE))
    FROM {TABLE}
    WHERE HqDate IN ('20260629', '20260626', '20260630')
    GROUP BY 1 ORDER BY 1 DESC
""").fetchall():
    def fmt(v):
        if v is None:
            return f'{"None":>20s}'
        return f'{v:>20,.0f}'
    print(f'    {str(d):10s}  {fmt(zs)}  {fmt(zhs)}  {fmt(tbs)}')