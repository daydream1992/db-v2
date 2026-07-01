#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""sector_monitor.py — 板块层(定方向)
    4 类板块(行业/概念/风格/地域)统一采集 + 主线候选 + 退潮预警 + 强度分 + 行业×概念共振
    阈值见 _common.TH(用户填 __TODO__)
"""
from __future__ import annotations
from typing import Any
import _common
from _common import TH, _f


def collect(tq, sector_codes: list[str]) -> list[dict]:
    """采集板块:snapshot(涨跌家数+Max) + more_info(涨幅/主力/ZTGPNum/动量)"""
    rows = []
    for code in sector_codes:
        row = {'code': code, 'name': '', 'btype': ''}
        try:
            snap = tq.get_market_snapshot(stock_code=code, field_list=[])
            row['up'] = int(_f(snap, 'UpHome'))
            row['down'] = int(_f(snap, 'DownHome'))
            row['max'] = _f(snap, 'Max')
        except Exception:
            row['up'] = row['down'] = 0; row['max'] = 0.0
        try:
            info = tq.get_more_info(stock_code=code, field_list=[])
            row['zt_num'] = int(_f(info, 'ZTGPNum'))   # 板块涨停家数(条件填充)
            row['zaf'] = _f(info, 'ZAF')
            row['zjl'] = _f(info, 'Zjl')
            row['zaf_pre5'] = _f(info, 'ZAFPre5')
            row['zaf_pre20'] = _f(info, 'ZAFPre20')
            row['zaf_pre60'] = _f(info, 'ZAFPre60')
        except Exception:
            row['zt_num'] = 0; row['zaf'] = row['zjl'] = 0.0
            row['zaf_pre5'] = row['zaf_pre20'] = row['zaf_pre60'] = 0.0
        rows.append(row)
    # 批量补 name + btype(get_relation 太贵,用 get_stock_info 单查或外部表)
    return rows


def tag_block_type(tq, rows: list[dict]) -> None:
    """【已废弃】运行时 get_relation 反查,4s。
       改用 sector_meta.block_type 静态查表,见 tag_block_type_static"""
    pass


def tag_block_type_static(rows: list[dict]) -> None:
    """静态查表打 BlockType 标签(毫秒级,替代 tag_block_type)
       依赖 sector_meta.py 加载的 compact 索引"""
    import sector_meta
    for row in rows:
        bt, bn = sector_meta.block_type(row['code'])
        row['btype'] = bt
        row['name'] = bn


# ─── 信号判定 ───
def is_mainline(row: dict, index_zaf: float) -> bool:
    """主线候选:涨停≥N + 涨幅>大盘 + 主力净流入 + 5日动量>0"""
    return (row['zt_num'] >= TH.SECTOR_MAIN_ZT
            and row['zaf'] > index_zaf + TH.SECTOR_MAIN_ZAF_GT
            and row['zjl'] > TH.SECTOR_MAIN_FLOW_IN
            and row['zaf_pre5'] > TH.SECTOR_MAIN_MOM5)


def is_retreat(row: dict, zt_drop_ratio: float | None) -> bool:
    """退潮预警:涨停数较前日腰斩 / 5日动量转负"""
    cond_drop = (zt_drop_ratio is not None and zt_drop_ratio > TH.SECTOR_RETREAT_ZT_DROP)
    cond_mom = row['zaf_pre5'] < TH.SECTOR_RETREAT_MOM5
    return cond_drop or cond_mom


def strength_score(row: dict, max_flow: float) -> float:
    """板块强度分(加权)。max_flow 用于主力归一"""
    flow_n = (row['zjl'] / max_flow) if max_flow > 0 else 0
    lb2 = row.get('lb2_cnt', 0)  # 盘后 BK14 才有,盘中 0
    return (row['zt_num'] * TH.SECTOR_W_ZT
            + row['zaf'] * TH.SECTOR_W_ZAF
            + flow_n * TH.SECTOR_W_FLOW
            + lb2 * TH.SECTOR_W_LB2)


# ─── 行业 × 概念共振(双强买点)───
def detect_resonance(stock_to_sectors: dict[str, list[dict]],
                     mainline_codes: set[str]) -> list[dict]:
    """个股同时属≥2 个主线板块(行业+概念双强)= 共振买点
       stock_to_sectors: {code: [{code,btype}, ...]} 来自 get_relation
       mainline_codes: 主线板块代码集"""
    res = []
    for code, sectors in stock_to_sectors.items():
        strong = [s for s in sectors if s['code'] in mainline_codes]
        btypes = {s.get('btype', '') for s in strong}
        # 行业+概念 双共振(用户可调:要几类、要哪几类)
        if len(btypes) >= 2:  # __TODO__(建议:2) 至少 2 类主线共振
            res.append({'code': code, 'strong_sectors': strong})
    return res


def rank(rows: list[dict], index_zaf: float, max_flow: float) -> list[dict]:
    """板块强度排名"""
    for r in rows:
        r['score'] = strength_score(r, max_flow)
        r['is_mainline'] = is_mainline(r, index_zaf)
    return sorted(rows, key=lambda x: x['score'], reverse=True)


# ─── 概念题材榜(按概念聚合涨停/连板强度)───
def concept_hot_board(pools_lb: list[dict], pools_sb: list[dict],
                      concept_codes: set[str]) -> list[dict]:
    """概念题材温度榜:把涨停股(首板+连板)按所属概念聚合
       pools_lb/pools_sb: 连板梯队/首板池(含 code)
       concept_codes: 概念板块代码集(从 sector_meta 拿)
       返回 [{概念, 涨停家数, 连板股数, 连板总高}] 按热度排"""
    import sector_meta
    agg: dict[str, dict] = {}
    # 遍历涨停股,每只股的所有概念板块都+1(一只股属多概念都计)
    for r in pools_lb + pools_sb:
        code = r.get('code', '')
        lb = r.get('lb', 0)
        for bc, bt, bn in sector_meta.stock_sectors(code):
            if bc not in concept_codes:
                continue
            d = agg.setdefault(bn, {'code': bc, 'name': bn, 'zt_cnt': 0, 'lb_cnt': 0, 'lb_sum': 0})
            d['zt_cnt'] += 1
            if lb >= 2:
                d['lb_cnt'] += 1
                d['lb_sum'] += lb
    return sorted(agg.values(), key=lambda x: (x['zt_cnt'], x['lb_sum']), reverse=True)


# ─── 行业×概念共振(双强买点)───
def detect_industry_concept_resonance(pools_lb: list[dict], pools_sb: list[dict],
                                       mainline_codes: set[str]) -> list[dict]:
    """行业×概念共振:涨停股同时属"主线行业板块"+"主线概念板块" = 双强共振
       返回 [{code, name, 行业, 概念列表}]"""
    import sector_meta
    res = []
    for r in pools_lb + pools_sb:
        code = r.get('code', '')
        strong = sector_meta.mainline_sectors_of_stock(code, mainline_codes)
        if not strong:
            continue
        # 分离主线行业 / 主线概念
        ind = [s for s in strong if s[1] == '行业']
        con = [s for s in strong if s[1] == '概念']
        # 行业+概念双共振(各≥1)
        if ind and con:
            res.append({
                'code': code,
                'name': sector_meta.stock_name(code),
                'lb': r.get('lb', 0),
                '行业': [f"{s[2]}" for s in ind],
                '概念': [f"{s[2]}" for s in con],
            })
    return res
