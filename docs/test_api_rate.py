#!/usr/bin/env python3
"""测试 API 限流"""

import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
import tqcenter
import time

tqcenter.tq.initialize(__file__)

test_codes = ['600519.SH', '000001.SZ', '300308.SZ', '000002.SZ', '600000.SH']

print('=== API 限流测试 ===')
print(f'限流: ≤5次/秒')
print()

times = []
for code in test_codes:
    start = time.time()
    result = tqcenter.tq.get_relation(code)
    elapsed = time.time() - start
    times.append(elapsed)
    count = len(result) if result else 0
    print(f'{code}: {elapsed:.3f}s, 返回 {count} 条')

avg = sum(times) / len(times)
print()
print(f'平均单次耗时: {avg:.3f}s')
print(f'理论最大 QPS: {1/avg:.1f}')
print()
print(f'全量5000只预计: {5000 * avg:.0f}秒 = {5000 * avg / 60:.1f}分钟')
print()
print('--- 加 0.2s 延时后的 QPS ---')
effective_qps = 1 / (avg + 0.2)
print(f'加0.2s延时后 QPS: {effective_qps:.2f}')
print(f'全量5000只预计: {5000 / effective_qps:.0f}秒 = {5000 / effective_qps / 60:.1f}分钟')

# 计算需要多少批次
total_stocks = 5000
batch_size = 100
batches = (total_stocks + batch_size - 1) // batch_size
time_per_batch = batch_size * (avg + 0.2)
print()
print(f'分批执行 ({batch_size}只/批):')
print(f'  共 {batches} 批')
print(f'  每批耗时: {time_per_batch:.1f}s')
print(f'  总耗时: {batches * time_per_batch / 60:.1f}分钟')