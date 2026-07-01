#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_common.py — 大盘情绪监控 地基
    TQ 初始化 + 通用工具 + 全局阈值常量(用户填 __TODO__)
    字段事实见 memory/tq-sentiment-fields.md
"""
from __future__ import annotations
import sys
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
TQ_USER_PATH = r'K:\txdlianghua\PYPlugins\user'

# ────────────────────────────── 监控标的 ──────────────────────────────
# 5 大盘指数(各市场情绪独立)
INDEX_CODES = [
    '999999.SH',  # 上证指数
    '399001.SZ',  # 深证成指
    '399006.SZ',  # 创业板指
    '000688.SH',  # 科创50
    '899050.BJ',  # 北证50
]


# ════════════════════════════════════════════════════════════════════════
#  阈值常量区(用户填) — 所有 __TODO__(建议: X) 在此集中修改
#  命名: TH_<层>_<指标>_<用途>
# ════════════════════════════════════════════════════════════════════════
class TH:
    """全局阈值。已校准生效。"""

    # ─── 大盘情绪评级(5档)───
    EMOTION_ZT_BIN   = [30, 60, 100, 150]      # 涨停数分档 [冰点/低迷/中性/活跃/过热]
    EMOTION_FBL_BIN  = [60, 70, 80, 90]        # 封板率% 分档
    EMOTION_LB_BIN   = [3, 4, 6, 9]            # 最高连板 分档
    EMOTION_UDR_BIN  = [0.5, 1.0, 2.0, 3.0]    # 涨跌比 分档

    # ─── 大盘背离检测 ───
    DIV_INDEX_UP     = 0.3                     # 指数涨幅>此 才算"涨",才检测背离
    DIV_BREADTH_LOW  = 0.8                     # 涨但涨跌比<此 = 价宽背离
    DIV_FLOW_OUT     = 0.0                     # 涨但主力净额<此 = 价资背离
    DIV_VOL_SHRINK   = 0.2                     # 涨但成交额较昨缩>此比例 = 价量背离
    DIV_FUTS_DISCOUNT = -20.0                  # IF 基差<此(点) = 期指贴水背离(日内基差±50常见,贴水>20点算显著看空)

    # ─── 变盘检测(状态层跨帧) ───
    TURN_ZT_DROP     = 0.3                     # 涨停数 5分钟降幅>此 = 变盘预警
    TURN_UDR_FLIP_HI = 1.5                     # 涨跌比从此值以上
    TURN_UDR_FLIP_LO = 0.8                     # 降到此值以下 = 翻转变盘
    TURN_FBL_FRAMES  = 3                       # 封板率连续 N 帧下滑
    TURN_FBL_DROP    = 0.15                    # 累计降>此 = 变盘

    # ─── 板块主线候选 ───
    SECTOR_MAIN_ZT      = 3                    # 涨停家数≥此
    SECTOR_MAIN_ZAF_GT  = 0.0                  # 涨幅>大盘(用差值)
    SECTOR_MAIN_FLOW_IN = 0.0                  # 主力净流入>此
    SECTOR_MAIN_MOM5    = 0.0                  # 5日动量>此

    # ─── 板块退潮预警 ───
    SECTOR_RETREAT_ZT_DROP = 0.5               # 涨停数较前日降幅>此
    SECTOR_RETREAT_MOM5    = 0.0               # 5日动量<此(转负)

    # ─── 板块强度分权重 ───
    SECTOR_W_ZT   = 3.0                        # 涨停家数权重
    SECTOR_W_ZAF  = 1.0                        # 涨幅权重
    SECTOR_W_FLOW = 1.0                        # 主力归一权重
    SECTOR_W_LB2  = 2.0                        # 2板以上数权重

    # ─── 个股池门槛 ───
    STOCK_LB_TIERS    = [2, 3, 4, 7]           # 连板梯队分层 [2板/3板/4-6板/7+板]
    STOCK_LEADER_FCA  = 1000.0                 # 龙头封单额下限(万)
    STOCK_WEAKFCB_FC  = 0.1                    # 封成比<此 = 易炸预警
    STOCK_WEAKFCA     = 500.0                  # 封单额<此(万) = 易炸预警
    STOCK_BREAK_DROP  = -0.05                  # 昨日连板今日跌幅>此 = A杀(断板负反馈)

    # ─── 首封时间窗口(情绪强度) ───
    FIRST_ZT_OPEN_WINDOW = ('09:30', '10:00')  # 开盘抢筹窗(首封在此=强)
    FIRST_ZT_LATE        = '13:00'             # 此后首封=弱


# ────────────────────────────── TQ 初始化 ──────────────────────────────
def init_tq(script_file: str) -> bool:
    if Path(TQ_USER_PATH).exists():
        sys.path.insert(0, TQ_USER_PATH)
    try:
        from tqcenter import tq
        tq.initialize(os.path.abspath(script_file))
        try:
            tq.refresh_cache(market='AG', force=True)
        except Exception:
            pass
        return True
    except Exception as e:
        print(f"TQ 初始化失败: {e}")
        return False


def get_tq():
    sys.path.insert(0, TQ_USER_PATH)
    from tqcenter import tq
    return tq


# ────────────────────────────── 工具 ──────────────────────────────
def _f(info: dict, key: str) -> float:
    try:
        v = info.get(key)
        return float(v) if v not in (None, '', 'None') else 0.0
    except (TypeError, ValueError):
        return 0.0


def _s(info: dict, key: str) -> str:
    v = info.get(key)
    return '' if v in (None, 'None') else str(v)


def classify_stock(fcamo: float, day_max: float, zt_price: float) -> str:
    """涨跌停炸板判定(文档权威 FCAmo + Max + ZTPrice)"""
    if fcamo > 0:
        return '涨停'
    if fcamo < 0:
        return '跌停'
    if zt_price > 0 and day_max >= zt_price:
        return '炸板'
    return '正常'
