import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
import tqcenter
import time

tqcenter.tq.initialize(__file__)

# 测试获取概念板块列表
print('=== get_sector_list 测试 ===')
try:
    sectors = tqcenter.tq.get_sector_list(sector_type='concept')
    print(f'概念板块数量: {len(sectors) if sectors else 0}')
    if sectors and len(sectors) > 0:
        print(f'示例前3个: {sectors[:3]}')
except Exception as e:
    print(f'错误: {e}')

print()

# 测试获取板块成份股
print('=== get_stock_list_in_sector 测试 ===')
try:
    stocks = tqcenter.tq.get_stock_list_in_sector(block_code='880564.SH', list_type=0)
    print(f'白酒概念(880564.SH)成份股: {len(stocks) if stocks else 0} 只')
    if stocks and len(stocks) > 0:
        print(f'示例前5个: {stocks[:5]}')
except Exception as e:
    print(f'错误: {e}')

print()

# 估算完整概念更新的时间
print('=== 时间估算 ===')
# 获取概念数量
concept_count = len(sectors) if sectors else 0
# 假设每个板块需要 0.1s
total_time = concept_count * 0.1
print(f'概念板块数量: {concept_count}')
print(f'预计时间: {total_time:.1f} 秒')
print()
print('对比:')
print(f'  现有全量更新: ~50 分钟')
print(f'  差额更新概念: ~{total_time/60:.1f} 分钟')