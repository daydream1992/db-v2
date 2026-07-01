"""确认 get_market_data 各 period 在集合竞价的可用性

结论预期:
- period='tick' 被 valid_periods 校验拦截(列表不含 tick)
- period='1m' 在 9:15-9:25 集合竞价期间无分钟线(没连续成交)
"""
import sys
TQ = r"K:\txdlianghua\PYPlugins\sys"
if TQ not in sys.path:
    sys.path.insert(0, TQ)
from tqcenter import tq
import pandas as pd

CODE = "600519.SH"
DATE = "20260629"


def show(label: str, data) -> None:
    print(f"  返回: type={type(data).__name__}", end="")
    if isinstance(data, dict):
        if "error" in data:
            print(f" >>> ERROR {data.get('error')}: {data.get('msg')}")
            return
        for k, v in data.items():
            if isinstance(v, pd.DataFrame):
                if v.empty:
                    print(f"  [{k}] 空 DataFrame")
                else:
                    print(f"  [{k}] shape={v.shape} 范围={v.index.min()}~{v.index.max()}")
            elif isinstance(v, dict):
                for sk, sv in v.items():
                    if isinstance(sv, pd.DataFrame):
                        if sv.empty:
                            print(f"  [{k}/{sk}] 空")
                        else:
                            print(f"  [{k}/{sk}] shape={sv.shape} 范围={sv.index.min()}~{sv.index.max()}")
                    else:
                        print(f"  [{k}/{sk}] {type(sv).__name__}")
            else:
                print(f"  [{k}] {type(v).__name__}")
    else:
        print(f" value={data}")


tq.initialize(__file__)
try:
    print("=" * 60)
    print(f"[A] {CODE} period=1m count=5  (确认接口本身能返回数据)")
    show("1m", tq.get_market_data(field_list=[], stock_list=[CODE], period="1m", count=5))

    print("\n" + "=" * 60)
    print(f"[B] {CODE} period=tick count=5  (预期被 valid_periods 拦截)")
    show("tick", tq.get_market_data(field_list=[], stock_list=[CODE], period="tick", count=5))

    print("\n" + "=" * 60)
    print(f"[C] {CODE} period=1m 今天 09:15~09:26  (集合竞价期间分钟线?)")
    show("1m集合竞价", tq.get_market_data(
        field_list=[], stock_list=[CODE], period="1m",
        start_time=f"{DATE}091500", end_time=f"{DATE}092600",
    ))

    print("\n" + "=" * 60)
    print(f"[D] {CODE} period=1m 今天 09:25~09:35  (撮合后连续竞价分钟线?)")
    show("1m连续竞价", tq.get_market_data(
        field_list=[], stock_list=[CODE], period="1m",
        start_time=f"{DATE}092500", end_time=f"{DATE}093500",
    ))
finally:
    tq.close()
print("\n[OK]")
