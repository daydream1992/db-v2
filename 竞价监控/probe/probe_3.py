"""临时:大族激光/中国长城/圣阳股份 三只实时拉取

运行: cd "K:/DB数据库_v2" && python "竞价监控/probe/probe_3.py"
"""
import sys
from datetime import datetime

TQ = r"K:\txdlianghua\PYPlugins\sys"
if TQ not in sys.path:
    sys.path.insert(0, TQ)

from tqcenter import tq  # noqa: E402

sys.path.insert(0, r"K:\DB数据库_v2\竞价监控")
from config import THRESHOLDS  # noqa: E402
from data import safe_snapshot  # noqa: E402
from engine import score_all  # noqa: E402

import pandas as pd  # noqa: E402

# 大族激光 / 中国长城 / 圣阳股份
CODES = ["002008.SZ", "000066.SZ", "002580.SZ"]
NAMES = {"002008.SZ": "大族激光", "000066.SZ": "中国长城", "002580.SZ": "圣阳股份"}


def main():
    tq.initialize(__file__)
    try:
        rows = []
        for code in CODES:
            snap = safe_snapshot(code)
            if not snap:
                print(f"{code} 取数失败")
                continue
            last_close = snap.get("last_close", 0) or 0
            now = snap.get("now", 0) or 0
            amount = snap.get("amount", 0.0) or 0.0
            volume = snap.get("volume", 0) or 0
            pct = (now - last_close) / last_close * 100 if last_close > 0 else 0.0
            rows.append({
                "code": code,
                "last_close": last_close,
                "s1_price": now, "s2_price": now, "s3_price": now,
                "real_vol": 0,
                "amount": amount,
                "pct": pct,
                "trap_ratio": 1.0,
            })
            # 打印 raw 关键字段
            print(f"\n--- {code} {NAMES[code]} @ {datetime.now().strftime('%H:%M:%S')} ---")
            print(f"  昨收={last_close}  现价={now}  开盘={snap.get('open',0)}")
            print(f"  最高={snap.get('high',0)}  最低={snap.get('low',0)}")
            print(f"  总手={volume}  金额={amount:.0f}元({amount/10000:.2f}万)")
            print(f"  涨幅={pct:+.2f}%")

        df = pd.DataFrame(rows)
        if df.empty:
            print("全部取数失败")
            return
        scored = score_all(df, THRESHOLDS)
        print(f"\n=== 三只评分 ===")
        for _, r in scored.iterrows():
            print(f"  {r['code']} {NAMES.get(r['code'],'')}  score={r['score']:.1f}  "
                  f"mode={r['mode']}  pct={r['pct']:+.2f}%  {r['reason']}")
    finally:
        try:
            tq.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
