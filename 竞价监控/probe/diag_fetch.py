import sys
sys.path.insert(0, r"K:\txdlianghua\PYPlugins\sys")
sys.path.insert(0, r"K:\DB数据库_v2\竞价监控")
from tqcenter import tq
import data

preset = data.load_preset()
codes = preset["code"].tolist()

tq.initialize(__file__)
ok = 0
fail_samples = []
for i, code in enumerate(codes):
    try:
        d = tq.get_market_snapshot(stock_code=code, field_list=[])
        now = float(d.get("Now", 0) or 0) if d else 0
        if d and d.get("ErrorId") == 0 and now > 0:
            ok += 1
        elif len(fail_samples) < 3:
            fail_samples.append(f"{code}: ErrorId={d.get('ErrorId') if d else '空dict'} Now={d.get('Now') if d else '-'}")
    except Exception as e:
        if len(fail_samples) < 3:
            fail_samples.append(f"{code}: 异常 {e}")
tq.close()
print(f"全量 {len(codes)} 只: 成功 {ok}, 失败 {len(codes)-ok}")
print("失败样例:", fail_samples)
