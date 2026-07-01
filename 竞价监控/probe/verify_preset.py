"""验证读 preset + 计算链路 + 飞书通道(mock 开盘价,DB/preset 全真)"""
import sys, random
sys.path.insert(0, r"K:\DB数据库_v2\竞价监控")
import duckdb, pandas as pd
from datetime import datetime
from config import CONFIG, THRESHOLDS
import data, notify
from engine import merge_open_db, label_all, label_cn

# 1. 读盘前预备包(验证 load_preset)
preset = data.load_preset()
print(f"preset {len(preset)}只 列数={len(preset.columns)}")
print(f"含预算列: yest_limit_up={'yest_limit_up' in preset.columns} confidence={'confidence' in preset.columns}")

# 2. mock 开盘价(从 kline 取昨收,模拟 9:25 开盘)
con = duckdb.connect(str(CONFIG.db_path), read_only=True)
kline = con.execute("""
    SELECT code, close AS last_close FROM stock_daily_kline
    WHERE date = (SELECT MAX(date) FROM stock_daily_kline WHERE date < CURRENT_DATE)
""").fetchdf()
con.close()
open_df = kline[kline["code"].isin(preset["code"])].copy()
rng = random.Random(7)
open_df["open_price"] = open_df["last_close"] * pd.Series(
    [rng.uniform(0.95, 1.06) for _ in range(len(open_df))], index=open_df.index)
open_df["amount"] = 5e7

# 3. merge + 打标(preset 已预算 yest_limit_up/confidence,engine 不重算)
df = merge_open_db(open_df, preset)
df = data.filter_abnormal(df)
df = label_all(df, THRESHOLDS())

print(f"\n打标 {len(df)}只")
print("标签分布:", df["label"].value_counts().to_dict())
print("置信度:", df["confidence"].value_counts().to_dict())
print("\nTOP10:")
for i, r in df.head(10).iterrows():
    print(f"  {r['code']:<11} {label_cn(r['label']):<10} 开{r['open_pct']:+.1f}% "
          f"昨{r.get('yest_pct',0):+.1f}% 惯骗{r['trap_cnt']} 置信{r['confidence']} | {r['reason']}")

# 4. xlsx 表格输出验证(飞书已验过,这次验本地表格文件)
import main as m
xp = m.write_xlsx(df, 15, datetime.now(), "verify")
print(f"\nxlsx 表格输出: {xp}")
