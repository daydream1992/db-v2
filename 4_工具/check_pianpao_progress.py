import duckdb

con = duckdb.connect('db/profit_radar.duckdb', read_only=True)
periods = {
    "2025Q1": ("2025-01-01", "2025-03-31"),
    "2025Q2": ("2025-04-01", "2025-06-30"),
    "2025Q3": ("2025-07-01", "2025-09-30"),
    "2025Q4": ("2025-10-01", "2025-12-31"),
    "2026":   ("2026-01-01", "2026-06-22"),
}
total_done, total_need = 0, 0
for name, (s, e) in periods.items():
    need = con.execute(
        "SELECT COUNT(*) FROM trading_calendar WHERE date BETWEEN ? AND ? AND is_trading=TRUE",
        [s, e]).fetchone()[0]
    done = con.execute(
        "SELECT COUNT(DISTINCT trade_date) FROM pianpao_daily_summary WHERE trade_date BETWEEN ? AND ?",
        [s, e]).fetchone()[0]
    total_done += done
    total_need += need
    pct = f"{done*100//need}%" if need > 0 else "-"
    print(f"  {name}: {done}/{need}天 ({pct})")
print(f"  总: {total_done}/{total_need}天 ({total_done*100//total_need if total_need>0 else 0}%)")

print("\n=== 日历 vs summary 日期一致性 (gap days) ===")
gap = con.execute("""
SELECT MIN(trade_date), MAX(trade_date), COUNT(*) FROM pianpao_daily_summary
""").fetchone()
print(f"  summary 区间: {gap[0]} ~ {gap[1]}, 共 {gap[2]} 天")
missing = con.execute("""
SELECT COUNT(*) FROM trading_calendar tc
WHERE tc.is_trading=TRUE
  AND tc.date BETWEEN '2025-01-01' AND '2026-06-22'
  AND NOT EXISTS (SELECT 1 FROM pianpao_daily_summary s WHERE s.trade_date=tc.date)
""").fetchone()[0]
print(f"  日历有但 summary 没有的交易日: {missing} 天")

# 找出最早缺失日 + 最新缺失日
earliest_miss = con.execute("""
SELECT MIN(tc.date) FROM trading_calendar tc
WHERE tc.is_trading=TRUE
  AND tc.date BETWEEN '2025-01-01' AND '2026-06-22'
  AND NOT EXISTS (SELECT 1 FROM pianpao_daily_summary s WHERE s.trade_date=tc.date)
""").fetchone()[0]
latest_miss = con.execute("""
SELECT MAX(tc.date) FROM trading_calendar tc
WHERE tc.is_trading=TRUE
  AND tc.date BETWEEN '2025-01-01' AND '2026-06-22'
  AND NOT EXISTS (SELECT 1 FROM pianpao_daily_summary s WHERE s.trade_date=tc.date)
""").fetchone()[0]
print(f"  缺失区间: {earliest_miss} ~ {latest_miss}")

con.close()