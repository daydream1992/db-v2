#!/usr/bin/env python3
"""测试解析 infoharbor_block.dat 获取股票-板块关系"""

import re
from collections import defaultdict

def parse_block_file(filepath):
    """解析 infoharbor_block.dat 文件

    格式:
    #GN_板块名,数量,板块代码,开始日期,结束日期,,
    市场#股票代码,市场#股票代码,...

    市场前缀: 0=深圳, 1=上海, 2=北京
    """
    stock_to_blocks = defaultdict(list)  # stock_code -> [(block_code, block_name, block_type), ...]

    with open(filepath, 'rb') as f:
        content = f.read()

    # 尝试 GBK 解码
    text = content.decode('gbk', errors='ignore')

    current_block = None
    lines = text.split('\n')

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # 板块头: #GN_板块名,数量,板块代码,...
        if line.startswith('#GN_'):
            # 解析: #GN_板块名,数量,板块代码,开始日期,结束日期,,
            parts = line.split(',')
            if len(parts) >= 4:
                # 去掉 #GN_ 前缀
                block_name = parts[0][4:]
                block_code = parts[2]  # 板块代码如 880515.SH
                count = int(parts[1])

                # 判断板块类型
                if block_code.startswith('88'):
                    if block_code.startswith('881'):
                        block_type = '行业'
                    elif block_code.startswith('8805'):
                        block_type = '概念'
                    else:
                        block_type = '概念'
                else:
                    block_type = '指数'

                current_block = {
                    'code': block_code,
                    'name': block_name,
                    'type': block_type,
                    'count': count,
                }
            else:
                current_block = None

        # 股票行: 0#000001,0#000002,...
        elif current_block and line.startswith(('0#', '1#', '2#')):
            stocks = line.split(',')
            for stock in stocks:
                stock = stock.strip()
                if not stock or len(stock) < 8:
                    continue

                # 解析: 市场#代码
                match = re.match(r'([012])#(\d{6})', stock)
                if match:
                    market_prefix = match.group(1)
                    code = match.group(2)

                    # 转换市场前缀
                    if market_prefix == '0':
                        suffix = '.SZ'
                    elif market_prefix == '1':
                        suffix = '.SH'
                    else:
                        suffix = '.BJ'

                    stock_code = f"{code}{suffix}"

                    stock_to_blocks[stock_code].append({
                        'block_code': current_block['code'],
                        'block_name': current_block['name'],
                        'block_type': current_block['type'],
                    })

    return stock_to_blocks

if __name__ == '__main__':
    filepath = 'K:/txdlianghua/T0002/hq_cache/infoharbor_block.dat'

    print("=== 解析 infoharbor_block.dat ===")
    stock_to_blocks = parse_block_file(filepath)

    print(f"\n共解析 {len(stock_to_blocks):,} 只股票的板块归属")

    # 测试 600519.SH
    test_codes = ['600519.SH', '000001.SZ', '300308.SZ']

    for code in test_codes:
        blocks = stock_to_blocks.get(code, [])
        print(f"\n{'='*60}")
        print(f"股票: {code}")
        print(f"板块数量: {len(blocks)}")

        # 按类型分组
        by_type = defaultdict(list)
        for b in blocks:
            by_type[b['block_type']].append(b)

        for btype, items in by_type.items():
            print(f"\n【{btype}】({len(items)} 个):")
            for item in items[:5]:  # 只显示前5个
                print(f"  {item['block_code']} - {item['block_name']}")
            if len(items) > 5:
                print(f"  ... 还有 {len(items)-5} 个")