"""验证 DB join + 标签逻辑(非交易时段用 mock 开盘价,DB 侧全真)

验证点:fetch_db_features 4表join SQL / merge_open_db 衍生 / label_all 标签分布
"""
import sys, random
sys.path.insert(0, r"K:\DB数据库_v2\竞价监控")
import duckdb, pandas as pd
from config import CONFIG, THRESHOLDS
import data
from engine import merge_open_db, label_all, label_cn

con = duckdb.connect(str(CONFIG.db_path), read_only=True)
pool = data.load_pool(CONFIG.pool_path)
codes = data.build_dynamic_pool(con, pool)

# DB 特征(4表join,关键验证)
db_df = data.fetch_db_features(codes, con, THRESHOLDS())
print(f"db_df shape={db_df.shape}")
print("字段非空率:")
for c in ["yest_pct", "zjl", "ltgb", "trap_cnt"]:
    nn = db_df[c].notna().sum() if c in db_df else 0
    print(f"  {c}: {nn}/{len(db_df)} ({nn/len(db_df)*100:.0f}%)")

# mock 开盘价(从 kline 取昨收作 last_close,随机开盘)
kline = con.execute("""
    SELECT code, close AS last_close FROM stock_daily_kline
    WHERE date = (SELECT MAX(date) FROM stock_daily_kline WHERE date < CURRENT_DATE)
""").fetchdf()
open_df = kline[kline["code"].isin(codes)].copy()
rng = random.Random(42)
open_df["open_price"] = open_df["last_close"] * pd.Series(
    [rng.uniform(0.95, 1.06) for _ in range(len(open_df))], index=open_df.index)
open_df["amount"] = 5e7
con.close()

# 合并 + 打标
df = merge_open_db(open_df, db_df)
df = data.filter_abnormal(df)
df = label_all(df, THRESHOLDS())

print(f"\n打标 {len(df)} 只,标签分布:")
for k, n in df["label"].value_counts().items():
    print(f"  {label_cn(k):<14} {n}")

print("\n各标签抽样(最多3只):")
for k in ["strong_continue", "trap_warning", "fund_diverge", "dip_buy", "nuclear"]:
    sub = df[df["label"] == k].head(3)
    for _, r in sub.iterrows():
        print(f"  [{label_cn(k)}] {r['code']} 开{r['open_pct']:+.1f}% 昨{r.get('yest_pct',0):+.1f}% "
              f"主力{r['zjl_ratio']*100:+.2f}%(rat) 惯骗{r['trap_cnt']} | {r['reason']}")
