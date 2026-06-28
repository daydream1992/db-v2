"""临时:用户指定 100 只一次性拉取 + 评分

运行: cd "K:\DB数据库_v2" && python "logs/probe_user100.py"
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

CODES = [
    "300650.SZ", "688093.SH", "300819.SZ", "688669.SH", "688380.SH",
    "688381.SH", "300223.SZ", "688376.SH", "002303.SZ", "000100.SZ",
    "002141.SZ", "600516.SH", "600500.SH", "002387.SZ", "600903.SH",
    "600579.SH", "603313.SH", "603335.SH", "605300.SH", "600888.SH",
    "000818.SZ", "600668.SH", "002928.SZ", "002579.SZ", "002056.SZ",
    "603500.SH", "605366.SH", "600962.SH", "002068.SZ", "600186.SH",
    "600458.SH", "600857.SH", "600330.SH", "603063.SH", "000048.SZ",
    "603067.SH", "600141.SH", "603989.SH", "002787.SZ", "002965.SZ",
    "603713.SH", "000766.SZ", "002518.SZ", "000636.SZ", "002980.SZ",
    "000962.SZ", "002080.SZ", "603929.SH", "603115.SH", "603678.SH",
    "600584.SH", "001330.SZ", "600058.SH", "001309.SZ", "000034.SZ",
    "603267.SH", "605318.SH", "603527.SH", "603065.SH", "002990.SZ",
    "002025.SZ", "600522.SH", "603661.SH", "002484.SZ", "603019.SH",
    "603459.SH", "603800.SH", "002558.SZ", "600667.SH", "605589.SH",
    "600184.SH", "600237.SH", "000823.SZ", "002842.SZ", "603690.SH",
    "002674.SZ", "603010.SH", "603733.SH", "002654.SZ", "002254.SZ",
    "600228.SH", "601798.SH", "000783.SZ", "600152.SH", "603956.SH",
    "605376.SH", "000811.SZ", "600608.SH", "301566.SZ", "605358.SH",
    "300710.SZ", "601099.SH", "002925.SZ", "300041.SZ",
]


def main():
    tq.initialize(__file__)
    try:
        print(f"目标: {len(CODES)} 只")
        rows = []
        for i, code in enumerate(CODES, 1):
            snap = safe_snapshot(code)
            if not snap:
                continue
            last_close = snap.get("last_close", 0) or 0
            now = snap.get("now", 0) or 0
            amount = snap.get("amount", 0.0) or 0.0
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
            if i % 20 == 0:
                print(f"  {i}/{len(CODES)}")

        df = pd.DataFrame(rows)
        print(f"拉到非空: {len(df)}")
        scored = score_all(df, THRESHOLDS)

        print(f"\n=== 用户指定 100 只 @ {datetime.now().strftime('%H:%M:%S')} ===")
        for i, r in scored.head(20).iterrows():
            print(
                f"  {i+1:>3}. {r['code']:<11} score={r['score']:>5.1f}  "
                f"mode={r['mode']:<7}  pct={r['pct']:>+6.2f}%  "
                f"amt={r['amount']/10000:>8.1f}万"
            )

        print(f"\n模式分布: {scored['mode'].value_counts().to_dict()}")

        # 落盘一份 MD 备查
        out_md = rf"K:\DB数据库_v2\reports\probe_user100_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(out_md, "w", encoding="utf-8") as f:
            f.write(f"# 用户指定 100 只快照 @ {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
            f.write(f"- 总数: {len(scored)}\n")
            for m in ("trend", "dip", "weak", "anomaly"):
                f.write(f"- {m}: {(scored['mode']==m).sum()}\n")
            f.write(f"\n## TOP 20\n\n")
            f.write("| RK | CODE | SCORE | MODE | PCT% | AMT(万) |\n")
            f.write("|---:|------|------:|------|-----:|--------:|\n")
            for i, r in scored.head(20).iterrows():
                f.write(f"| {i+1} | {r['code']} | {r['score']:.1f} | {r['mode']} | {r['pct']:+.2f} | {r['amount']/10000:.1f} |\n")
        print(f"\nMD: {out_md}")

    finally:
        try:
            tq.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
