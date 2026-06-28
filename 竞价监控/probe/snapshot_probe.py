"""临时测试:探测 get_market_snapshot 实际返回字段
运行后看输出,会保留在 logs/ 下供查阅
"""
import sys
import json
from datetime import datetime

TQ_SYS_PATH = r"K:\txdlianghua\PYPlugins\sys"
if TQ_SYS_PATH not in sys.path:
    sys.path.insert(0, TQ_SYS_PATH)

from tqcenter import tq  # noqa: E402

# 用 3 只不同类型股票探测
TEST_CODES = ["600519.SH", "300750.SZ", "000001.SZ"]

tq.initialize(__file__)
try:
    out = {"ts": datetime.now().isoformat(), "codes": {}}
    for code in TEST_CODES:
        try:
            data = tq.get_market_snapshot(stock_code=code, field_list=[])
            out["codes"][code] = {
                "raw_keys": sorted(data.keys()) if data else [],
                "raw_sample": {k: data.get(k) for k in list(data.keys())[:30]} if data else None,
                "all_values_truncated": {k: (str(v)[:50] if v else v) for k, v in data.items()} if data else None,
            }
        except Exception as e:
            out["codes"][code] = {"error": str(e)}

    # 打印概览
    print("=" * 60)
    print(f"探测时刻: {out['ts']}")
    print("=" * 60)
    for code, info in out["codes"].items():
        print(f"\n--- {code} ---")
        if "error" in info:
            print(f"  ERROR: {info['error']}")
        else:
            keys = info["raw_keys"]
            print(f"  字段数: {len(keys)}")
            print(f"  全部字段: {keys}")
            print(f"  值样例:")
            for k, v in info["all_values_truncated"].items():
                print(f"    {k}: {v}")
finally:
    try:
        tq.close()
    except Exception:
        pass

# 落盘到 logs/ 方便后续查阅
import os
os.makedirs(r"K:\DB数据库_v2\logs", exist_ok=True)
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
log_path = rf"K:\DB数据库_v2\logs\snapshot_probe_{stamp}.json"
with open(log_path, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=2, default=str)
print(f"\n[OK] 落盘: {log_path}")
