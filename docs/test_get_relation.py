#!/usr/bin/env python3
"""测试 get_relation 接口返回字段"""
# @meta table=stock_block_relation cn=股票板块归属 dir=1_入库 sort=091
# @meta schedule=daily mode=full source=API(TQ)

import sys, json
from pathlib import Path

# TQ API 路径
TQ_PATHS = [
    r"K:\txdlianghua\PYPlugins\user",
    r"C:\new_tdx64\PYPlugins\user",
]
for p in TQ_PATHS:
    if Path(p).exists():
        sys.path.insert(0, p)
        break

import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
import tqcenter

def test_get_relation():
    print("=== 测试 tqcenter.tq.get_relation ===")
    try:
        tqcenter.tq.initialize(__file__)
        result = tqcenter.tq.get_relation('600519.SH')

        if not result:
            print("返回为空")
            return

        print(f"返回类型: list, 长度: {len(result)}\n")

        # 统计板块类型
        block_types = {}
        for item in result:
            bt = item.get('BlockType', '')
            block_types[bt] = block_types.get(bt, 0) + 1

        print("板块类型统计:")
        for bt, cnt in block_types.items():
            print(f"  {bt}: {cnt} 个")

        print("\n--- 每种类型的示例 ---")
        for bt in block_types:
            examples = [item for item in result if item.get('BlockType') == bt][:2]
            print(f"\n【{bt}】")
            for ex in examples:
                print(f"  {ex}")

    except Exception as e:
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    test_get_relation()