#!/usr/bin/env python3
"""更新 data_dictionary.json 字段中文映射 - 从通达信API映射表"""
import json
from pathlib import Path
from loguru import logger

# 路径
TDX_JSON = Path(r'K:\通达信量化平台说明书\通达信量化平台API返回字段中英文映射汇总.json')
DD_JSON = Path(r'K:\DB数据库_v2\config\data_dictionary.json')

# 字段名映射（数据库字段名 -> 通达信API字段名）
FIELD_ALIAS = {
    # K线 get_market_data
    'trade_date': 'Date',
    'trade_time': 'Time',
    'open': 'Open',
    'high': 'High',
    'low': 'Low',
    'close': 'Close',
    'volume': 'Volume',
    'amount': 'Amount',
}

def load_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def main():
    logger.info("加载通达信映射...")
    tdx = load_json(TDX_JSON)

    logger.info("加载现有字典...")
    dd = load_json(DD_JSON)

    # sections 包含所有接口的字段映射
    sections = tdx.get('sections', {})

    # 收集所有字段映射 {字段名: cn}
    field_map = {}
    for section_name, interfaces in sections.items():
        for interface_name, info in interfaces.items():
            if isinstance(info, dict) and 'fields' in info:
                fields = info['fields']
                for fname, fdesc in fields.items():
                    cn = fdesc.get('cn', '')
                    if cn:
                        field_map[fname] = cn

    logger.info(f"  通达信字段映射: {len(field_map)} 个")

    # 统计
    updated = 0
    skipped = 0

    # 遍历现有字典的表，更新字段cn
    for tbl_name, tbl_info in dd.items():
        if tbl_name.startswith('_') or not isinstance(tbl_info, dict):
            continue
        cols = tbl_info.get('columns', [])
        if not cols:
            continue

        for col in cols:
            col_name = col.get('name', '')
            # 先用原字段名匹配，再用别名映射到通达信字段名匹配
            cn = field_map.get(col_name, '')
            if not cn and col_name in FIELD_ALIAS:
                # 用别名查找通达信字段
                tdx_name = FIELD_ALIAS[col_name]
                cn = field_map.get(tdx_name, '')
                if cn:
                    print(f"  匹配: {tbl_name}.{col_name} -> 别名 {tdx_name} -> {cn}")
            if cn:
                # 总是更新（覆盖旧值）
                col['cn'] = cn
                updated += 1

    logger.info(f"  更新: {updated} 个字段cn")
    logger.info(f"  跳过: {skipped} 个(已有值)")

    # 保存
    dd['_meta']['generated_at'] = '2026-06-22T00:00:00'
    dd['_meta']['note'] = 'SSOT - 数据字典. 字段中文来源: 脚本FIELD_MAP(ast) > 通达信API映射 > DB dim表 > TODO'

    with open(DD_JSON, 'w', encoding='utf-8') as f:
        json.dump(dd, f, ensure_ascii=False, indent=2)

    logger.info(f"✓ 已保存到 {DD_JSON}")

    # 打印更新示例
    logger.info("\n更新示例:")
    for tbl_name, tbl_info in list(dd.items())[:3]:
        if tbl_name.startswith('_'):
            continue
        cols = tbl_info.get('columns', [])[:3]
        for c in cols:
            if c.get('cn', '') not in ('', 'TODO'):
                logger.info(f"  {tbl_name}.{c['name']} -> {c['cn']}")

if __name__ == '__main__':
    main()