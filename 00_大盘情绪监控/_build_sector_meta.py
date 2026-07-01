#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_build_sector_meta.py — 一次性预处理:把 6 类原始板块 JSON 压成单索引文件
    输入(用户导出的快照,命名含日期戳):
      {行业,概念,风格,地区,指数}板块列表_*.json       板块目录
      {行业,概念,风格,地区,指数}板块_个股_*.json       板块→成分股
      股票行业三级分类_*.json                          个股→三级行业
    输出:sector_meta_compact.json(运行时 sector_meta.py 加载)
    索引:
      code_to_type:   {板块代码: [类型, 名称]}
      stock_to_sectors: {个股: [[板块代码,类型,名称], ...]}   含全部5类板块
      stock_to_ind3:  {个股: [一级, 二级, 三级]}
      stock_name:     {个股: 名称}   (从板块_个股顺带提取)
    用法:python _build_sector_meta.py
"""
from __future__ import annotations
import json
import glob
from pathlib import Path

DIR = Path(__file__).resolve().parent

# 类型 → (列表文件glob, 个股文件glob)
TYPES = {
    '行业': ('行业板块列表_*.json', '行业板块_个股_*.json'),
    '概念': ('概念板块列表_*.json', '概念板块_个股_*.json'),
    '风格': ('风格板块列表_*.json', '风格板块_个股_*.json'),
    '地区': ('地区板块列表_*.json', '地区板块_个股_*.json'),
    '指数': ('指数板块列表_*.json', '指数板块_个股_*.json'),
}


def latest(pattern: str) -> Path | None:
    files = sorted(glob.glob(str(DIR / pattern)))
    return Path(files[-1]) if files else None


def load(p: Path) -> list:
    return json.loads(p.read_text(encoding='utf-8'))


def main() -> int:
    code_to_type: dict[str, list] = {}
    stock_to_sectors: dict[str, list] = {}
    stock_name: dict[str, str] = {}

    for btype, (list_pat, mem_pat) in TYPES.items():
        # 列表:板块代码→名称
        lp = latest(list_pat)
        if not lp:
            print(f"  跳过 {btype}: 无列表文件 {list_pat}")
            continue
        names = {}
        for it in load(lp):
            bc, bn = it.get('block_code', ''), it.get('block_name', '')
            if bc:
                names[bc] = bn
                code_to_type[bc] = [btype, bn]
        # 个股:板块→成分股,反建成 个股→板块
        mp = latest(mem_pat)
        if not mp:
            print(f"  跳过 {btype} 个股: 无 {mem_pat}")
            continue
        for blk in load(mp):
            bc = blk.get('block_code', '')
            bn = blk.get('block_name', '') or names.get(bc, '')
            if bc and bc not in code_to_type:
                code_to_type[bc] = [btype, bn]
            for s in blk.get('stocks', []) or []:
                code = s.get('code', '')
                if not code:
                    continue
                if s.get('name'):
                    stock_name[code] = s['name']
                stock_to_sectors.setdefault(code, []).append([bc, btype, bn])
        print(f"  {btype}: {len(names)}板块, 累计个股{len(stock_to_sectors)}")

    # 三级行业分类(两个文件重复,只读一个)
    p3 = latest('股票行业三级分类_*.json')
    stock_to_ind3: dict[str, list] = {}
    if p3:
        for it in load(p3):
            code = it.get('stock_code', '')
            if code:
                stock_to_ind3[code] = [it.get('行业一级', ''), it.get('行业二级', ''), it.get('行业三级', '')]
        print(f"  三级行业: {len(stock_to_ind3)} 只股")

    out = {
        'code_to_type': code_to_type,
        'stock_to_sectors': stock_to_sectors,
        'stock_to_ind3': stock_to_ind3,
        'stock_name': stock_name,
    }
    op = DIR / 'sector_meta_compact.json'
    op.write_text(json.dumps(out, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    size_mb = op.stat().st_size / 1024 / 1024
    print(f"\n输出: {op}  ({size_mb:.2f} MB)")
    print(f"  板块{len(code_to_type)} / 个股板块映射{len(stock_to_sectors)} / 三级行业{len(stock_to_ind3)} / 个股名{len(stock_name)}")
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
