#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sector_meta.py — 板块元数据 运行时加载器
    启动时一次性加载 sector_meta_compact.json(_build_sector_meta.py 产出)
    提供 4 个索引:板块→类型 / 个股→板块列表 / 个股→三级行业 / 个股→名称
    替代运行时 get_relation + tag_block_type(省 ~4s)
    原始 JSON 很少更新(概念偶尔),变了重跑 _build_sector_meta.py
"""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path

COMPACT_PATH = Path(__file__).resolve().parent / 'sector_meta_compact.json'

_cache: dict | None = None


def _load() -> dict:
    global _cache
    if _cache is None:
        if not COMPACT_PATH.exists():
            raise FileNotFoundError(
                f"{COMPACT_PATH} 不存在,先跑 _build_sector_meta.py 生成")
        _cache = json.loads(COMPACT_PATH.read_text(encoding='utf-8'))
    return _cache


def block_type(code: str) -> tuple[str, str]:
    """板块代码 → (类型, 名称)。未知返 ('', '')"""
    v = _load()['code_to_type'].get(code, ['', ''])
    return v[0], v[1]


def stock_sectors(code: str) -> list[list]:
    """个股 → 所属全部板块 [[板块代码,类型,名称], ...]"""
    return _load()['stock_to_sectors'].get(code, [])


def stock_industry3(code: str) -> tuple[str, str, str]:
    """个股 → 三级行业 (一级, 二级, 三级)"""
    v = _load()['stock_to_ind3'].get(code, ['', '', ''])
    return v[0], v[1], v[2]


def stock_name(code: str) -> str:
    """个股 → 名称"""
    return _load()['stock_name'].get(code, '')


def all_block_codes(btype: str | None = None) -> list[str]:
    """全部板块代码,可按类型过滤"""
    ct = _load()['code_to_type']
    if btype is None:
        return list(ct.keys())
    return [c for c, (t, _) in ct.items() if t == btype]


def mainline_sectors_of_stock(code: str, mainline_codes: set[str]) -> list[tuple]:
    """个股 → 命中的主线板块 [(板块代码,类型,名称), ...]
       用于行业×概念共振检测"""
    out = []
    for bc, bt, bn in stock_sectors(code):
        if bc in mainline_codes:
            out.append((bc, bt, bn))
    return out


if __name__ == '__main__':
    # 自检
    print("板块类型示例:")
    for c in ['881338.SH', '880506.SH', '880531.SH', '880218.SH', '999999.SH']:
        print(f"  {c} -> {block_type(c)}")
    print("\n000070.SZ 三级行业:", stock_industry3('000070.SZ'))
    print("000070.SZ 名称:", stock_name('000070.SZ'))
    print("000070.SZ 板块数:", len(stock_sectors('000070.SZ')))
    print("各类型板块数:",
          {t: len(all_block_codes(t)) for t in ['行业', '概念', '风格', '地区', '指数']})
