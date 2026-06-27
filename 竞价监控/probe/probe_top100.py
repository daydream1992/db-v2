"""临时:全市场前 100 一次性拉取 + 评分

口径: tq.get_stock_list('5', list_type=1) → 按 code 字典序 → 前 100
不做换手率/市值筛选(临时脚本求稳,不引入额外假设)

运行:
    cd "K:\DB数据库_v2\竞价监控"
    python ..\logs\probe_top100.py
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
from engine import score_all, score_row  # noqa: E402

import pandas as pd  # noqa: E402


def main():
    tq.initialize(__file__)
    try:
        # 1. 全市场股票列表
        all_list = tq.get_stock_list(market="5", list_type=1)
        if not all_list:
            print("ERROR: get_stock_list 返回空")
            return
        print(f"全市场共 {len(all_list)} 只")

        # list_type=1 返回 [{Code, Name}, ...],  按 Code 字典序
        all_list_sorted = sorted(all_list, key=lambda x: x["Code"])
        top100 = all_list_sorted[:100]
        codes = [c["Code"] for c in top100]
        print(f"取前 {len(codes)} 只: {codes[0]} ... {codes[-1]}")

        # 2. 串行 snapshot(单股 ~0.025s, 100 只 ~3s)
        rows = []
        for i, code in enumerate(codes, 1):
            snap = safe_snapshot(code)
            if not snap:
                continue
            # 单时刻数据: s1=s2=s3 (无三时刻差)
            last_close = snap.get("last_close", 0) or 0
            now = snap.get("now", 0) or 0
            volume = snap.get("volume", 0) or 0
            amount = snap.get("amount", 0.0) or 0.0
            pct = (now - last_close) / last_close * 100 if last_close > 0 else 0.0
            row = {
                "code": code,
                "last_close": last_close,
                "s1_price": now,  # 临时:用现价当三时刻
                "s2_price": now,
                "s3_price": now,
                "real_vol": 0,  # 单时刻无增量
                "amount": amount,
                "pct": pct,
                "trap_ratio": 1.0,  # 单时刻无差异
            }
            rows.append(row)
            if i % 20 == 0:
                print(f"  {i}/{len(codes)}")

        df = pd.DataFrame(rows)
        print(f"\n拉到 {len(df)} 只非空快照")

        # 3. 评分
        scored = score_all(df, THRESHOLDS)

        # 4. 输出 TOP 20
        print(f"\n=== 全市场前 100 (按 code 字典序) @ {datetime.now().strftime('%H:%M:%S')} ===")
        for i, r in scored.head(20).iterrows():
            print(
                f"  {i+1:>3}. {r['code']:<11} score={r['score']:>5.1f}  "
                f"mode={r['mode']:<7}  pct={r['pct']:>+6.2f}%  "
                f"amt={r['amount']/10000:>8.1f}万"
            )

        # 5. 模式分布
        print(f"\n模式分布: {scored['mode'].value_counts().to_dict()}")

    finally:
        try:
            tq.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
