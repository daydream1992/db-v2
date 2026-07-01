#!/usr/bin/env python3
"""探测订阅池快照字段(盘中跑, 确认 Before5MinNow/Zangsu/Buyv/Sellv 等存在)

用法: python probe.py
落盘: K:\\DB数据库_v2\\logs\\intraday_probe_<ts>.json
非交易时段快照为空属正常(Now=0), 字段名仍可从 keys 看到。
"""
import json
import os
import sys
from datetime import datetime

from config import CONFIG
import data

codes = data.load_pool(CONFIG.pool_path)
if not codes:
    print("订阅池为空"); sys.exit(1)
print(f"探测 {len(codes)} 只: {codes}")

tq = data.tq
if tq is None:
    print("tqcenter 未加载"); sys.exit(1)

tq.initialize(__file__)
out: dict = {"ts": datetime.now().isoformat(), "codes": {}}
try:
    for code in codes:
        try:
            d = tq.get_market_snapshot(stock_code=code, field_list=[])
            if d:
                out["codes"][code] = {
                    "keys": sorted(d.keys()),
                    "sample": {k: str(v)[:60] for k, v in d.items()},
                }
            else:
                out["codes"][code] = {"error": "empty(可能非交易时段)"}
        except Exception as e:  # noqa: BLE001
            out["codes"][code] = {"error": str(e)}
finally:
    try:
        tq.close()
    except Exception:  # noqa: BLE001
        pass

WANT = ["Now", "LastClose", "Before5MinNow", "Zangsu", "Volume", "NowVol",
        "Inside", "Outside", "Buyp", "Buyv", "Sellp", "Sellv"]
print("=" * 60)
for code, info in out["codes"].items():
    print(f"\n--- {code} ---")
    keys = info.get("keys", [])
    miss = [k for k in WANT if k not in keys]
    print(f"  字段数={len(keys)} 关键字段缺失={miss or '无'}")
    for k in ["Now", "LastClose", "Before5MinNow", "Zangsu", "Sellv"]:
        print(f"  {k}={info.get('sample', {}).get(k)}")

os.makedirs(r"K:\DB数据库_v2\logs", exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
path = rf"K:\DB数据库_v2\logs\intraday_probe_{stamp}.json"
with open(path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2, default=str)
print(f"\n[OK] 落盘: {path}")
