#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# @meta table=tdx_reader cn=通达信解析器 dir=4_工具 sort=003
# @meta schedule=manual mode=tool source=TDX二进制文件
"""
tdx_reader.py — 通达信二进制文件解析器

从 K:\\tdxzhuandb\\src 提取的核心解析逻辑，封装为独立工具类。
只依赖标准库 struct/glob/os + numpy + pandas。

性能优化:
- numpy.fromfile 批量读取
- multiprocessing 并行解析多文件
- 时间范围过滤减少无效读取
"""
import glob
import struct
import os
import numpy as np
import pandas as pd
from loguru import logger
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from functools import partial

# ========== 常量区 ==========

# vipdoc 默认路径
DEFAULT_VIPDOC = r'K:\txdlianghua\vipdoc'

# .day 日线格式（32字节/条）— OHLC = u32，需 ÷100
DAY_DTYPE = np.dtype([
    ('date',     '<u4'),   # YYYYMMDD
    ('open',     '<u4'),   # 开盘价 × 100
    ('high',     '<u4'),   # 最高价 × 100
    ('low',      '<u4'),   # 最低价 × 100
    ('close',    '<u4'),   # 收盘价 × 100
    ('amount',   '<f4'),   # 成交额（元）
    ('volume',   '<u4'),   # 成交量（股）
    ('reserved', '<u4'),   # 保留
])

# .lc1/.lc5 分钟线格式（32字节/条）— OHLC = f32 直接使用
LC_DTYPE = np.dtype([
    ('date_num',  '<u2'),   # 日期编码
    ('minutes',   '<u2'),   # 0点至当前分钟数
    ('open',      '<f4'),   # 开盘价
    ('high',      '<f4'),   # 最高价
    ('low',       '<f4'),   # 最低价
    ('close',     '<f4'),   # 收盘价
    ('amount',    '<f4'),   # 成交额（元）
    ('volume',    '<u4'),   # 成交量（股）
    ('reserved1', '<u4'),   # 保留（指数=涨跌家数）
])

# 目录结构映射
DIR_MAP = {
    'day':  'lday',      # vipdoc/sz/lday/sz000001.day
    'lc1':  'minline',   # vipdoc/sz/minline/sz000001.lc1
    'lc5':  'fzline',    # vipdoc/sz/fzline/sz000001.lc5
}


# ========== 日期/时间向量化工具 ==========
# ⚠ 禁止在本文件使用 pd.to_datetime 的字典/混合输入构造:
#   pd.to_datetime({'year': y, 'month': m, 'day': d})  走慢路径 (array_strptime 逐行),
#   对一亿+ 行 uint32 数组会 OOM+卡死 (本文件 2025-2026 多次踩坑的根因).
# 一律用下面两个 numpy 原生工具: 全 C 实现, 内存峰值 ~2x 输入数组, 亿行 < 2s.

def uint32_yyyymmdd_to_dt64(d: np.ndarray) -> np.ndarray:
    """uint32 YYYYMMDD 数组 → datetime64[ns] 数组.

    输入: 任意 dtype 可强转为 uint32 的 1-D 数组 (DAY_DTYPE.date / GP/BK/SC 二进制 date).
    输出: numpy datetime64[ns] (pandas / DuckDB 都直接接受).
    越界日期 (月/日不在 1-31 或非闰年 2-29 等) 自动落 NaT.
    实现: Hinnant date algorithm (http://howardhinnant.github.io/date_algorithms.html)
    → ordinal math → int64 ns → datetime64[ns]. 全 C 路径, 亿行 < 1s.
    """
    d = np.asarray(d).astype(np.uint32)
    y = (d // 10000).astype(np.int64)
    m = ((d // 100) % 100).astype(np.int64)
    day = (d % 100).astype(np.int64)
    # 每月最大天数 (平年, 闰年 2 月 +1 由下面 leap 调整)
    # 用查表法 (0 占位): mth_max[m] = 0,31,28,31,30,31,30,31,31,30,31,30,31
    mth_max = np.array([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], dtype=np.int64)
    # 闰年: (y%4==0) & (y%100!=0) | (y%400==0). 但 y 可能 < 1 (公元前), 仅需 y >= 1 即可 Gregorian.
    leap = ((y % 4 == 0) & (y % 100 != 0) | (y % 400 == 0)) & (y >= 1)
    # 月份合法 + 日 <= 当月最大 (闰年 2 月取 29)
    max_day = np.where(m == 2, np.where(leap, 29, 28), mth_max[np.clip(m, 0, 12)])
    valid = (m >= 1) & (m <= 12) & (day >= 1) & (day <= max_day)
    # 越界行置 1970-01-01 计算 (合法), 末尾用掩码覆盖为 NaT.
    y_safe = np.where(valid, y, 1970)
    m_safe = np.where(valid, m, 1)
    day_safe = np.where(valid, day, 1)
    # Hinnant days_from_civil (Gregorian → days since 1970-01-01)
    y_adj = np.where(m_safe <= 2, y_safe - 1, y_safe)
    era = np.where(y_adj >= 0, y_adj // 400, (y_adj - 399) // 400)
    yoe = y_adj - era * 400
    mpy = np.where(m_safe <= 2, m_safe + 9, m_safe - 3)
    doy = (153 * mpy + 2) // 5 + day_safe - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days_since_1970 = doe + era * 146097 - 719468
    ns = (days_since_1970 * 86400).astype(np.int64) * 1_000_000_000
    out = ns.view(np.dtype('datetime64[ns]')).copy()
    out[~valid] = np.datetime64('NaT')
    return out


def lc5_date_minutes_to_dt64(date_num: np.ndarray, minutes: np.ndarray) -> np.ndarray:
    """LC_DTYPE (lc1/lc5) 自定义编码 → datetime64[ns].

    date_num (u2): 年 = date_num//2048 + 2004, 月 = (date_num%2048)//100, 日 = ...%100
    minutes   (u2): 0 点起的分钟数, hour = minutes//60, minute = minutes%60
    输出: numpy datetime64[ns], 越界行 = NaT.
    """
    date_num = np.asarray(date_num, dtype=np.uint16)
    minutes = np.asarray(minutes, dtype=np.uint16)
    y = (date_num // 2048 + 2004).astype(np.int64)
    m = ((date_num % 2048) // 100).astype(np.int64)
    day = ((date_num % 2048) % 100).astype(np.int64)
    h = (minutes // 60).astype(np.int64)
    mi = (minutes % 60).astype(np.int64)
    mth_max = np.array([0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31], dtype=np.int64)
    leap = ((y % 4 == 0) & (y % 100 != 0) | (y % 400 == 0)) & (y >= 1)
    max_day = np.where(m == 2, np.where(leap, 29, 28), mth_max[np.clip(m, 0, 12)])
    valid = ((m >= 1) & (m <= 12) & (day >= 1) & (day <= max_day)
             & (h >= 0) & (h <= 23) & (mi >= 0) & (mi <= 59))
    y_safe = np.where(valid, y, 1970)
    m_safe = np.where(valid, m, 1)
    day_safe = np.where(valid, day, 1)
    y_adj = np.where(m_safe <= 2, y_safe - 1, y_safe)
    era = np.where(y_adj >= 0, y_adj // 400, (y_adj - 399) // 400)
    yoe = y_adj - era * 400
    mpy = np.where(m_safe <= 2, m_safe + 9, m_safe - 3)
    doy = (153 * mpy + 2) // 5 + day_safe - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    days_since_1970 = doe + era * 146097 - 719468
    total_seconds = (days_since_1970 * 86400
                     + np.where(valid, h, 0) * 3600
                     + np.where(valid, mi, 0) * 60)
    ns = (total_seconds * 1_000_000_000).astype(np.int64)
    out = ns.view(np.dtype('datetime64[ns]')).copy()
    out[~valid] = np.datetime64('NaT')
    return out

MARKET_DIRS = ['sh', 'sz', 'bj']
MARKET_SUFFIX = {'sh': '.SH', 'sz': '.SZ', 'bj': '.BJ'}

# 指数代码
INDEX_CODES = {
    "000001.SH", "399001.SZ", "399006.SZ", "000300.SH",
    "000905.SH", "000852.SH", "000016.SH", "399673.SZ", "000688.SH",
}


# ========== 工具函数 ==========

def _extract_code(filename: str) -> str:
    """文件名 → 股票代码: sz000001.day → 000001.SZ"""
    stem = Path(filename).stem
    market = stem[:2].lower()
    code = stem[2:8]
    suffix = MARKET_SUFFIX.get(market, '')
    return f"{code}{suffix}"


def _is_index(code: str) -> bool:
    """判断是否为指数代码"""
    return code in INDEX_CODES


# ========== 单文件解析函数（供并行调用） ==========

def _parse_single_day_file(file_path: str, min_date: str = None, max_date: str = None) -> pd.DataFrame:
    """解析单个 .day 文件（独立函数，用于并行处理）

    Args:
        file_path: 文件路径
        min_date: 最小日期 "YYYYMMDD" 格式，None 表示不过滤
        max_date: 最大日期 "YYYYMMDD" 格式，None 表示不过滤
    """
    try:
        data = np.fromfile(file_path, dtype=DAY_DTYPE)
    except Exception:
        return pd.DataFrame()

    if len(data) == 0:
        return pd.DataFrame()

    code = _extract_code(Path(file_path).name)

    # 日期校验 + 范围过滤 (uint32 YYYYMMDD 一次算, 避免拆 y/m/d 三个数组)
    dates_u4 = data['date'].astype(np.uint32)
    y = (dates_u4 // 10000).astype(np.int32)
    m = ((dates_u4 // 100) % 100).astype(np.int32)
    d_ = (dates_u4 % 100).astype(np.int32)
    valid = (y >= 1970) & (m >= 1) & (m <= 12) & (d_ >= 1) & (d_ <= 31)
    if min_date:
        valid &= (dates_u4 >= np.uint32(int(min_date)))
    if max_date:
        valid &= (dates_u4 <= np.uint32(int(max_date)))
    data = data[valid]
    dates_u4 = dates_u4[valid]

    if len(data) == 0:
        return pd.DataFrame()

    ts = uint32_yyyymmdd_to_dt64(dates_u4)

    # OHLCV 校验
    o = data['open'].astype(np.float64)
    h = data['high'].astype(np.float64)
    l = data['low'].astype(np.float64)
    c = data['close'].astype(np.float64)
    v = data['volume'].astype(np.float64)

    valid = (np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c)
             & (c > 0) & (o > 0) & (l <= c) & (c <= h) & (l <= o) & (o <= h) & (v >= 0))
    data = data[valid]
    ts = ts[valid]

    if len(data) == 0:
        return pd.DataFrame()

    # 价格 ÷100，成交额 ÷10000（元→万元）
    df = pd.DataFrame({
        'code': code,
        'date': ts,
        'open': (data['open'].astype(np.float64) / 100.0).round(4),
        'high': (data['high'].astype(np.float64) / 100.0).round(4),
        'low': (data['low'].astype(np.float64) / 100.0).round(4),
        'close': (data['close'].astype(np.float64) / 100.0).round(4),
        'volume': data['volume'].astype(np.float64),
        'amount': (data['amount'].astype(np.float64) / 10000.0).round(4),
    })
    return df


def _parse_single_lc_file(file_path: str, min_date: str = None, max_date: str = None) -> pd.DataFrame:
    """解析单个 .lc1/.lc5 文件（独立函数，用于并行处理）

    Args:
        file_path: 文件路径
        min_date: 最小日期 "YYYYMMDD" 格式，None 表示不过滤
        max_date: 最大日期 "YYYYMMDD" 格式，None 表示不过滤
    """
    try:
        data = np.fromfile(file_path, dtype=LC_DTYPE)
    except Exception:
        return pd.DataFrame()

    if len(data) == 0:
        return pd.DataFrame()

    code = _extract_code(Path(file_path).name)

    # 日期范围过滤 (LC 编码: date_num//2048+2004 = 年; minutes = 0点起的分钟数)
    if min_date or max_date:
        date_nums = data['date_num']
        reconstructed = ((date_nums // 2048 + 2004).astype(np.uint32) * 10000
                         + ((date_nums % 2048) // 100).astype(np.uint32) * 100
                         + (date_nums % 2048 % 100).astype(np.uint32))
        valid = np.ones(len(data), dtype=bool)
        if min_date:
            valid &= (reconstructed >= np.uint32(int(min_date)))
        if max_date:
            valid &= (reconstructed <= np.uint32(int(max_date)))
        data = data[valid]

    if len(data) == 0:
        return pd.DataFrame()

    # 边界校验 + datetime64 构造 (一次走通, 不再拆 y/m/d/h/mi 五个数组)
    timestamps = lc5_date_minutes_to_dt64(data['date_num'], data['minutes'])
    valid = ~np.isnat(timestamps)
    data = data[valid]
    timestamps = timestamps[valid]

    # OHLCV 校验
    o = data['open'].astype(np.float64)
    h = data['high'].astype(np.float64)
    l = data['low'].astype(np.float64)
    c = data['close'].astype(np.float64)
    v = data['volume'].astype(np.float64)

    valid = (np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c)
             & (c > 0) & (o > 0) & (l <= c) & (c <= h) & (l <= o) & (o <= h) & (v >= 0))
    data = data[valid]
    timestamps = timestamps[valid]

    if len(data) == 0:
        return pd.DataFrame()

    df = pd.DataFrame({
        'code': code,
        'trade_time': timestamps,
        'open': data['open'].astype(np.float64).round(4),
        'high': data['high'].astype(np.float64).round(4),
        'low': data['low'].astype(np.float64).round(4),
        'close': data['close'].astype(np.float64).round(4),
        'volume': data['volume'].astype(np.float64),
        'amount': (data['amount'].astype(np.float64) / 10000.0).round(4),
    })
    return df


# SC1-SC42 宏观指标 -> indicator 字节映射 (cw/gpsh999999.dat, 13字节/条)
# 注意: SC41=0x2c, SC42=0x2a 非顺序; field1/field2 为 value_0/value_1 语义(不入表, 供查阅)
SC_MAPPING = {
    1: {'indicator': 0x01, 'name': '融资融券', 'field1': '融资余额(万元)', 'field2': '融券余额(万元)'},
    2: {'indicator': 0x02, 'name': '陆股通资金流入', 'field1': '沪股通流入(亿元)', 'field2': '深股通流入(亿元)'},
    3: {'indicator': 0x03, 'name': '沪深京涨停股个数', 'field1': '涨停股个数', 'field2': '曾涨停股个数'},
    4: {'indicator': 0x04, 'name': '沪深京跌停股个数', 'field1': '跌停股个数', 'field2': '曾跌停股个数'},
    5: {'indicator': 0x05, 'name': '上证50股指期货', 'field1': '净持仓(手)', 'field2': ''},
    6: {'indicator': 0x06, 'name': '沪深300股指期货', 'field1': '净持仓(手)', 'field2': ''},
    7: {'indicator': 0x07, 'name': '中证500股指期货', 'field1': '净持仓(手)', 'field2': ''},
    8: {'indicator': 0x08, 'name': 'ETF基金规模份额', 'field1': 'ETF规模(亿份)', 'field2': 'ETF净申赎(亿份)'},
    9: {'indicator': 0x09, 'name': '沪月新开A股账户', 'field1': '新开账户(万户)', 'field2': ''},
    10: {'indicator': 0x0a, 'name': '增减持统计', 'field1': '增持额(万元)', 'field2': '减持额(万元)'},
    11: {'indicator': 0x0b, 'name': '大宗交易', 'field1': '溢价交易额(万元)', 'field2': '折价交易额(万元)'},
    12: {'indicator': 0x0c, 'name': '限售解禁', 'field1': '计划额(亿元)', 'field2': '实际上市(亿元)'},
    13: {'indicator': 0x0d, 'name': '分红', 'field1': '总分红额(亿元)', 'field2': ''},
    14: {'indicator': 0x0e, 'name': '募资', 'field1': '总募资额(亿元)', 'field2': ''},
    15: {'indicator': 0x0f, 'name': '打板资金', 'field1': '封板成功(亿元)', 'field2': '封板失败(亿元)'},
    16: {'indicator': 0x10, 'name': '龙虎榜', 'field1': '买入总额(亿元)', 'field2': '卖出总额(亿元)'},
    17: {'indicator': 0x11, 'name': '龙虎榜机构数据', 'field1': '机构买入(亿元)', 'field2': '机构卖出(亿元)'},
    18: {'indicator': 0x12, 'name': '龙虎榜营业部数据', 'field1': '营业部买入(亿元)', 'field2': '营业部卖出(亿元)'},
    19: {'indicator': 0x13, 'name': '龙虎榜沪深股通数据', 'field1': '沪深股通买入(亿元)', 'field2': '沪深股通卖出(亿元)'},
    20: {'indicator': 0x14, 'name': '陆股通净买入', 'field1': '沪股通净买入(亿元)', 'field2': '深股通净买入(亿元)'},
    21: {'indicator': 0x15, 'name': '每周无限售质押率', 'field1': '深市质押率(%)', 'field2': '沪市质押率(%)'},
    22: {'indicator': 0x16, 'name': '每周有限售质押率', 'field1': '深市质押率(%)', 'field2': '沪市质押率(%)'},
    23: {'indicator': 0x17, 'name': '连板家数', 'field1': '含ST连板数', 'field2': '不含ST连板数'},
    24: {'indicator': 0x18, 'name': '沪深京涨跌停', 'field1': '涨停(不含ST)', 'field2': '跌停(不含ST)'},
    25: {'indicator': 0x19, 'name': '融资融券', 'field1': '融资买入额(万元)', 'field2': '融券卖出量(万股)'},
    26: {'indicator': 0x1a, 'name': '每周市场质押比', 'field1': '质押比例(%)', 'field2': ''},
    27: {'indicator': 0x1b, 'name': '央行公开市场净投放', 'field1': '净投放(亿元)', 'field2': ''},
    28: {'indicator': 0x1c, 'name': '历史A股新高新低', 'field1': '历史新高', 'field2': '历史新低'},
    29: {'indicator': 0x1d, 'name': '120天A股新高新低', 'field1': '120天新高', 'field2': '120天新低'},
    30: {'indicator': 0x1e, 'name': '涨停数据', 'field1': '市场高度', 'field2': '2板以上涨停'},
    31: {'indicator': 0x1f, 'name': '涨跌家数', 'field1': '涨家数', 'field2': '跌家数'},
    32: {'indicator': 0x20, 'name': '20天A股新高新低', 'field1': '20天新高', 'field2': '20天新低'},
    33: {'indicator': 0x21, 'name': '市场总封单金额', 'field1': '涨停封单(亿元)', 'field2': '跌停封单(亿元)'},
    34: {'indicator': 0x22, 'name': '涨跌股成交量', 'field1': '上涨成交量(万手)', 'field2': '下跌成交量(万手)'},
    35: {'indicator': 0x23, 'name': '涨停数据', 'field1': '换手板家数', 'field2': '回封率(%)'},
    36: {'indicator': 0x24, 'name': '曾涨跌停股个数', 'field1': '曾涨停(不含ST)', 'field2': '曾跌停(不含ST)'},
    37: {'indicator': 0x25, 'name': '转融券', 'field1': '融出市值(亿元)', 'field2': '期末余额(亿元)'},
    38: {'indicator': 0x26, 'name': 'ETF基金规模金额', 'field1': 'ETF规模(亿元)', 'field2': 'ETF净申赎(亿元)'},
    39: {'indicator': 0x27, 'name': '涨跌5%家数', 'field1': '涨>=5%', 'field2': '跌>=5%'},
    40: {'indicator': 0x28, 'name': '陆股通成交', 'field1': '陆股通总额(亿元)', 'field2': '陆股通总笔(万笔)'},
    41: {'indicator': 0x2c, 'name': '中证1000股指期货', 'field1': '净持仓(手)', 'field2': ''},
    42: {'indicator': 0x2a, 'name': '沪深股通成交金额', 'field1': '沪股通总额(亿元)', 'field2': '深股通总额(亿元)'},
}

# GP个股指标 -> indicator 字节映射 (cw/gpsz*.dat, gpsh*.dat, gpbj*.dat, 13字节/条)
# GP01-46 对应 indicator 0x01-0x2E (官方 get_gpjy_value 定义); GP47/48(0x2f/0x30) 二进制实测存在
#   但官方未公开语义, 占位纳入避免丢数据(待通达信确认后补 name);
# field1/field2 为 value_0/value_1 语义(不入表, 供查阅), 取自 get_gpjy_value 官方说明;
# 修正记录: GP27 的 indicator 曾误配 0x2b(与GP43冲突被覆盖, 致真实字节0x1b的982万条数据被丢弃),
#   已改回 0x1b; 待 stock_gp1_46_indicators 全量重跑后恢复.
GP_MAPPING = {
    1: {'indicator': 0x01, 'name': '股东人数', 'field1': '股东户数(户)', 'field2': ''},
    2: {'indicator': 0x02, 'name': '龙虎榜', 'field1': '买入总计(万元)', 'field2': '卖出总计(万元)'},
    3: {'indicator': 0x03, 'name': '融资融券1', 'field1': '融资余额(万元)', 'field2': '融券余量(股)'},
    4: {'indicator': 0x04, 'name': '大宗交易', 'field1': '成交均价(元)', 'field2': '成交额(万元)'},
    5: {'indicator': 0x05, 'name': '增减持1', 'field1': '成交均价(元)', 'field2': '变动股数(股)'},
    6: {'indicator': 0x06, 'name': '陆股通持股量', 'field1': '持股数量(股)', 'field2': ''},
    7: {'indicator': 0x07, 'name': '陆股通市场成交净额', 'field1': '陆股通市场净买入(万元)', 'field2': ''},
    8: {'indicator': 0x08, 'name': '龙虎榜机构卖方', 'field1': '卖方机构个数', 'field2': '机构卖出金额(万元)'},
    9: {'indicator': 0x09, 'name': '龙虎榜机构买方', 'field1': '买方机构个数', 'field2': '机构买入金额(万元)'},
    10: {'indicator': 0x0a, 'name': '近3月机构调研', 'field1': '近3月机构调研次数', 'field2': '近3月调研机构数量'},
    11: {'indicator': 0x0b, 'name': '融资融券2', 'field1': '融资买入额(万元)', 'field2': '融资偿还额(万元)'},
    12: {'indicator': 0x0c, 'name': '融资融券3', 'field1': '融券卖出量(股)', 'field2': '融券偿还量(股)'},
    13: {'indicator': 0x0d, 'name': '融资融券4', 'field1': '融资净买入(万元)', 'field2': '融券净卖出(股)'},
    14: {'indicator': 0x0e, 'name': '涨停数据', 'field1': '涨停金额(万元)', 'field2': '开板次数'},
    15: {'indicator': 0x0f, 'name': '涨跌停', 'field1': '涨跌停状态', 'field2': '封单金额(万元)'},
    16: {'indicator': 0x10, 'name': '总市值', 'field1': '总市值(万元)', 'field2': ''},
    17: {'indicator': 0x11, 'name': '龙虎榜营业部', 'field1': '买入金额(万元)', 'field2': '卖出金额(万元)'},
    18: {'indicator': 0x12, 'name': '龙虎榜沪深股通', 'field1': '买入金额(万元)', 'field2': '卖出金额(万元)'},
    19: {'indicator': 0x13, 'name': '每周股票质押数量', 'field1': '无限售股份质押数(万)', 'field2': '有限售股份质押数(万)'},
    20: {'indicator': 0x14, 'name': '每周股票质押比例', 'field1': '质押比例(%)', 'field2': ''},
    21: {'indicator': 0x15, 'name': '股息率', 'field1': '股息率(%)', 'field2': ''},
    22: {'indicator': 0x16, 'name': '涨跌停封成比封流比', 'field1': '封成比', 'field2': '封流比'},
    23: {'indicator': 0x17, 'name': '拟增减持', 'field1': '拟增持数量(万股)', 'field2': '拟减持数量(万股)'},
    24: {'indicator': 0x18, 'name': '涨停', 'field1': '首次涨停时间', 'field2': '涨停最大封单额(万)'},
    25: {'indicator': 0x19, 'name': '盘前盘后成交量', 'field1': '开盘成交量(手)', 'field2': '盘后固定成交量(手)'},
    26: {'indicator': 0x1a, 'name': '拟增减持金额', 'field1': '拟增持金额(万元)', 'field2': '拟减持金额(万元)'},
    27: {'indicator': 0x1b, 'name': '人气排名', 'field1': '市场人气排名', 'field2': '行业人气排名'},
    28: {'indicator': 0x1c, 'name': '股票回购', 'field1': '回购均价(元)', 'field2': '回购数量(万股)'},
    29: {'indicator': 0x1d, 'name': '证券信息', 'field1': '是否复牌日', 'field2': '是否更名日'},
    30: {'indicator': 0x1e, 'name': '分红送转', 'field1': '派息金额(万元)', 'field2': '送转数量(股)'},
    31: {'indicator': 0x1f, 'name': '转融券1', 'field1': '期初余量(股)', 'field2': '期末余量(股)'},
    32: {'indicator': 0x20, 'name': '转融券2', 'field1': '融出数量(股)', 'field2': '融出市值(元)'},
    33: {'indicator': 0x21, 'name': '跌停数据', 'field1': '跌停金额(万元)', 'field2': '开板次数'},
    34: {'indicator': 0x22, 'name': '跌停', 'field1': '首次跌停时间', 'field2': '跌停最大封单额(万)'},
    35: {'indicator': 0x23, 'name': '增减持2', 'field1': '增持数量(股)', 'field2': '减持数量(股)'},
    36: {'indicator': 0x24, 'name': '竞价涨停买', 'field1': '买入金额(万元)', 'field2': ''},
    37: {'indicator': 0x25, 'name': '龙虎榜2', 'field1': '上榜类型连续交易日(天)', 'field2': ''},
    38: {'indicator': 0x26, 'name': '涨停相关1', 'field1': '近1年涨停次数', 'field2': '近1年溢价5%次数'},
    39: {'indicator': 0x27, 'name': '涨停相关2', 'field1': '近1年首板封板率(%)', 'field2': '近1年次日红盘率(%)'},
    40: {'indicator': 0x28, 'name': '涨停相关3', 'field1': '近1年连板率(%)', 'field2': '最后涨停时间'},
    41: {'indicator': 0x29, 'name': '股权登记日', 'field1': '配股股权登记日', 'field2': ''},
    42: {'indicator': 0x2a, 'name': '龙虎榜专业机构买卖净额', 'field1': '买方成交净额(万元)', 'field2': '卖方成交净额(万元)'},
    43: {'indicator': 0x2b, 'name': '配股实施', 'field1': '配股价格(元)', 'field2': '配股数量(万股)'},
    44: {'indicator': 0x2c, 'name': '股票评分', 'field1': '综合评分', 'field2': ''},
    45: {'indicator': 0x2d, 'name': '评级系数', 'field1': '评级系数', 'field2': ''},
    46: {'indicator': 0x2e, 'name': '拟询价转让', 'field1': '拟转让股数(万股)', 'field2': '拟转让占总股本(%)'},
    # GP47/48: 二进制实测存在(0x2f=55.8万条/5514票, 0x30=2.2万条/5509票), 但 get_gpjy_value 官方定义
    # 只到GP46, 语义未公开. 注: docs/TDXQuant接口数据库框架.md 的"GP47=主力净额"不可信(该文档GP定义已证伪).
    # 先占位纳入读取避免丢数据, name 待通达信官方确认后补.
    47: {'indicator': 0x2f, 'name': '未公开指标47', 'field1': '', 'field2': ''},
    48: {'indicator': 0x30, 'name': '未公开指标48', 'field1': '', 'field2': ''},
}

# BK05-BK19 板块指标 -> indicator 字节映射 (cw/gpsh*.dat, code>=880000, 13字节/条)
# 注意: BK05-19 对应 indicator 0x05-0x13
BK_MAPPING = {
    5: {'indicator': 0x05, 'name': '市盈率TTM', 'field1': '', 'field2': ''},
    6: {'indicator': 0x06, 'name': '市净率MRQ', 'field1': '', 'field2': ''},
    7: {'indicator': 0x07, 'name': '市销率TTM', 'field1': '', 'field2': ''},
    8: {'indicator': 0x08, 'name': '市现率TTM', 'field1': '', 'field2': ''},
    9: {'indicator': 0x09, 'name': '涨跌数', 'field1': '', 'field2': ''},
    10: {'indicator': 0x0a, 'name': '板块总市值(亿元)', 'field1': '', 'field2': ''},
    11: {'indicator': 0x0b, 'name': '板块流通市值(亿元)', 'field1': '', 'field2': ''},
    12: {'indicator': 0x0c, 'name': '涨停数', 'field1': '', 'field2': ''},
    13: {'indicator': 0x0d, 'name': '跌停数', 'field1': '', 'field2': ''},
    14: {'indicator': 0x0e, 'name': '涨停数据', 'field1': '', 'field2': ''},
    15: {'indicator': 0x0f, 'name': '融资融券', 'field1': '', 'field2': ''},
    16: {'indicator': 0x10, 'name': '陆股通资金流入', 'field1': '', 'field2': ''},
    17: {'indicator': 0x11, 'name': '开盘成交数', 'field1': '', 'field2': ''},
    18: {'indicator': 0x12, 'name': '板块股息率', 'field1': '', 'field2': ''},
    19: {'indicator': 0x13, 'name': '板块自由流通市值(亿元)', 'field1': '', 'field2': ''},
}

# SIGNALS 信号类型映射 (T0002/signals/signals_sys_*.dat, 文本|分隔)
SIGNAL_MAPPING = {
    20001: '外资机构净买入选出(全量)',
    20002: '外资机构净买入选出(全量)',
    20003: '外资机构净买入选出(全量)',
    20004: '外资机构净买入选出(全量)',
    20005: '外资净买入选出(全量)',
    20006: '外资券商净买入选出(全量)',
    20007: '外资机构净买入选出(全量)',
    20008: '外资净买入选出(全量)',
    20009: '外资机构净买入选出(全量)',
    20010: '瑞银净买入选出(全量)',
    20011: '中金净买入选出(全量)',
}


# ========== 主类 ==========

class TdxReader:
    """通达信二进制文件解析器

    支持:
    - 批量读取: read_daily/read_5min/read_1min（流式生成器）
    - 并行读取: read_daily_parallel/read_5min_parallel/read_1min_parallel（多进程）
    - 时间过滤: min_date/max_date 参数（分钟K线）
    """

    def __init__(self, vipdoc_path=DEFAULT_VIPDOC, n_workers=None):
        self.vipdoc = Path(vipdoc_path)
        # 默认使用 CPU 核心数-1，最多 6 个进程
        self.n_workers = n_workers or min(os.cpu_count() or 4, 6)

    def _collect_files(self, period: str, market: str = None,
                       index_only: bool = False) -> list:
        """收集指定类型的二进制文件"""
        subdir = DIR_MAP.get(period, period)
        ext = f'*.{period}'
        files = []
        markets = [market] if market else MARKET_DIRS
        for m in markets:
            d = self.vipdoc / m / subdir
            if d.exists():
                files.extend(d.glob(ext))

        if index_only:
            files = [f for f in files if _is_index(_extract_code(f.name))]
        return [str(f) for f in files]

    # ========== 并行读取 ==========

    def read_daily_parallel(self, market=None, index_only=False,
                           min_date: str = None, max_date: str = None) -> pd.DataFrame:
        """并行读 .day 文件（多进程）

        Args:
            market: 市场过滤 'sh'/'sz'/'bj'
            index_only: 仅指数
            min_date: 最小日期 "YYYYMMDD"，None 表示不过滤
            max_date: 最大日期 "YYYYMMDD"，None 表示不过滤
        """
        files = self._collect_files('day', market, index_only)
        if not files:
            return pd.DataFrame()

        parse_func = partial(_parse_single_day_file, min_date=min_date, max_date=max_date)
        print(f"并行读取 {market or 'all'} .day，共 {len(files)} 文件，{self.n_workers} 进程")
        if min_date or max_date:
            print(f"  日期过滤: {min_date or '无'} ~ {max_date or '无'}")

        frames = []
        with ProcessPoolExecutor(max_workers=self.n_workers) as executor:
            futures = {executor.submit(parse_func, f): f for f in files}
            for future in as_completed(futures):
                try:
                    df = future.result()
                    if len(df) > 0:
                        frames.append(df)
                except Exception as e:
                    logger.debug(f"解析失败: {e}")

        if not frames:
            return pd.DataFrame()

        result = pd.concat(frames, ignore_index=True)
        print(f"并行读取 .day 完成，共 {len(result):,} 条")
        return result

    def read_5min_parallel(self, market=None, index_only=False,
                           min_date: str = None, max_date: str = None) -> pd.DataFrame:
        """并行读 .lc5 文件（多进程）"""
        files = self._collect_files('lc5', market, index_only)
        if not files:
            return pd.DataFrame()

        parse_func = partial(_parse_single_lc_file, min_date=min_date, max_date=max_date)
        print(f"并行读取 {market or 'all'} .lc5，共 {len(files)} 文件，{self.n_workers} 进程")

        frames = []
        with ProcessPoolExecutor(max_workers=self.n_workers) as executor:
            futures = {executor.submit(parse_func, f): f for f in files}
            for future in as_completed(futures):
                try:
                    df = future.result()
                    if len(df) > 0:
                        frames.append(df)
                except Exception as e:
                    logger.debug(f"解析失败: {e}")

        if not frames:
            return pd.DataFrame()

        result = pd.concat(frames, ignore_index=True)
        print(f"并行读取 .lc5 完成，共 {len(result):,} 条")
        return result

    def read_1min_parallel(self, market=None, index_only=False,
                           min_date: str = None, max_date: str = None) -> pd.DataFrame:
        """并行读 .lc1 文件（多进程）"""
        files = self._collect_files('lc1', market, index_only)
        if not files:
            return pd.DataFrame()

        parse_func = partial(_parse_single_lc_file, min_date=min_date, max_date=max_date)
        print(f"并行读取 {market or 'all'} .lc1，共 {len(files)} 文件，{self.n_workers} 进程")

        frames = []
        with ProcessPoolExecutor(max_workers=self.n_workers) as executor:
            futures = {executor.submit(parse_func, f): f for f in files}
            for future in as_completed(futures):
                try:
                    df = future.result()
                    if len(df) > 0:
                        frames.append(df)
                except Exception as e:
                    logger.debug(f"解析失败: {e}")

        if not frames:
            return pd.DataFrame()

        result = pd.concat(frames, ignore_index=True)
        print(f"并行读取 .lc1 完成，共 {len(result):,} 条")
        return result

    def read_financial(self) -> pd.DataFrame:
        """读财务数据文件 (cw目录下的 gpcw*.dat 文件)

        文件格式（通达信财务）：
        - 文件头 (14字节): '<1hI1H3L' - 包含报告日期
        - 股票项 (11字节/条): '<6s1c1L' - code(6B) + flag(1B) + offset(4B)
        - 财务数据: 通过offset跳转读取，浮点数组
        """
        from struct import calcsize, unpack

        cw_dir = self.vipdoc / 'cw'
        if not cw_dir.exists():
            logger.warning(f"财务目录不存在: {cw_dir}")
            print("读取财务 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # gpcw*.dat 文件（例如 gpcw20240315.dat）
        dat_files = sorted(cw_dir.glob('gpcw*.dat'))
        if not dat_files:
            logger.warning(f"无 gpcw*.dat 文件: {cw_dir}")
            print("读取财务 共 0 条 (无gpcw文件)")
            return pd.DataFrame()

        header_fmt = '<1hI1H3L'
        stock_item_fmt = '<6s1c1L'
        header_size = calcsize(header_fmt)
        stock_item_size = calcsize(stock_item_fmt)

        frames = []
        for fpath in dat_files:
            try:
                with open(fpath, 'rb') as f:
                    # 读文件头
                    data_header = f.read(header_size)
                    if len(data_header) < header_size:
                        continue
                    header = unpack(header_fmt, data_header)
                    report_date = header[1]  # u4 YYYYMMDD
                    max_count = header[2]    # u16 股票数量
                    report_size = header[4]  # u32 单条记录字节数
                    field_count = report_size // 4

                    # 解析每只股票
                    for idx in range(max_count):
                        f.seek(header_size + idx * stock_item_size)
                        stock_item_bytes = f.read(stock_item_size)
                        if len(stock_item_bytes) < stock_item_size:
                            break

                        stock_item = unpack(stock_item_fmt, stock_item_bytes)
                        code_raw = stock_item[0].decode('ascii', errors='ignore').strip('\x00')
                        if len(code_raw) < 6 or not code_raw.isdigit():
                            continue

                        offset = stock_item[2]
                        if offset == 0:
                            continue

                        # 跳到财务数据位置
                        f.seek(offset)
                        report_fmt = f'<{field_count}f'
                        info_data = f.read(calcsize(report_fmt))
                        if len(info_data) < calcsize(report_fmt):
                            continue

                        fields = unpack(report_fmt, info_data)

                        # 取核心字段：eps(索引0), bvps(索引3)
                        if len(fields) < 4:
                            continue
                        eps = fields[0]
                        bvps = fields[3]

                        if not (np.isfinite(eps) and np.isfinite(bvps)):
                            continue

                        # 加市场后缀
                        market_prefix = fpath.name[:2].lower() if fpath.name[:2].lower() in MARKET_SUFFIX else ''
                        if code_raw.startswith(('6', '5', '9')):
                            suffix = '.SH'
                        elif code_raw.startswith(('0', '1', '2', '3')):
                            suffix = '.SZ'
                        elif code_raw.startswith(('4', '8')):
                            suffix = '.BJ'
                        else:
                            suffix = ''

                        frames.append({
                            'code': f"{code_raw}{suffix}",
                            'date': f"{report_date // 10000}-{(report_date % 10000) // 100:02d}-{report_date % 100:02d}",
                            'eps': round(float(eps), 4),
                            'bvps': round(float(bvps), 4),
                        })

            except Exception as e:
                logger.debug(f"跳过 {fpath.name}: {e}")
                continue

        if not frames:
            print("读取财务 共 0 条")
            return pd.DataFrame()

        result = pd.DataFrame(frames)
        result['date'] = pd.to_datetime(result['date'])
        print(f"读取财务 共 {len(result):,} 条")
        return result

    def read_base_dbf(self) -> pd.DataFrame:
        """读股票基础数据 (T0002/hq_cache/base.dbf)

        DBF 文件包含丰富的财务数据：
        - GPDM: 股票代码
        - GXRQ: 除权日期
        - ZGB: 总股本 (万股)
        - LTAG: 流通A股 (万股)
        - JZC: 净资产 (元)
        - ZZC: 总资产 (元)
        - GDZC: 固定资产 (元)
        - LDZC: 流动资产 (元)
        - ZBGJJ: 资本公积金 (元)
        - DY: 地域
        - HY: 行业
        - SSDATE: 上市日期
        - GDRS: 股东人数
        """
        tdx_root = self.vipdoc.parent
        cache_dir = tdx_root / 'T0002' / 'hq_cache'
        dbf_file = cache_dir / 'base.dbf'

        if not dbf_file.exists():
            logger.warning(f"文件不存在: {dbf_file}")
            print("读取股票基础数据 共 0 条 (文件不存在)")
            return pd.DataFrame()

        try:
            with open(dbf_file, 'rb') as f:
                header = f.read(32)

            header_size = struct.unpack('<H', header[8:10])[0]
            record_size = struct.unpack('<H', header[10:12])[0]

            # 读取字段定义
            f = open(dbf_file, 'rb')
            f.seek(32)
            fields = []
            while True:
                field = f.read(32)
                if field[0] == 0x0D:
                    break
                name = field[:11].decode('ascii', errors='ignore').strip('\x00')
                flen = field[16]
                fields.append({'name': name, 'len': flen})
            f.close()

            # 读取记录
            frames = []
            with open(dbf_file, 'rb') as f:
                f.seek(header_size)
                while True:
                    raw = f.read(record_size)
                    if len(raw) < record_size:
                        break
                    if raw[0] != 0x20:  # 跳过删除标记
                        continue

                    offset = 1
                    record = {}
                    for field in fields:
                        data = raw[offset:offset+field['len']].decode('ascii', errors='ignore').strip()
                        record[field['name']] = data
                        offset += field['len']

                    # 解析关键字段
                    code = record.get('GPDM', '').strip()
                    if not code or not code.isdigit():
                        continue

                    # 市场后缀
                    if code.startswith(('6', '5', '9')):
                        suffix = '.SH'
                    elif code.startswith(('0', '1', '2', '3', '8')):
                        suffix = '.SZ'
                    elif code.startswith(('4',)):
                        suffix = '.BJ'
                    else:
                        suffix = ''

                    frames.append({
                        'code': f"{code}{suffix}",
                        'gxrq': record.get('GXRQ', '').strip(),
                        'zgb': float(record.get('ZGB', 0)) if record.get('ZGB', '').strip() else None,
                        'ltag': float(record.get('LTAG', 0)) if record.get('LTAG', '').strip() else None,
                        'jzc': float(record.get('JZC', 0)) if record.get('JZC', '').strip() else None,
                        'zzc': float(record.get('ZZC', 0)) if record.get('ZZC', '').strip() else None,
                        'gdzc': float(record.get('GDZC', 0)) if record.get('GDZC', '').strip() else None,
                        'ldzc': float(record.get('LDZC', 0)) if record.get('LDZC', '').strip() else None,
                        'zbgjj': float(record.get('ZBGJJ', 0)) if record.get('ZBGJJ', '').strip() else None,
                        'dy': record.get('DY', '').strip(),
                        'hy': record.get('HY', '').strip(),
                        'ssdate': record.get('SSDATE', '').strip(),
                        'gdrs': int(float(record.get('GDRS', 0))) if record.get('GDRS', '').strip() else None,
                    })

            if not frames:
                print("读取股票基础数据 共 0 条")
                return pd.DataFrame()

            result = pd.DataFrame(frames)
            print(f"读取股票基础数据 共 {len(result):,} 条")
            return result

        except Exception as e:
            logger.error(f"读取股票基础数据失败: {e}")
            print(f"读取股票基础数据 共 0 条 (错误: {e})")
            return pd.DataFrame()

    def read_block(self) -> pd.DataFrame:
        """读板块数据文件 (T0002/hq_cache/ 目录)"""
        # 通达信板块文件在 T0002/hq_cache/ 下
        # 主要文件: infoharbor_block.dat
        tdx_root = self.vipdoc.parent
        cache_dir = tdx_root / 'T0002' / 'hq_cache'

        if not cache_dir.exists():
            logger.warning(f"板块缓存目录不存在: {cache_dir}")
            print("读取板块 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # infoharbor_block.dat 二进制板块文件
        block_file = cache_dir / 'infoharbor_block.dat'
        if not block_file.exists():
            # 尝试其他文件
            block_files = list(cache_dir.glob('*block*'))
            if not block_files:
                logger.warning(f"无板块文件: {cache_dir}")
                print("读取板块 共 0 条 (无板块文件)")
                return pd.DataFrame()
            block_file = block_files[0]

        try:
            raw = block_file.read_bytes()
            # infoharbor_block.dat 格式：
            # 文件头: 4字节(记录数) + 4字节(保留)
            # 每条记录: 2字节(板块代码长度) + N字节(代码) + 2字节(名称长度) + N字节(名称) + ...
            # 实际格式复杂，这里用简化解析
            frames = []
            offset = 0
            # 尝试读取头
            if len(raw) < 8:
                print("读取板块 共 0 条 (文件过小)")
                return pd.DataFrame()

            record_count = struct.unpack('<I', raw[0:4])[0]
            offset = 8

            for i in range(min(record_count, 5000)):
                if offset + 4 > len(raw):
                    break
                try:
                    # 板块代码
                    code_len = struct.unpack('<H', raw[offset:offset+2])[0]
                    offset += 2
                    if code_len > 50 or offset + code_len > len(raw):
                        break
                    code = raw[offset:offset+code_len].decode('gbk', errors='ignore')
                    offset += code_len

                    # 板块名称
                    name_len = struct.unpack('<H', raw[offset:offset+2])[0]
                    offset += 2
                    if name_len > 100 or offset + name_len > len(raw):
                        break
                    name = raw[offset:offset+name_len].decode('gbk', errors='ignore')
                    offset += name_len

                    # 跳过类型和其他字段（结构不固定，跳到下一记录）
                    # 尝试读取类型
                    block_type = ''
                    if offset + 2 <= len(raw):
                        type_len = struct.unpack('<H', raw[offset:offset+2])[0]
                        if type_len < 50:
                            offset += 2
                            if offset + type_len <= len(raw):
                                block_type = raw[offset:offset+type_len].decode('gbk', errors='ignore')
                                offset += type_len
                        else:
                            # type_len 可能不是长度，是其他数据
                            pass

                    frames.append({
                        'sector_code': code,
                        'name': name,
                        'sector_type': block_type,
                    })
                except Exception:
                    break

            if not frames:
                print(f"读取板块 共 0 条 (解析失败)")
                return pd.DataFrame()

            result = pd.DataFrame(frames)
            print(f"读取板块 共 {len(result):,} 条")
            return result

        except Exception as e:
            logger.error(f"板块解析失败: {e}")
            print(f"读取板块 共 0 条 (错误: {e})")
            return pd.DataFrame()

    def read_constituents(self) -> pd.DataFrame:
        """读指数成分股 (T0002/hq_cache/ 目录)"""
        tdx_root = self.vipdoc.parent
        cache_dir = tdx_root / 'T0002' / 'hq_cache'

        if not cache_dir.exists():
            logger.warning(f"缓存目录不存在: {cache_dir}")
            print("读取成分股 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # 指数成分股通常在 *_free_block.dat 或通过 API 获取
        # 通达信本地二进制中，成分股信息分散在多个文件
        # 简化实现：从 lday 目录识别指数文件
        frames = []
        for idx_code in INDEX_CODES:
            market = idx_code[-2:].lower()
            code_num = idx_code[:6]
            filename = f"{market}{code_num}.day"
            fpath = self.vipdoc / market / 'lday' / filename
            if fpath.exists():
                frames.append({
                    'index_code': idx_code,
                    'stock_code': idx_code,  # 指数本身就是成分
                    'weight': 1.0,
                })

        if not frames:
            print("读取成分股 共 0 条")
            return pd.DataFrame()

        result = pd.DataFrame(frames)
        print(f"读取成分股 共 {len(result):,} 条")
        return result

    def read_csi_block(self) -> pd.DataFrame:
        """读CSI板块数据 (hq_cache/csiblock.dat)

        文件格式：CSV文本，每行一个成份股
        格式: 62,股票代码,CNY,01
        """
        tdx_root = self.vipdoc.parent
        cache_dir = tdx_root / 'T0002' / 'hq_cache'
        block_file = cache_dir / 'csiblock.dat'

        if not block_file.exists():
            logger.warning(f"文件不存在: {block_file}")
            print("读取CSI板块 共 0 条")
            return pd.DataFrame()

        try:
            frames = []
            with open(block_file, 'rb') as f:
                content = f.read()

            text = content.decode('utf-8', errors='ignore')
            lines = text.split('\r\n')

            for line in lines:
                if not line.strip():
                    continue
                parts = line.split(',')
                if len(parts) >= 2:
                    # 格式: 62,000001,CNY,01
                    block_type = parts[0].strip()
                    code = parts[1].strip()
                    if code and len(code) >= 6:
                        # 添加市场后缀
                        if code.startswith(('6', '5', '9')):
                            suffix = '.SH'
                        elif code.startswith(('0', '1', '2', '3', '8')):
                            suffix = '.SZ'
                        else:
                            suffix = ''
                        frames.append({
                            'code': f"{code}{suffix}",
                            'block_type': block_type,
                        })

            if not frames:
                print("读取CSI板块 共 0 条")
                return pd.DataFrame()

            result = pd.DataFrame(frames)
            print(f"读取CSI板块 共 {len(result):,} 条")
            return result

        except Exception as e:
            logger.error(f"读取CSI板块失败: {e}")
            return pd.DataFrame()

    def read_broker(self) -> pd.DataFrame:
        """读营业部数据 (hq_cache/brkcomp.dat + brkseat.dat)

        brkcomp.dat: 营业部公司信息 (GBK编码)
        brkseat.dat: 营业部席位信息
        """
        tdx_root = self.vipdoc.parent
        cache_dir = tdx_root / 'T0002' / 'hq_cache'

        try:
            # 解析 brkcomp.dat
            comp_file = cache_dir / 'brkcomp.dat'
            brokers = []
            if comp_file.exists():
                with open(comp_file, 'rb') as f:
                    content = f.read()
                text = content.decode('gbk', errors='replace')
                lines = text.split('\r\n')
                for line in lines:
                    if not line.strip():
                        continue
                    parts = line.split('|')
                    if len(parts) >= 2:
                        brokers.append({
                            'broker_id': parts[0].strip(),
                            'broker_name': parts[1].strip(),
                        })

            # 解析 brkseat.dat
            seat_file = cache_dir / 'brkseat.dat'
            seats = []
            if seat_file.exists():
                with open(seat_file, 'rb') as f:
                    content = f.read()
                text = content.decode('utf-8', errors='ignore')
                lines = text.split('\r\n')
                for line in lines:
                    if not line.strip():
                        continue
                    parts = line.split('|')
                    if len(parts) >= 3:
                        seats.append({
                            'seat_id': parts[0].strip(),
                            'broker_id': parts[1].strip(),
                            'seat_code': parts[2].strip(),
                        })

            result = pd.DataFrame(brokers)
            if seats:
                seats_df = pd.DataFrame(seats)
                result = result.merge(seats_df, on='broker_id', how='left')

            print(f"读取营业部 共 {len(result):,} 条")
            return result

        except Exception as e:
            logger.error(f"读取营业部失败: {e}")
            return pd.DataFrame()

    def read_blocknew(self) -> pd.DataFrame:
        """读自定义板块 (T0002/blocknew/*.blk)

        .blk 文件格式：每行一个股票代码（纯文本）
        blocknew.cfg: 板块配置（56字节/条，GBK编码）
        """
        tdx_root = self.vipdoc.parent
        block_dir = tdx_root / 'T0002' / 'blocknew'

        if not block_dir.exists():
            logger.warning(f"板块目录不存在: {block_dir}")
            print("读取自定义板块 共 0 条")
            return pd.DataFrame()

        try:
            frames = []

            # 读取 blocknew.cfg 获取板块名称映射
            cfg_file = block_dir / 'blocknew.cfg'
            block_names = {}
            if cfg_file.exists():
                with open(cfg_file, 'rb') as f:
                    content = f.read()
                # 每条56字节：前10字节名称(ASCII) + 后46字节代码
                record_size = 56
                for i in range(0, len(content), record_size):
                    record = content[i:i+record_size]
                    if len(record) < record_size:
                        break
                    # 名称（前10字节，ASCII）
                    name = record[:10].decode('ascii', errors='ignore').strip()
                    # 代码（后46字节，ASCII）
                    code = record[10:].decode('ascii', errors='ignore').strip()
                    if name and code:
                        block_names[code] = name

            # 读取所有 .blk 文件
            for blk_file in block_dir.glob('*.blk'):
                if blk_file.is_dir():
                    continue
                block_code = blk_file.stem  # 文件名作为板块代码

                # 从配置获取名称
                block_name = block_names.get(block_code, block_code)

                with open(blk_file, 'rb') as f:
                    content = f.read()

                # 尝试多种编码
                text = None
                for enc in ['utf-8', 'gbk', 'gb2312']:
                    try:
                        text = content.decode(enc)
                        break
                    except:
                        continue

                if text is None:
                    text = content.decode('utf-8', errors='ignore')

                # 解析股票代码
                for line in text.split('\n'):
                    line = line.strip()
                    if not line or len(line) < 6:
                        continue
                    # 取前6位作为股票代码
                    code = line[:6]
                    if code.isdigit():
                        # 添加市场后缀
                        if code.startswith(('6', '5', '9')):
                            suffix = '.SH'
                        elif code.startswith(('0', '1', '2', '3', '8')):
                            suffix = '.SZ'
                        else:
                            suffix = ''
                        frames.append({
                            'block_code': block_code,
                            'block_name': block_name,
                            'stock_code': f"{code}{suffix}",
                        })

            if not frames:
                print("读取自定义板块 共 0 条")
                return pd.DataFrame()

            result = pd.DataFrame(frames)
            print(f"读取自定义板块 共 {len(result):,} 条，{result['block_code'].nunique()} 个板块")
            return result

        except Exception as e:
            logger.error(f"读取自定义板块失败: {e}")
            return pd.DataFrame()
        h = data['high'].astype(np.float64)
        l = data['low'].astype(np.float64)
        c = data['close'].astype(np.float64)
        v = data['volume'].astype(np.float64)

        valid = (np.isfinite(o) & np.isfinite(h) & np.isfinite(l) & np.isfinite(c)
                 & (c > 0) & (o > 0) & (l <= c) & (c <= h) & (l <= o) & (o <= h) & (v >= 0))
        data = data[valid]
        timestamps = timestamps[valid]

        if len(data) == 0:
            return pd.DataFrame()

        df = pd.DataFrame({
            'code': code,
            'trade_time': pd.DatetimeIndex(timestamps),
            'open': data['open'].astype(np.float64).round(4),
            'high': data['high'].astype(np.float64).round(4),
            'low': data['low'].astype(np.float64).round(4),
            'close': data['close'].astype(np.float64).round(4),
            'volume': data['volume'].astype(np.float64),
            'amount': (data['amount'].astype(np.float64) / 10000.0).round(4),
        })
        return df

    def read_sc(self) -> pd.DataFrame:
        """读市场宏观指标 SC1-SC42 (cw/gpsh999999.dat)

        文件格式: 13字节/条 [indicator(u1)][date(u4,YYYYMMDD)][value1(f4)][value2(f4)]
        indicator -> SC 映射见 SC_MAPPING（SC41=0x2c, SC42=0x2a 非顺序）
        返回长表: date/sc_code/sc_name/value_0/value_1
        """
        dat_path = self.vipdoc / 'cw' / 'gpsh999999.dat'
        if not dat_path.exists():
            logger.warning(f"SC数据文件不存在: {dat_path}")
            print("读取SC宏观指标 共 0 条 (文件不存在)")
            return pd.DataFrame()

        data = np.fromfile(str(dat_path), dtype=np.dtype([
            ('indicator', 'u1'),
            ('date', '<u4'),
            ('value1', '<f4'),
            ('value2', '<f4'),
        ]))

        today_int = getattr(self, 'cutoff_date', int(pd.Timestamp.now().strftime('%Y%m%d')))
        rows = []
        for sc_id, cfg in SC_MAPPING.items():
            ind = cfg['indicator']
            mask = (data['indicator'] == ind) & (data['date'] >= 20000101) & (data['date'] <= today_int)
            ind_data = data[mask]
            if len(ind_data) == 0:
                continue
            order = np.argsort(ind_data['date'])
            for i in order:
                d = int(ind_data['date'][i])
                ds = f"{d//10000:04d}-{(d%10000)//100:02d}-{d%100:02d}"
                rows.append({
                    'date': ds,
                    'sc_code': f"SC{sc_id:02d}",
                    'sc_name': cfg['name'],
                    'value_0': float(ind_data['value1'][i]),
                    'value_1': float(ind_data['value2'][i]),
                })

        if not rows:
            print("读取SC宏观指标 共 0 条")
            return pd.DataFrame()

        result = pd.DataFrame(rows)
        result['date'] = uint32_yyyymmdd_to_dt64(result['date'].values)
        print(f"读取SC宏观指标 共 {len(result):,} 条，覆盖 {result['sc_code'].nunique()} 个指标")
        return result

    def read_gp(self) -> pd.DataFrame:
        """读个股指标 GP1-GP46 (cw/gpsz*.dat, gpsh*.dat, gpbj*.dat)

        文件格式: 13字节/条 [indicator(u1)][date(u4,YYYYMMDD)][value1(f4)][value2(f4)]
        indicator -> GP 映射见 GP_MAPPING（GP1-48 = 0x01-0x30, GP27=0x1b）
        返回长表: date/code/gp_code/gp_name/value_0/value_1
        """
        cw_dir = self.vipdoc / 'cw'
        if not cw_dir.exists():
            logger.warning(f"cw目录不存在: {cw_dir}")
            print("读取GP个股指标 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # 收集所有个股 .dat 文件
        dat_files = [
            f for f in cw_dir.iterdir()
            if f.suffix == '.dat' and f.name.startswith(('gpsz', 'gpsh', 'gpbj'))
        ]

        if not dat_files:
            logger.warning(f"未找到GP数据文件: {cw_dir}")
            print("读取GP个股指标 共 0 条 (无文件)")
            return pd.DataFrame()

        # 从文件名提取代码
        def extract_code(filepath: str) -> str:
            name = Path(filepath).stem
            if len(name) >= 6:
                market_prefix = name[2:4].upper()
                code_str = name[4:]
                suffix_map = {'SZ': '.SZ', 'SH': '.SH', 'BJ': '.BJ'}
                return f"{code_str}{suffix_map.get(market_prefix, '')}"
            return ''

        today_int = getattr(self, 'cutoff_date', int(pd.Timestamp.now().strftime('%Y%m%d')))

        # 256元素查表: indicator字节 -> gp_code/gp_name/是否有效 (替代46次内层循环)
        gp_code_lut = np.array([''] * 256, dtype=object)
        gp_name_lut = np.array([''] * 256, dtype=object)
        valid_lut = np.zeros(256, dtype=bool)
        for gp_id, cfg in GP_MAPPING.items():
            ind = cfg['indicator']
            gp_code_lut[ind] = f'GP{gp_id:02d}'
            gp_name_lut[ind] = cfg['name']
            valid_lut[ind] = True

        dt = np.dtype([
            ('indicator', 'u1'),
            ('date', '<u4'),
            ('value1', '<f4'),
            ('value2', '<f4'),
        ])

        # 按列累加numpy数组 (避免34.8万小DataFrame的concat内存峰值)
        ch_date, ch_code, ch_gpcode, ch_gpname, ch_v0, ch_v1 = [], [], [], [], [], []

        for dat_file in dat_files:
            code = extract_code(dat_file.name)
            if not code:
                continue
            try:
                data = np.fromfile(str(dat_file), dtype=dt)
                if data.size == 0:
                    continue
                # 一次向量化掩码: 日期范围 + 有效indicator
                keep = ((data['date'] >= 20000101) & (data['date'] <= today_int)
                        & valid_lut[data['indicator']])
                if not keep.any():
                    continue
                sub = data[keep]
                inds = sub['indicator']
                ch_date.append(sub['date'])
                ch_code.append(np.full(sub.size, code, dtype=object))
                ch_gpcode.append(gp_code_lut[inds])
                ch_gpname.append(gp_name_lut[inds])
                ch_v0.append(sub['value1'])
                ch_v1.append(sub['value2'])
            except Exception as e:
                logger.warning(f"解析文件失败 {dat_file.name}: {e}")
                continue

        if not ch_date:
            print("读取GP个股指标 共 0 条")
            return pd.DataFrame()

        # 一次性拼接 + 一次性 date 转换 (datetime64[ns], 8字节C数组, 无python date对象)
        # DuckDB 可直接将 datetime64 插入 DATE 列; value 保持源 f4 精度
        # 用 uint32_yyyymmdd_to_dt64 走 numpy 原生 ordinal math, 绕开 pd.to_datetime
        # 字典构造在亿行规模下的 strptime 慢路径 (OOM + 卡死).
        d = np.concatenate(ch_date).astype(np.uint32)
        df = pd.DataFrame({
            'date': uint32_yyyymmdd_to_dt64(d),
            'code': np.concatenate(ch_code),
            'gp_code': np.concatenate(ch_gpcode),
            'gp_name': np.concatenate(ch_gpname),
            'value_0': np.concatenate(ch_v0),
            'value_1': np.concatenate(ch_v1),
        })
        print(f"读取GP个股指标 共 {len(df):,} 条，覆盖 {df['code'].nunique()} 只股票，{df['gp_code'].nunique()} 个指标")
        return df

    def read_gp_stream(self, files_per_batch: int = 300):
        """流式读 GP 指标 GP1-GP46，按批 yield DataFrame (避免全量驻留内存导致OOM)。

        每合并 files_per_batch 个文件 yield 一次；读完即释放，峰值内存仅单批大小。
        供 93_stock_gp1_46_indicators 流式入库。文件格式同 read_gp。
        yield: date(datetime64[ns])/code/gp_code/gp_name/value_0/value_1 的 DataFrame
        """
        cw_dir = self.vipdoc / 'cw'
        if not cw_dir.exists():
            logger.warning(f"cw目录不存在: {cw_dir}")
            return
        dat_files = [f for f in cw_dir.iterdir()
                     if f.suffix == '.dat' and f.name.startswith(('gpsz', 'gpsh', 'gpbj'))]
        if not dat_files:
            logger.warning(f"未找到GP数据文件: {cw_dir}")
            return

        def extract_code(filepath: str) -> str:
            name = Path(filepath).stem
            if len(name) >= 6:
                suffix_map = {'SZ': '.SZ', 'SH': '.SH', 'BJ': '.BJ'}
                return f"{name[4:]}{suffix_map.get(name[2:4].upper(), '')}"
            return ''

        # 256元素查表: indicator字节 -> gp_code/gp_name/是否有效
        # 用定长 Unicode dtype 替代 object: 减少 Python 对象引用 + GC 压力,
        # 配合 _flush 的 datetime64 构造, 单批 100-1000 万行从 ~30s 降到 <3s.
        _GP_CODE_W = 5   # 'GP48' + 1
        _GP_NAME_W = 24  # 含"未公开指标47"等占位, 24 字符足够
        gp_code_lut = np.array([''] * 256, dtype=f'U{_GP_CODE_W}')
        gp_name_lut = np.array([''] * 256, dtype=f'U{_GP_NAME_W}')
        valid_lut = np.zeros(256, dtype=bool)
        for gp_id, cfg in GP_MAPPING.items():
            ind = cfg['indicator']
            gp_code_lut[ind] = f'GP{gp_id:02d}'
            gp_name_lut[ind] = cfg['name']
            valid_lut[ind] = True

        today_int = getattr(self, 'cutoff_date', int(pd.Timestamp.now().strftime('%Y%m%d')))
        dt = np.dtype([('indicator', 'u1'), ('date', '<u4'), ('value1', '<f4'), ('value2', '<f4')])
        ch_date, ch_code, ch_gpcode, ch_gpname, ch_v0, ch_v1 = [], [], [], [], [], []
        n_in_batch = 0
        total = 0

        def _flush():
            """flush 一批 → DataFrame. 关键性能点:
            1) date 用 uint32_yyyymmdd_to_dt64 走 numpy ordinal math, 绕开 pd.to_datetime
               字典构造的 strptime 慢路径 (单批百万级 + uint32 字典构造在 pd.to_datetime
               里走 array_strptime 逐行, OOM + 卡死).
            2) gp_code/gp_name 用定长 U dtype, 拼接后转 pandas 仍是 object 但内部是 C 连续,
               Arrow 转 DuckDB 大幅提速.
            """
            nonlocal n_in_batch
            if not ch_date:
                return None
            d = np.concatenate(ch_date).astype(np.uint32)
            date_arr = uint32_yyyymmdd_to_dt64(d)
            bdf = pd.DataFrame({
                'date': date_arr,
                'code': np.concatenate(ch_code),
                'gp_code': np.concatenate(ch_gpcode),
                'gp_name': np.concatenate(ch_gpname),
                'value_0': np.concatenate(ch_v0),
                'value_1': np.concatenate(ch_v1),
            })
            for L in (ch_date, ch_code, ch_gpcode, ch_gpname, ch_v0, ch_v1):
                L.clear()
            n_in_batch = 0
            return bdf

        for dat_file in dat_files:
            code = extract_code(dat_file.name)
            if not code:
                continue
            try:
                data = np.fromfile(str(dat_file), dtype=dt)
                if data.size == 0:
                    continue
                keep = ((data['date'] >= 20000101) & (data['date'] <= today_int)
                        & valid_lut[data['indicator']])
                if not keep.any():
                    continue
                sub = data[keep]
                inds = sub['indicator']
                ch_date.append(sub['date'])
                ch_code.append(np.full(sub.size, code, dtype=object))
                ch_gpcode.append(gp_code_lut[inds])
                ch_gpname.append(gp_name_lut[inds])
                ch_v0.append(sub['value1'])
                ch_v1.append(sub['value2'])
                n_in_batch += 1
                if n_in_batch >= files_per_batch:
                    bdf = _flush()
                    if bdf is not None:
                        total += len(bdf)
                        yield bdf
            except Exception as e:
                logger.warning(f"解析文件失败 {dat_file.name}: {e}")
                continue

        bdf = _flush()
        if bdf is not None:
            total += len(bdf)
            yield bdf
        print(f"读取GP个股指标 共 {total:,} 条 (流式)")

    def read_bk(self, cutoff_date: int = None) -> pd.DataFrame:
        """读板块指标 BK05-BK19 (cw/gpsh*.dat, code>=880000)

        文件格式: 13字节/条 [indicator(u1)][date(u4,YYYYMMDD)][value1(f4)][value2(f4)]
        indicator -> BK 映射见 BK_MAPPING（BK05-19 = 0x05-0x13）
        返回长表: date/code/bk_code/bk_name/value_0/value_1
        cutoff_date: 可选过滤截止日期 (int YYYYMMDD)
        """
        cw_dir = self.vipdoc / 'cw'
        if not cw_dir.exists():
            logger.warning(f"cw目录不存在: {cw_dir}")
            print("读取BK板块指标 共 0 条 (目录不存在)")
            return pd.DataFrame()
        cw_dir = self.vipdoc / 'cw'
        if not cw_dir.exists():
            logger.warning(f"cw目录不存在: {cw_dir}")
            print("读取BK板块指标 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # 只读取 gpsh*.dat 文件（板块只在SH市场）
        dat_files = [
            f for f in cw_dir.iterdir()
            if f.suffix == '.dat' and f.name.startswith('gpsh')
        ]

        if not dat_files:
            logger.warning(f"未找到BK数据文件: {cw_dir}")
            print("读取BK板块指标 共 0 条 (无文件)")
            return pd.DataFrame()

        # 从文件名提取代码，只保留板块（code>=880000）
        def extract_code(filepath: str) -> str:
            name = Path(filepath).stem
            if len(name) >= 6:
                code_str = name[4:]
                if code_str.isdigit() and int(code_str) >= 880000:
                    return f"{code_str}.SH"
            return ''

        today_int = getattr(self, 'cutoff_date', int(pd.Timestamp.now().strftime('%Y%m%d')))
        all_dfs = []

        # 构建indicator到BK的映射（反向查找）
        ind_to_bk = {cfg['indicator']: (bk_id, cfg['name']) for bk_id, cfg in BK_MAPPING.items()}
        valid_inds = set(ind_to_bk.keys())

        # 解析每个文件
        for dat_file in dat_files:
            code = extract_code(dat_file.name)
            if not code:
                continue

            try:
                data = np.fromfile(str(dat_file), dtype=np.dtype([
                    ('indicator', 'u1'),
                    ('date', '<u4'),
                    ('value1', '<f4'),
                    ('value2', '<f4'),
                ]))

                # 过滤：日期范围 + 有效indicator
                mask = (data['date'] >= 20000101) & (data['date'] <= today_int)
                for ind in valid_inds:
                    ind_mask = (data['indicator'] == ind) & mask
                    if not np.any(ind_mask):
                        continue

                    ind_data = data[ind_mask]
                    bk_id, bk_name = ind_to_bk[ind]

                    # 向量化构建DataFrame
                    dates = ind_data['date'].astype(np.uint32)
                    df = pd.DataFrame({
                        'date': uint32_yyyymmdd_to_dt64(dates),
                        'code': code,
                        'bk_code': f"BK{bk_id:02d}",
                        'bk_name': bk_name,
                        'value_0': ind_data['value1'].astype(float),
                        'value_1': ind_data['value2'].astype(float),
                    })
                    all_dfs.append(df)

            except Exception as e:
                logger.warning(f"解析文件失败 {dat_file.name}: {e}")
                continue

        if not all_dfs:
            print("读取BK板块指标 共 0 条")
            return pd.DataFrame()

        result = pd.concat(all_dfs, ignore_index=True)
        print(f"读取BK板块指标 共 {len(result):,} 条，覆盖 {result['code'].nunique()} 个板块，{result['bk_code'].nunique()} 个指标")
        return result

    def read_signals(self) -> pd.DataFrame:
        """读信号数据 SIGNALS 20001-20011 (T0002/signals/signals_sys_*.dat)

        文件格式: 文本|分隔 [序号|股票代码|日期YYYYMMDD|数值]
        返回长表: date/code/signal_code/signal_name/value
        """
        tdx_root = self.vipdoc.parent
        signals_dir = tdx_root / 'T0002' / 'signals'

        if not signals_dir.exists():
            logger.warning(f"signals目录不存在: {signals_dir}")
            print("读取信号数据 共 0 条 (目录不存在)")
            return pd.DataFrame()

        # 收集有效的 .dat 文件
        dat_files = sorted([
            f for f in signals_dir.iterdir()
            if f.suffix == '.dat' and f.name.startswith('signals_sys_') and f.stat().st_size > 0
        ])

        if not dat_files:
            logger.warning(f"未找到signals数据文件: {signals_dir}")
            print("读取信号数据 共 0 条 (无文件)")
            return pd.DataFrame()

        all_records = []

        # 解析每个文件
        for dat_file in dat_files:
            # 从文件名提取信号 ID
            try:
                signal_id = int(dat_file.stem.replace('signals_sys_', ''))
            except ValueError:
                continue

            if signal_id not in SIGNAL_MAPPING:
                continue

            signal_name = SIGNAL_MAPPING[signal_id]

            try:
                with open(dat_file, 'r', encoding='utf-8', errors='replace') as f:
                    for line in f:
                        line = line.strip()
                        if not line:
                            continue

                        parts = line.split('|')
                        if len(parts) >= 4:
                            try:
                                all_records.append({
                                    'code': parts[1].strip(),
                                    'date': int(parts[2]),
                                    'value': float(parts[3]),
                                    'signal_code': f"SIGNAL{signal_id}",
                                    'signal_name': signal_name,
                                })
                            except (ValueError, IndexError):
                                continue

            except Exception as e:
                logger.warning(f"解析文件失败 {dat_file.name}: {e}")
                continue

        if not all_records:
            print("读取信号数据 共 0 条")
            return pd.DataFrame()

        result = pd.DataFrame(all_records)
        result['date'] = uint32_yyyymmdd_to_dt64(result['date'].values)
        print(f"读取信号数据 共 {len(result):,} 条，覆盖 {result['code'].nunique()} 只股票，{result['signal_code'].nunique()} 个信号")
        return result


# ========== 入口 ==========
if __name__ == '__main__':
    reader = TdxReader()

    print("=" * 60)
    print("1. 日K线 (.day) - 并行读取")
    print("=" * 60)
    df = reader.read_daily_parallel(market='sz')
    if len(df) > 0:
        print(df.head(3).to_string())

    print("\n" + "=" * 60)
    print("2. 5分钟K线 (.lc5) - 单文件测试")
    print("=" * 60)
    files = reader._collect_files('lc5', market='sz')
    if files:
        df = _parse_single_lc_file(files[0], min_date='20260601', max_date='20260608')
        print(f"读取 {Path(files[0]).name} 共 {len(df):,} 条")
        if len(df) > 0:
            print(df.head(3).to_string())

    print("\n" + "=" * 60)
    print("3. 1分钟K线 (.lc1) - 单文件测试")
    print("=" * 60)
    files = reader._collect_files('lc1', market='sz')
    if files:
        df = _parse_single_lc_file(files[0])
        print(f"读取 {Path(files[0]).name} 共 {len(df):,} 条")
        if len(df) > 0:
            print(df.head(3).to_string())

    print("\n全部测试完成")
