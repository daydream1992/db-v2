import sys
TQ = r"K:\txdlianghua\PYPlugins\sys"
if TQ not in sys.path:
    sys.path.insert(0, TQ)
from tqcenter import tq

tq.initialize(__file__)
lst = tq.get_stock_list(market="5", list_type=1)
print("type:", type(lst))
print("count:", len(lst))
print("first 3:", lst[:3])
print("element type:", type(lst[0]))
tq.close()
