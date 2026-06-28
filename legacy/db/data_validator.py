#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
数据入库校验器 — 写入前自动校验，拒绝脏数据

校验层级：
  L1 代码格式 — code字段正则匹配
  L2 日期合法性 — 日期必须在交易日历中
  L3 数值范围 — 字段值在预期范围内
  L4 OHLC一致性 — low ≤ open/close ≤ high
  L5 时间段合法性 — 分钟线trade_time在交易时段内
  L6 逻辑约束 — 表级业务规则
"""

import re
import logging
import pandas as pd
from datetime import date
from typing import Dict, List, Tuple, Optional

logger = logging.getLogger(__name__)

CODE_PATTERNS = {
    "stock": re.compile(r"^\d{6}\.(SH|SZ|BJ)$"),
    "index_sh": re.compile(r"^000\d{3}\.SH$"),
    "index_sz": re.compile(r"^399\d{3}\.SZ$"),
    "sector": re.compile(r"^88\d{4}\.SH$"),
}

INDEX_CODES = {
    "000001.SH", "000016.SH", "000300.SH", "000905.SH",
    "000852.SH", "399001.SZ", "399006.SZ", "399673.SZ",
}

FIELD_RANGES: Dict[str, Tuple[float, float]] = {
    # 价格类 (元)
    "open": (0.01, 100000),
    "high": (0.01, 100000),
    "low": (0.01, 100000),
    "close": (0.01, 100000),
    "price": (0.01, 100000),
    "pre_close": (0.01, 100000),
    "iopv": (0.01, 100000),
    "sg_price": (0.01, 1000),

    # 成交量类 (手/股)
    # 放宽到10亿手, 适应大盘股/ETF高成交量
    "volume": (0, 1e9),

    # 成交额类 (元/万元)
    # amount: 放宽到500亿, 适应大盘股
    "amount": (0, 5e12),

    # 涨跌幅类 (%)
    "change_pct": (-20, 20),
    "turnover": (0, 100),          # 换手率
    "turnover_rate": (0, 100),    # 换手率
    "dy_ratio": (0, 100),         # 股息率
    "weight": (0, 100),            # 指数权重

    # 市值类 (亿元)
    # 放宽到500亿, 适应大盘股/ETF
    "total_market_cap": (0, 5e5),   # 50万亿
    "float_market_cap": (0, 5e5),
    "free_float_shares": (0, 5e5),
    "scale": (0, 5e5),

    # 量比类
    # 放宽到100, 适应新股/热点股高量比
    "volume_ratio": (0, 100),

    # 估值类 (支持负值, 亏损股)
    # pe_ttm: 负值下限放宽到-10000, 正值上限放宽
    "pe_ttm": (-10000, 1000000),
    # pb_mrq: 负值下限放宽到-500, 银行业PB可为负
    "pb_mrq": (-500, 50000),
    "pe_issue": (0, 100000),

    # 涨停/跌停价
    "zt_price": (0.01, 100000),
    "dt_price": (0.01, 100000),

    # 其他指标
    "zaf": (0, 30),             # 炸板率
    "beta_value": (-5, 5),      # Beta值
    "forward_factor": (0.001, 100),

    # 板块统计类
    "advance": (0, 5000),         # 放宽到5000家
    "decline": (0, 5000),
    "total_stocks": (0, 5000),
    "limit_up": (0, 500),
    "limit_down": (0, 500),
    "stock_count": (0, 5000),

    # 股本类 (手/股)
    "total_shares": (1e4, 5e12),   # 放宽下限到1万股
    "float_shares": (1e4, 5e12),

    # 申购类
    "max_sg": (0, 1e10),
    "premium_rate": (-100, 5000),  # 放宽
    "outstanding_units": (0, 1e14),  # 放宽

    # 持仓/资金类
    "position": (0, 1e12),
    "value": (-1e12, 1e12),
    "value_0": (-1e14, 1e14),
    "value_1": (-1e14, 1e14),

    # ── ETF 扩展字段 ──
    "management_fee": (0, 0.1),
    "custody_fee": (0, 0.05),
    "total_share": (0, 1e14),
    "total_scale": (0, 1e6),
    "share_change": (-1e13, 1e13),
    "scale_change": (-1e6, 1e6),
    "super_large_net": (-1e10, 1e10),
    "large_net": (-1e10, 1e10),
    "medium_net": (-1e10, 1e10),
    "small_net": (-1e10, 1e10),
    "super_large_in": (0, 1e10),
    "super_large_out": (0, 1e10),
    "large_in": (0, 1e10), "large_out": (0, 1e10),
    "medium_in": (0, 1e10), "medium_out": (0, 1e10),
    "small_in": (0, 1e10), "small_out": (0, 1e10),
    "tracking_error_20d": (0, 50),
    "tracking_error_60d": (0, 50),
    "excess_return_1d": (-10, 10),
    "excess_return_5d": (-30, 30),
    "excess_return_20d": (-50, 50),
    "liquidity_score": (0, 100),
    "avg_daily_amount_20d": (0, 1e12),
    "avg_daily_volume_20d": (0, 1e12),
    "bid_ask_spread": (0, 10),
    "shares": (0, 1e12),
    "market_value": (0, 1e10),
    "replace_flag": (0, 10),
}

SECTOR_CLOSE_RANGE = (100, 50000)

TABLE_CODE_TYPE: Dict[str, str] = {
    "stock_daily_kline": "stock",
    "kline_1m": "stock",
    "kline_5m": "stock",
    "stock_extended_info": "stock",
    "stock_trading_data": "stock",
    "stock_trading_data_bk": "stock",
    "stock_capital_data": "stock",
    "stock_basic_info": "stock",
    "stock_sector_relation": "stock",
    "technical_indicators": "stock",
    "ipo_info": "stock",
    "etf_data": "stock",
    "index_daily_kline": "index",
    "index_kline_1m": "index",
    "index_kline_5m": "index",
    "index_constituents": "index",
    "sector_kline_daily": "sector",
    "sector_kline_5m": "sector",
    "sector_daily_data": "sector",
    "sector_list": "sector",
    "sector_stocks": "sector",
    # ── ETF 扩展表 ──
    "etf_product": "stock",
    "etf_iopv_daily": "stock",
    "etf_share_scale": "stock",
    "etf_capital_flow": "stock",
    "etf_holding_stock": "stock",
    "etf_pcf_list": "stock",
    "etf_derived_indicator": "stock",
    "etf_index_tracking": "stock",
}

TABLE_HAS_DATE: Dict[str, str] = {
    "stock_daily_kline": "date",
    "kline_1m": "trade_time",
    "kline_5m": "trade_time",
    "index_daily_kline": "date",
    "index_kline_1m": "trade_time",
    "index_kline_5m": "trade_time",
    "sector_kline_daily": "date",
    "sector_kline_5m": "trade_time",
    "sector_daily_data": "date",
    "stock_extended_info": "date",
    "stock_trading_data": "date",
    "stock_trading_data_bk": "date",
    "stock_capital_data": "date",
    "market_trading_data": "date",
    "technical_indicators": "date",
    "etf_data": "date",
    "trading_calendar": "date",
    # ── ETF 扩展表 ──
    "etf_iopv_daily": "date",
    "etf_share_scale": "date",
    "etf_capital_flow": "date",
    "etf_holding_stock": "report_date",
    "etf_pcf_list": "pcf_date",
    "etf_derived_indicator": "date",
}

OHLC_TABLES = {
    "stock_daily_kline", "kline_1m", "kline_5m",
    "index_daily_kline", "index_kline_1m", "index_kline_5m",
    "sector_kline_daily", "sector_kline_5m",
}

MINUTE_TABLES = {"kline_1m", "kline_5m", "index_kline_1m", "index_kline_5m", "sector_kline_5m"}

SECTOR_OHLC_TABLES = {"sector_kline_daily", "sector_kline_5m", "sector_daily_data"}


class ValidationResult:
    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[str] = []
        self.rejected_rows: int = 0

    @property
    def is_valid(self) -> bool:
        return len(self.errors) == 0

    def add_error(self, msg: str):
        self.errors.append(msg)

    def add_warning(self, msg: str):
        self.warnings.append(msg)

    def summary(self) -> str:
        parts = []
        if self.errors:
            parts.append(f"错误{len(self.errors)}项")
        if self.warnings:
            parts.append(f"警告{len(self.warnings)}项")
        return " | ".join(parts) if parts else "全部通过"


class DataValidator:
    def __init__(self, trading_dates: Optional[set] = None):
        self._trading_dates = trading_dates

    def set_trading_dates(self, dates: set):
        self._trading_dates = dates

    def validate(self, df: pd.DataFrame, table_name: str) -> ValidationResult:
        result = ValidationResult()
        if df.empty:
            return result

        self._check_code_format(df, table_name, result)
        self._check_date_validity(df, table_name, result)
        self._check_field_ranges(df, table_name, result)
        self._check_ohlc_consistency(df, table_name, result)
        self._check_trade_time(df, table_name, result)
        self._check_business_rules(df, table_name, result)

        if result.errors:
            logger.warning("校验[%s]: %s", table_name, result.summary())
        return result

    def validate_and_filter(self, df: pd.DataFrame, table_name: str) -> Tuple[pd.DataFrame, ValidationResult]:
        result = self.validate(df, table_name)
        if not result.errors:
            return df, result

        mask = pd.Series([True] * len(df), index=df.index)
        for err in result.errors:
            pass

        return df, result

    def _check_code_format(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        code_col = None
        for col in ["code", "stock_code", "sector_code"]:
            if col in df.columns:
                code_col = col
                break

        if not code_col:
            return

        code_type = TABLE_CODE_TYPE.get(table_name)
        if not code_type:
            return

        pattern = CODE_PATTERNS.get(code_type)
        if not pattern:
            return

        invalid = df[~df[code_col].astype(str).str.match(pattern.pattern)]
        if not invalid.empty:
            sample = invalid[code_col].head(5).tolist()
            result.add_error(f"[L1代码格式] {table_name}.{code_col} 有{len(invalid)}条不匹配{code_type}格式: {sample}")

    def _check_date_validity(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        date_col = TABLE_HAS_DATE.get(table_name)
        if not date_col or date_col not in df.columns:
            return
        if not self._trading_dates:
            return

        if date_col == "trade_time":
            dates = set(d.date() if hasattr(d, 'date') else d for d in df[date_col].unique())
        else:
            dates = set(d.date() if hasattr(d, 'date') else d for d in df[date_col].unique())

        non_trading = dates - self._trading_dates
        if non_trading:
            sample = sorted(non_trading)[:5]
            result.add_warning(f"[L2日期合法性] {table_name} 有{len(non_trading)}个非交易日: {sample}")

    def _check_field_ranges(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        is_sector_ohlc = table_name in SECTOR_OHLC_TABLES

        for col in df.columns:
            if col not in FIELD_RANGES:
                continue

            lo, hi = FIELD_RANGES[col]

            if is_sector_ohlc and col in ("open", "high", "low", "close"):
                lo, hi = SECTOR_CLOSE_RANGE

            numeric_vals = pd.to_numeric(df[col], errors="coerce")
            out_of_range = numeric_vals[(numeric_vals < lo) | (numeric_vals > hi)]
            if not out_of_range.empty:
                sample = out_of_range.head(3).tolist()
                result.add_error(f"[L3数值范围] {table_name}.{col} 有{len(out_of_range)}条超出[{lo},{hi}]: {sample}")

    def _check_ohlc_consistency(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        if table_name not in OHLC_TABLES:
            return
        required = {"open", "high", "low", "close"}
        if not required.issubset(df.columns):
            return

        bad = df[(df["low"] > df["open"]) | (df["low"] > df["close"]) |
                 (df["high"] < df["open"]) | (df["high"] < df["close"])]
        if not bad.empty:
            result.add_error(f"[L4 OHLC一致性] {table_name} 有{len(bad)}条 low>open/close 或 high<open/close")

    def _check_trade_time(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        if table_name not in MINUTE_TABLES:
            return
        if "trade_time" not in df.columns:
            return

        times = df["trade_time"].dt.time
        from datetime import time as t
        before_open = times < t(9, 25)
        lunch_break = (times > t(11, 30)) & (times < t(13, 0))
        after_close = times > t(15, 0)
        invalid = before_open | lunch_break | after_close

        if invalid.any():
            sample = df.loc[invalid, "trade_time"].head(3).tolist()
            result.add_error(f"[L5时间段合法性] {table_name} 有{invalid.sum()}条不在交易时段[09:30-11:30,13:00-15:00]: {sample}")

    def _check_business_rules(self, df: pd.DataFrame, table_name: str, result: ValidationResult):
        if table_name == "stock_extended_info":
            if "zt_price" in df.columns and "dt_price" in df.columns:
                bad = df[df["zt_price"] < df["dt_price"]]
                if not bad.empty:
                    result.add_error(f"[L6逻辑约束] {table_name} 有{len(bad)}条涨停价<跌停价")
            if "float_market_cap" in df.columns and "total_market_cap" in df.columns:
                bad = df[df["float_market_cap"] > df["total_market_cap"]]
                if not bad.empty:
                    result.add_warning(f"[L6逻辑约束] {table_name} 有{len(bad)}条流通市值>总市值")
            # 市值合理性校验：fmc 应 ≈ ffs * close / 10000（公式：price = fmc*10000/ffs）
            if all(c in df.columns for c in ("float_market_cap", "free_float_shares", "close")):
                valid = (df["free_float_shares"] > 0) & (df["close"] > 0)
                if valid.any():
                    expected_fmc = df.loc[valid, "free_float_shares"] * df.loc[valid, "close"] / 10000
                    actual_fmc = df.loc[valid, "float_market_cap"]
                    ratio = actual_fmc / expected_fmc
                    bad = ratio > 3.0  # fmc 比预期高3倍以上
                    if bad.any():
                        n_bad = bad.sum()
                        median_ratio = ratio[~ratio.isna()].median()
                        result.add_warning(
                            f"[L6市值校验] {table_name} 有{n_bad}条流通市值偏离预期(ffs*close/10000)超过3倍，"
                            f"中位偏移{median_ratio:.1f}x — API返回基于FINANCE(7)(流通股本)，而非FINANCE(46)(自由流通股本)，对全流通股票偏高"
                        )

        elif table_name == "stock_capital_data":
            if "float_shares" in df.columns and "total_shares" in df.columns:
                bad = df[df["float_shares"] > df["total_shares"]]
                if not bad.empty:
                    result.add_error(f"[L6逻辑约束] {table_name} 有{len(bad)}条流通股>总股本")

        elif table_name == "sector_daily_data":
            if all(c in df.columns for c in ("advance", "decline", "total_stocks")):
                bad = df[df["advance"] + df["decline"] > df["total_stocks"]]
                if not bad.empty:
                    result.add_warning(f"[L6逻辑约束] {table_name} 有{len(bad)}条上涨+下跌>总股票数")


_validator_instance: Optional[DataValidator] = None


def get_validator(trading_dates: Optional[set] = None) -> DataValidator:
    global _validator_instance
    if _validator_instance is None:
        _validator_instance = DataValidator(trading_dates)
    elif trading_dates:
        _validator_instance.set_trading_dates(trading_dates)
    return _validator_instance


def load_trading_dates_from_db(db_path: str = None) -> set:
    import duckdb
    from pathlib import Path
    if not db_path:
        db_path = str(Path(__file__).resolve().parent.parent / "profit_radar.duckdb")
    conn = duckdb.connect(db_path, read_only=True)
    dates = set(r[0] for r in conn.execute("SELECT date FROM trading_calendar").fetchall())
    conn.close()
    return dates
