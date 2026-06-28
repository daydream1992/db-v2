import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
import tqcenter

tqcenter.tq.initialize(__file__)

# get_sector_list 参数是 list_type
# 0=行业, 1=概念, 2=地区, 3=指数

print('=== 获取各类板块列表 ===')
for lt, name in [(0, '行业'), (1, '概念'), (2, '地区'), (3, '指数')]:
    result = tqcenter.tq.get_sector_list(list_type=lt)
    count = len(result) if result else 0
    print(f'{name}(list_type={lt}): {count} 个板块')
    if result and count > 0:
        print(f'  示例: {result[0]}')