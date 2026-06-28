#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
统一数据质量检查系统 — 覆盖全部 30+ 表，9 类检查

用法:
    from db.data_quality import DataQualityChecker
    checker = DataQualityChecker()
    report = checker.run_all()                # 全部检查
    report = checker.run_category("gaps")     # 单类检查
    report = checker.run_table("stock_daily_kline")  # 单表检查
    print(checker.format_report(report))
    checker.to_json(report, "report.json")

检查类别:
    C1 non_trading_day   非交易日数据检测
    C2 field_validation  字段范围/null/OHLC验证
    C3 date_time         日期/时间合法性
    C4 unit_consistency  单位一致性
    C5 completeness      每股数据完整性
    C6 gaps              缺口检测(日期/分钟级)
    C7 agg_chain         聚合链验证(5m→60m, daily→weekly/monthly)
    C8 cross_table       跨表一致性(市值、涨跌停)
    C9 duplicates        重复/PK冲突
"""

import json
import duckdb
import logging
import pandas as pd
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Set

logger = logging.getLogger(__name__)

BASE_PATH = Path(__file__).resolve().parent.parent
DB_PATH = str(BASE_PATH / "profit_radar.duckdb")

# ============================================================
# 数据结构
# ============================================================

@dataclass
class TableMeta:
    """表元数据"""
    code_col: str = None           # "code" | "sector_code" | None
    date_col: str = None           # "date" | "trade_time" | None
    date_type: str = None          # "date" | "timestamp" | None
    code_type: str = None          # "stock" | "index" | "sector" | None
    has_ohlc: bool = False
    is_minute: bool = False
    is_eav: bool = False
    is_view: bool = False
    minutes_per_bar: int = 0
    bars_per_day: int = 0
    agg_source: str = None
    agg_ratio: int = 0
    pk_cols: list = None
    ohlc_fields: list = None
    extra_numeric: list = None
    sector_price: bool = False     # 板块用点数单位
    volume_range: tuple = None     # 覆盖默认 volume 范围
    change_pct_range: tuple = None  # 覆盖默认 change_pct 范围


@dataclass
class CheckResult:
    """单次检查结果"""
    check_id: str
    table_name: str
    severity: str              # "error" | "warning" | "info"
    passed: bool
    message: str
    detail: dict = field(default_factory=dict)
    affected_count: int = 0
    total_count: int = 0
    sample_rows: list = field(default_factory=list)


@dataclass
class GapRecord:
    """缺口记录"""
    table_name: str
    code: str
    gap_start: str
    gap_end: str
    gap_type: str              # "missing_day" | "missing_minute"
    expected_records: int
    actual_records: int
    fillable: bool


@dataclass
class RepairCandidate:
    """修复建议"""
    table_name: str
    repair_type: str           # "reaggregate" | "delete_non_trading" | "delete_duplicates"
    description: str
    sql_or_command: str
    estimated_records: int
    risk_level: str            # "safe" | "moderate" | "risky"


@dataclass
class QualityReport:
    """质量报告"""
    generated_at: str
    overall_score: float
    check_results: list        # List[CheckResult]
    gaps: list                 # List[GapRecord]
    repair_candidates: list    # List[RepairCandidate]
    total_checks: int
    passed_checks: int
    error_count: int
    warning_count: int


# ============================================================
# TABLE_REGISTRY — 30+ 表完整配置
# ============================================================

TABLE_REGISTRY: Dict[str, TableMeta] = {
    # ── K线表 ──
    "stock_daily_kline": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", has_ohlc=True,
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct", "turnover", "forward_factor"],
    ),
    "kline_1m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True, is_view=True,
        minutes_per_bar=1, bars_per_day=240,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "kline_5m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True, is_view=True,
        minutes_per_bar=5, bars_per_day=48,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "kline_15m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True,
        minutes_per_bar=15, bars_per_day=16,
        agg_source="kline_5m", agg_ratio=3,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "kline_30m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True,
        minutes_per_bar=30, bars_per_day=8,
        agg_source="kline_5m", agg_ratio=6,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "kline_60m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True,
        minutes_per_bar=60, bars_per_day=4,
        agg_source="kline_5m", agg_ratio=12,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "stock_kline_weekly": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", has_ohlc=True,
        agg_source="stock_daily_kline",
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct"],
        volume_range=(0, 5e11),
    ),
    "stock_kline_monthly": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", has_ohlc=True,
        agg_source="stock_daily_kline",
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct"],
        volume_range=(0, 5e11),
    ),
    # ── 指数表 ──
    "index_daily_kline": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="index", has_ohlc=True,
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct"],
    ),
    "index_kline_1m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="index", has_ohlc=True, is_minute=True,
        minutes_per_bar=1, bars_per_day=240,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "index_kline_5m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="index", has_ohlc=True, is_minute=True,
        minutes_per_bar=5, bars_per_day=48,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "index_kline_60m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="index", has_ohlc=True, is_minute=True,
        minutes_per_bar=60, bars_per_day=4,
        agg_source="index_kline_5m", agg_ratio=12,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    # ── 板块表 ──
    "sector_kline_daily": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="sector", has_ohlc=True, sector_price=True,
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct"],
        change_pct_range=(-100, 500000),
    ),
    "sector_kline_5m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="sector", has_ohlc=True, is_minute=True, sector_price=True,
        minutes_per_bar=5, bars_per_day=48,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "sector_kline_60m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="sector", has_ohlc=True, is_minute=True, sector_price=True,
        minutes_per_bar=60, bars_per_day=4,
        agg_source="sector_kline_5m", agg_ratio=12,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    "sector_daily_data": TableMeta(
        code_col="sector_code", date_col="date", date_type="date",
        code_type="sector",
        pk_cols=["sector_code", "date"],
        extra_numeric=["change_pct", "amount", "turnover", "advance", "decline",
                       "total_stocks", "pe_ttm", "pb_mrq", "total_market_cap",
                       "limit_up", "limit_down"],
    ),
    # ── ETF表 ──
    "etf_data": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["price", "pre_close", "iopv", "outstanding_units", "scale"],
    ),
    "etf_daily_kline": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", has_ohlc=True,
        pk_cols=["code", "date"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount", "change_pct"],
    ),
    "etf_kline_1m": TableMeta(
        code_col="code", date_col="trade_time", date_type="timestamp",
        code_type="stock", has_ohlc=True, is_minute=True,
        minutes_per_bar=1, bars_per_day=240,
        pk_cols=["code", "trade_time"],
        ohlc_fields=["open", "high", "low", "close"],
        extra_numeric=["volume", "amount"],
    ),
    # etf_kline_5m and etf_kline_60m created dynamically
    # ── ETF 扩展表 ──
    "etf_product": TableMeta(
        code_col="code", date_col=None,
        code_type="stock",
        pk_cols=["code"],
        extra_numeric=["management_fee", "custody_fee"],
    ),
    "etf_iopv_daily": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["close", "iopv", "premium_rate", "total_share",
                       "total_scale", "pre_close"],
    ),
    "etf_share_scale": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["total_share", "total_scale", "share_change", "scale_change"],
    ),
    "etf_capital_flow": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["super_large_net", "large_net", "medium_net", "small_net",
                       "super_large_in", "super_large_out", "large_in", "large_out",
                       "medium_in", "medium_out", "small_in", "small_out"],
    ),
    "etf_holding_stock": TableMeta(
        code_col="etf_code", date_col="report_date", date_type="date",
        code_type="stock",
        pk_cols=["etf_code", "report_date", "stock_code"],
        extra_numeric=["weight", "shares", "market_value"],
    ),
    "etf_pcf_list": TableMeta(
        code_col="etf_code", date_col="pcf_date", date_type="date",
        code_type="stock",
        pk_cols=["etf_code", "pcf_date", "stock_code"],
        extra_numeric=["shares", "amount"],
    ),
    "etf_derived_indicator": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["tracking_error_20d", "tracking_error_60d",
                       "excess_return_1d", "excess_return_5d", "excess_return_20d",
                       "liquidity_score", "avg_daily_amount_20d", "avg_daily_volume_20d",
                       "bid_ask_spread"],
    ),
    "etf_index_tracking": TableMeta(
        code_col="etf_code", date_col=None,
        code_type="stock",
        pk_cols=["etf_code", "index_code"],
    ),
    # ── EAV表 ──
    "stock_trading_data": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", is_eav=True,
        pk_cols=["code", "date", "field_type", "field_name"],
        extra_numeric=["value_0", "value_1"],
    ),
    "stock_trading_data_bk": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", is_eav=True,
        pk_cols=["code", "date", "field"],
        extra_numeric=["value_0", "value_1"],
    ),
    "sector_trading_data": TableMeta(
        code_col="sector_code", date_col="date", date_type="date",
        code_type="sector", is_eav=True,
        pk_cols=["sector_code", "date", "field_type", "field_name"],
        extra_numeric=["value_0", "value_1"],
    ),
    "market_trading_data": TableMeta(
        code_col=None, date_col="date", date_type="date",
        is_eav=True,
        pk_cols=["date", "field_name", "market"],
        extra_numeric=["value_0", "value_1"],
    ),
    "financial_data": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", is_eav=True,
        pk_cols=["code", "date", "report_type", "field_name"],
        extra_numeric=["field_value"],
    ),
    "technical_indicators": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock", is_eav=True,
        pk_cols=["code", "date", "formula_name", "output_key"],
        extra_numeric=["value"],
    ),
    # ── 基础/快照表 ──
    "stock_basic_info": TableMeta(
        code_col="code", date_col=None,
        code_type="stock",
        pk_cols=["code"],
    ),
    "stock_extended_info": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["zt_price", "dt_price", "total_market_cap", "float_market_cap",
                       "pe_ttm", "pb_mrq", "dy_ratio", "turnover_rate", "volume_ratio",
                       "zaf", "beta_value", "free_float_shares"],
    ),
    "stock_capital_data": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["total_shares", "float_shares"],
    ),
    "stock_dividend_data": TableMeta(
        code_col="code", date_col="ex_date", date_type="date",
        code_type="stock",
        pk_cols=["code", "ex_date"],
        extra_numeric=["dividend_cash", "dividend_share", "right_issue_price",
                       "right_issue_ratio"],
    ),
    "ipo_info": TableMeta(
        code_col="code", date_col=None,
        code_type="stock",
        pk_cols=["code"],
        extra_numeric=["sg_price", "max_sg", "pe_issue"],
    ),
    # ── 映射表 ──
    "sector_list": TableMeta(
        code_col="sector_code", date_col=None,
        code_type="sector",
        pk_cols=["sector_code"],
        extra_numeric=["stock_count"],
    ),
    "stock_sector_relation": TableMeta(
        code_col="stock_code", date_col=None,
        code_type="stock",
        pk_cols=["stock_code", "sector_code"],
    ),
    "sector_stocks": TableMeta(
        code_col="sector_code", date_col=None,
        code_type="sector",
        pk_cols=["sector_code", "stock_code"],
    ),
    "index_constituents": TableMeta(
        code_col="index_code", date_col=None,
        code_type="index",
        pk_cols=["index_code", "stock_code"],
        extra_numeric=["weight"],
    ),
    # ── 其他表 ──
    "trading_calendar": TableMeta(
        code_col=None, date_col="date", date_type="date",
        pk_cols=["date"],
    ),
    "cb_data": TableMeta(
        code_col="code", date_col="date", date_type="date",
        code_type="stock",
        pk_cols=["code", "date"],
        extra_numeric=["zg_price", "rest_scope", "put_back", "force_redeem",
                       "premium_rate", "zg_value"],
    ),
}

# 字段范围（根据实际数据分布校准）
FIELD_RANGES = {
    "open": (0.01, 100000), "high": (0.01, 100000),
    "low": (0.01, 100000), "close": (0.01, 100000),
    "price": (0, 100000), "pre_close": (0, 100000),
    "iopv": (0, 100000), "sg_price": (0.01, 1000),
    # volume: ETF 日成交量可达 484 亿股
    "volume": (0, 5e10), "amount": (0, 5e12),
    # change_pct: 新股首日 +409%, 退市股 -91%, ETF首日可达+900%
    "change_pct": (-100, 1000), "turnover": (0, 100),
    "turnover_rate": (0, 100), "dy_ratio": (0, 100),
    "total_market_cap": (0, 1e6), "float_market_cap": (0, 1e6),
    # free_float_shares: API 返回万股单位, 超大盘可达 315 亿股=3150019 万股
    "free_float_shares": (0, 5e7), "scale": (0, 5e5),
    "pe_ttm": (-2000000, 500000), "pb_mrq": (-5000, 100000),
    "pe_issue": (0, 100000),
    # zt_price/dt_price: 允许 0 (停牌/特殊状态)
    "zt_price": (0, 100000), "dt_price": (0, 100000),
    # zaf: 涨停封板率，可以为负或远超 30
    "zaf": (-30, 2000),
    "beta_value": (-5, 5),
    # forward_factor: 允许 0 (未复权)
    "forward_factor": (0, 100),
    # total_shares/float_shares: 允许 0 (新股尚未公布)
    "total_shares": (0, 5e12), "float_shares": (0, 5e12),
    "advance": (0, 6000), "decline": (0, 6000),
    "total_stocks": (0, 5000), "limit_up": (0, 500),
    "limit_down": (0, 6000), "stock_count": (0, 6000),
    "weight": (0, 100), "volume_ratio": (0, 100),
    "value": (-1e12, 1e12), "value_0": (-1e14, 1e14),
    "value_1": (-1e14, 1e14), "field_value": (-1e14, 1e14),
    "outstanding_units": (0, 1e14), "max_sg": (0, 1e10),
    "premium_rate": (-100, 5000), "position": (0, 1e12),
    # ── ETF 扩展字段 ──
    "management_fee": (0, 0.1), "custody_fee": (0, 0.05),
    "total_share": (0, 1e14), "total_scale": (0, 1e6),
    "share_change": (-1e13, 1e13), "scale_change": (-1e6, 1e6),
    "super_large_net": (-1e10, 1e10), "large_net": (-1e10, 1e10),
    "medium_net": (-1e10, 1e10), "small_net": (-1e10, 1e10),
    "super_large_in": (0, 1e10), "super_large_out": (0, 1e10),
    "large_in": (0, 1e10), "large_out": (0, 1e10),
    "medium_in": (0, 1e10), "medium_out": (0, 1e10),
    "small_in": (0, 1e10), "small_out": (0, 1e10),
    "tracking_error_20d": (0, 50), "tracking_error_60d": (0, 50),
    "excess_return_1d": (-10, 10), "excess_return_5d": (-30, 30),
    "excess_return_20d": (-50, 50),
    "liquidity_score": (0, 100),
    "avg_daily_amount_20d": (0, 1e12), "avg_daily_volume_20d": (0, 1e12),
    "bid_ask_spread": (0, 10),
    "shares": (0, 1e12), "market_value": (0, 1e10),
    "replace_flag": (0, 10),
}

# 板块价格范围（点数）— 部分板块指数点数可达四十几万
SECTOR_PRICE_RANGE = (0, 500000)

# 检查类别权重
CATEGORY_WEIGHTS = {
    "non_trading_day":  0.15,
    "field_validation": 0.15,
    "date_time":        0.08,
    "unit_consistency": 0.10,
    "completeness":     0.15,
    "gaps":             0.12,
    "agg_chain":        0.10,
    "cross_table":      0.10,
    "duplicates":       0.05,
}


# ============================================================
# 主类
# ============================================================

class DataQualityChecker:
    """统一数据质量检查器"""

    def __init__(self, db_path: str = None):
        self.db_path = db_path or DB_PATH
        self._conn = None
        self._trading_dates = None
        self._trading_dates_set = None
        self._existing_tables = None

    # ── 连接管理 ──

    def _get_conn(self):
        if self._conn is None:
            self._conn = duckdb.connect(self.db_path, read_only=True)
        return self._conn

    def _close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def _query(self, sql: str) -> pd.DataFrame:
        return self._get_conn().execute(sql).fetchdf()

    def _get_existing_tables(self) -> Set[str]:
        if self._existing_tables is None:
            df = self._query(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema='main'"
            )
            self._existing_tables = set(df["table_name"].tolist())
        return self._existing_tables

    def _table_exists(self, name: str) -> bool:
        return name in self._get_existing_tables()

    # ── 交易日历 ──

    def _load_trading_dates(self) -> pd.DataFrame:
        if self._trading_dates is None:
            self._trading_dates = self._query(
                "SELECT date FROM trading_calendar WHERE is_trading = true ORDER BY date"
            )
        return self._trading_dates

    def _get_trading_dates_set(self) -> Set:
        if self._trading_dates_set is None:
            df = self._load_trading_dates()
            self._trading_dates_set = set(df["date"].tolist())
        return self._trading_dates_set

    def _get_recent_trading_dates(self, n: int = 5) -> list:
        df = self._load_trading_dates()
        return df["date"].tolist()[-n:]

    # ── 日期提取 ──

    def _date_expr(self, meta: TableMeta) -> str:
        """获取日期列的 SQL 表达式（统一输出为 date 类型）"""
        if meta.date_type == "timestamp":
            return f"{meta.date_col}::date"
        return meta.date_col

    # ================================================================
    # 入口方法
    # ================================================================

    def run_all(self, categories: List[str] = None) -> QualityReport:
        """运行全部检查"""
        all_categories = list(CATEGORY_WEIGHTS.keys())
        cats = categories or all_categories

        all_results = []
        all_gaps = []

        for cat in cats:
            results, gaps = self._run_category_internal(cat)
            all_results.extend(results)
            all_gaps.extend(gaps)

        repairs = self._generate_repairs(all_results, all_gaps)
        score = self._compute_score(all_results)

        passed = sum(1 for r in all_results if r.passed)
        errors = sum(1 for r in all_results if r.severity == "error" and not r.passed)
        warnings = sum(1 for r in all_results if r.severity == "warning" and not r.passed)

        report = QualityReport(
            generated_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            overall_score=score,
            check_results=all_results,
            gaps=all_gaps,
            repair_candidates=repairs,
            total_checks=len(all_results),
            passed_checks=passed,
            error_count=errors,
            warning_count=warnings,
        )
        return report

    def run_category(self, category: str) -> List[CheckResult]:
        results, _ = self._run_category_internal(category)
        return results

    def run_table(self, table_name: str) -> List[CheckResult]:
        meta = TABLE_REGISTRY.get(table_name)
        if not meta or not self._table_exists(table_name):
            return [CheckResult(
                check_id="table_exists", table_name=table_name,
                severity="error", passed=False,
                message=f"表 {table_name} 不存在或未注册",
            )]
        results = []
        for cat in CATEGORY_WEIGHTS:
            cat_results, _ = self._run_category_internal(cat, table_filter=table_name)
            results.extend(cat_results)
        return results

    def _run_category_internal(self, category: str,
                                table_filter: str = None
                                ) -> Tuple[List[CheckResult], List[GapRecord]]:
        """内部：运行单个检查类别"""
        dispatch = {
            "non_trading_day":  self._check_non_trading_days,
            "field_validation": self._check_field_validation,
            "date_time":        self._check_date_time,
            "unit_consistency": self._check_unit_consistency,
            "completeness":     self._check_completeness,
            "gaps":             self._check_gaps,
            "agg_chain":        self._check_agg_chain,
            "cross_table":      self._check_cross_table,
            "duplicates":       self._check_duplicates,
        }
        fn = dispatch.get(category)
        if fn:
            return fn(table_filter)
        return [], []

    # ================================================================
    # C1: 非交易日检测
    # ================================================================

    # 排除表: 这些表的数据本身允许非交易日/未来日期
    SKIP_NON_TRADING_TABLES = {"stock_dividend_data", "ipo_info"}
    SKIP_FUTURE_DATE_TABLES = {"stock_dividend_data", "ipo_info", "trading_calendar"}

    def _check_non_trading_days(self, table_filter=None) -> Tuple[list, list]:
        results = []
        for tname, meta in TABLE_REGISTRY.items():
            if not meta.date_col or not self._table_exists(tname):
                continue
            if tname in self.SKIP_NON_TRADING_TABLES:
                continue
            if table_filter and tname != table_filter:
                continue
            r = self._find_non_trading_data(tname, meta)
            if r:
                results.append(r)
        return results, []

    def _find_non_trading_data(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        date_expr = self._date_expr(meta)
        sql = f"""
            SELECT {date_expr} as dt, COUNT(*) as cnt
            FROM {table} d
            WHERE NOT EXISTS (
                SELECT 1 FROM trading_calendar tc
                WHERE tc.date = {date_expr} AND tc.is_trading = true
            )
            GROUP BY dt ORDER BY dt
        """
        try:
            df = self._query(sql)
        except Exception as e:
            return CheckResult("non_trading_day", table, "error", False,
                               f"查询失败: {e}")

        if df.empty:
            return CheckResult("non_trading_day", table, "info", True,
                               "无非交易日数据")

        total = df["cnt"].sum()
        dates = df["dt"].tolist()
        sample = dates[:10]
        return CheckResult(
            "non_trading_day", table, "error", False,
            f"发现 {len(dates)} 个非交易日有数据, 共 {int(total)} 条",
            detail={"non_trading_dates": sample, "total_affected": int(total)},
            affected_count=int(total),
            sample_rows=list({"date": str(d), "count": int(c)}
                             for d, c in list(zip(df["dt"].tolist(), df["cnt"].tolist()))[:20]),
        )

    # ================================================================
    # C2: 字段验证（范围 + null + OHLC）
    # ================================================================

    def _check_field_validation(self, table_filter=None) -> Tuple[list, list]:
        results = []
        for tname, meta in TABLE_REGISTRY.items():
            if not self._table_exists(tname):
                continue
            if table_filter and tname != table_filter:
                continue
            # 范围检查
            r = self._check_ranges(tname, meta)
            if r:
                results.append(r)
            # OHLC 一致性
            if meta.has_ohlc:
                r = self._check_ohlc(tname, meta)
                if r:
                    results.append(r)
        return results, []

    def _check_ranges(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        fields_to_check = (meta.ohlc_fields or []) + (meta.extra_numeric or [])
        if not fields_to_check:
            return None

        clauses = []
        for f in fields_to_check:
            rng = FIELD_RANGES.get(f)
            if not rng:
                continue
            lo, hi = rng
            if meta.sector_price and f in ("open", "high", "low", "close"):
                lo, hi = SECTOR_PRICE_RANGE
            if meta.volume_range and f == "volume":
                lo, hi = meta.volume_range
            if f == "change_pct" and getattr(meta, "change_pct_range", None):
                lo, hi = meta.change_pct_range
            clauses.append(
                f"SUM(CASE WHEN {f} < {lo} OR {f} > {hi} THEN 1 ELSE 0 END) as {f}_oor"
            )
        if not clauses:
            return None

        sql = f"SELECT COUNT(*) as total, {', '.join(clauses)} FROM {table}"
        try:
            row = self._query(sql).iloc[0]
        except Exception as e:
            return CheckResult("field_range", table, "error", False,
                               f"查询失败: {e}")

        total = int(row["total"])
        bad_fields = {}
        for f in fields_to_check:
            col = f"{f}_oor"
            if col in row and row[col] > 0:
                bad_fields[f] = int(row[col])

        if not bad_fields:
            return CheckResult("field_range", table, "info", True,
                               f"字段范围全部正常 ({len(fields_to_check)} 字段)",
                               total_count=total)

        return CheckResult(
            "field_range", table, "error", False,
            f"{len(bad_fields)} 个字段有超范围值: {bad_fields}",
            detail=bad_fields,
            affected_count=sum(bad_fields.values()),
            total_count=total,
        )

    def _check_ohlc(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        if not meta.has_ohlc:
            return None
        sql = f"""
            SELECT COUNT(*) as bad
            FROM {table}
            WHERE low > open OR low > close
               OR high < open OR high < close
               OR low > high
        """
        try:
            bad = int(self._query(sql).iloc[0]["bad"])
        except Exception as e:
            return CheckResult("ohlc_consistency", table, "error", False,
                               f"查询失败: {e}")

        total_sql = f"SELECT COUNT(*) as c FROM {table}"
        total = int(self._query(total_sql).iloc[0]["c"])

        if bad == 0:
            return CheckResult("ohlc_consistency", table, "info", True,
                               "OHLC 一致性正常", total_count=total)

        return CheckResult(
            "ohlc_consistency", table, "error", False,
            f"OHLC 不一致: {bad} 条 (low>open/close 或 high<open/close)",
            affected_count=bad, total_count=total,
        )

    # ================================================================
    # C3: 日期/时间检查
    # ================================================================

    def _check_date_time(self, table_filter=None) -> Tuple[list, list]:
        results = []
        for tname, meta in TABLE_REGISTRY.items():
            if not meta.date_col or not self._table_exists(tname):
                continue
            if table_filter and tname != table_filter:
                continue
            # 未来日期（排除分红/日历等允许未来日期的表）
            if tname not in self.SKIP_FUTURE_DATE_TABLES:
                r = self._check_future_dates(tname, meta)
                if r:
                    results.append(r)
            # 分钟K线时间范围
            if meta.is_minute:
                r = self._check_minute_time(tname, meta)
                if r:
                    results.append(r)
        return results, []

    def _check_future_dates(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        date_expr = self._date_expr(meta)
        sql = f"SELECT COUNT(*) as cnt FROM {table} WHERE {date_expr} > CURRENT_DATE"
        try:
            cnt = int(self._query(sql).iloc[0]["cnt"])
        except Exception as e:
            return CheckResult("future_date", table, "error", False, f"查询失败: {e}")

        if cnt == 0:
            return CheckResult("future_date", table, "info", True,
                               "无未来日期数据")
        return CheckResult("future_date", table, "error", False,
                           f"发现 {cnt} 条未来日期数据",
                           affected_count=cnt)

    def _check_minute_time(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        sql = f"""
            SELECT COUNT(*) as bad
            FROM {table}
            WHERE {meta.date_col}::time < '09:25:00'
               OR ({meta.date_col}::time > '11:30:00'
                   AND {meta.date_col}::time < '13:00:00')
               OR {meta.date_col}::time > '15:01:00'
        """
        try:
            bad = int(self._query(sql).iloc[0]["bad"])
        except Exception as e:
            return CheckResult("minute_time", table, "error", False, f"查询失败: {e}")

        if bad == 0:
            return CheckResult("minute_time", table, "info", True,
                               "分钟K线时间范围正常")
        return CheckResult("minute_time", table, "warning", False,
                           f"发现 {bad} 条时间不在交易时段 [09:25-11:30, 13:00-15:01]",
                           affected_count=bad)

    # ================================================================
    # C4: 单位一致性
    # ================================================================

    def _check_unit_consistency(self, table_filter=None) -> Tuple[list, list]:
        results = []
        # 检查有 amount 字段的表
        amount_tables = [
            ("stock_daily_kline", "amount", "close", "volume"),
            ("index_daily_kline", "amount", "close", "volume"),
            ("sector_kline_daily", "amount", "close", "volume"),
            ("etf_daily_kline", "amount", "close", "volume"),
        ]
        for tname, amt_col, price_col, vol_col in amount_tables:
            if table_filter and tname != table_filter:
                continue
            if not self._table_exists(tname):
                continue
            r = self._check_amount_unit(tname, amt_col, price_col, vol_col)
            if r:
                results.append(r)

        # 检查 amount 在 stock_daily_kline 中的单位
        if not table_filter or table_filter == "stock_daily_kline":
            if self._table_exists("stock_daily_kline"):
                r = self._check_amount_vs_volume()
                if r:
                    results.append(r)

        return results, []

    def _check_amount_unit(self, table: str, amt_col: str,
                           price_col: str, vol_col: str) -> Optional[CheckResult]:
        sql = f"""
            SELECT AVG({amt_col}) as avg_amt, MAX({amt_col}) as max_amt,
                   AVG({price_col}) as avg_price, AVG({vol_col}) as avg_vol
            FROM {table} WHERE {amt_col} > 0
        """
        try:
            row = self._query(sql).iloc[0]
        except Exception:
            return None

        avg_amt = float(row["avg_amt"]) if pd.notna(row["avg_amt"]) else 0
        if avg_amt == 0:
            return None

        # 判断单位: 万元级 (avg < 1e6) 还是元级 (avg > 1e6)
        detected = "unknown"
        if avg_amt < 1e6:
            detected = "likely_wan_yuan"
        elif avg_amt > 1e8:
            detected = "likely_yuan"

        passed = detected in ("likely_wan_yuan", "unknown")
        return CheckResult(
            "amount_unit", table, "info" if passed else "warning",
            passed,
            f"amount 平均值={avg_amt:,.0f}, 判定单位={detected}",
            detail={"avg_amount": avg_amt, "max_amount": float(row["max_amt"])},
        )

    def _check_amount_vs_volume(self) -> Optional[CheckResult]:
        """检查 amount(万元) ≈ close * volume / 10000"""
        sql = """
            SELECT COUNT(*) as inconsistent
            FROM stock_daily_kline
            WHERE amount > 0 AND volume > 0 AND close > 0
              AND ABS(amount / (close * volume / 10000.0) - 1) > 5.0
        """
        try:
            bad = int(self._query(sql).iloc[0]["inconsistent"])
        except Exception:
            return None

        if bad == 0:
            return CheckResult("amount_volume_ratio", "stock_daily_kline",
                               "info", True, "amount/volume/close 单位一致")
        return CheckResult(
            "amount_volume_ratio", "stock_daily_kline",
            "warning", False,
            f"{bad} 条 amount 与 close*volume/10000 偏差超过5倍，可能单位不一致",
            affected_count=bad,
        )

    # ================================================================
    # C5: 数据完整性（每股覆盖）
    # ================================================================

    def _check_completeness(self, table_filter=None) -> Tuple[list, list]:
        results = []
        # 只对有 code_col + date_col 且非 EAV 的表做 per-stock 检查
        target_tables = [
            "stock_daily_kline", "index_daily_kline",
            "sector_kline_daily", "etf_daily_kline",
            "stock_extended_info", "stock_capital_data",
            "etf_iopv_daily",
        ]
        for tname in target_tables:
            if table_filter and tname != table_filter:
                continue
            if not self._table_exists(tname):
                continue
            meta = TABLE_REGISTRY.get(tname)
            if not meta or not meta.date_col or not meta.code_col:
                continue
            r = self._check_per_stock_coverage(tname, meta)
            if r:
                results.append(r)
        return results, []

    def _check_per_stock_coverage(self, table: str,
                                   meta: TableMeta) -> Optional[CheckResult]:
        date_expr = self._date_expr(meta)
        cc = meta.code_col
        # 最近 10 个交易日的覆盖情况
        recent_dates = self._get_recent_trading_dates(10)
        if not recent_dates:
            return None
        dates_str = ", ".join(f"'{d}'" for d in recent_dates)

        sql = f"""
            SELECT {cc} as code, COUNT(DISTINCT {date_expr}) as day_count
            FROM {table}
            WHERE {date_expr} IN ({dates_str})
            GROUP BY {cc}
        """
        try:
            df = self._query(sql)
        except Exception as e:
            return CheckResult("per_stock_coverage", table, "error", False,
                               f"查询失败: {e}")

        if df.empty:
            return CheckResult("per_stock_coverage", table, "warning", False,
                               "近10个交易日无数据")

        total_codes = len(df)
        full_cover = len(df[df["day_count"] >= 8])
        partial = len(df[(df["day_count"] > 0) & (df["day_count"] < 8)])
        missing_pct = partial / total_codes * 100 if total_codes > 0 else 0

        if missing_pct < 5:
            return CheckResult("per_stock_coverage", table, "info", True,
                               f"近10个交易日: {total_codes} 只股票, "
                               f"{full_cover} 只全覆盖, {partial} 只部分覆盖 ({missing_pct:.1f}%)",
                               detail={"total_codes": total_codes,
                                       "full_cover": full_cover,
                                       "partial": partial},
                               total_count=total_codes)

        return CheckResult(
            "per_stock_coverage", table, "warning", False,
            f"近10个交易日: {total_codes} 只股票, {partial} 只覆盖不全 ({missing_pct:.1f}%)",
            detail={"total_codes": total_codes,
                    "full_cover": full_cover, "partial": partial},
            affected_count=partial, total_count=total_codes,
        )

    # ================================================================
    # C6: 缺口检测
    # ================================================================

    def _check_gaps(self, table_filter=None) -> Tuple[list, list]:
        results = []
        all_gaps = []

        # 日期级缺口
        date_tables = [
            "stock_daily_kline", "index_daily_kline",
            "sector_kline_daily", "etf_daily_kline",
            "stock_extended_info", "stock_capital_data",
            "stock_trading_data", "market_trading_data",
            "etf_iopv_daily", "etf_share_scale",
            "etf_capital_flow", "etf_derived_indicator",
        ]
        for tname in date_tables:
            if table_filter and tname != table_filter:
                continue
            if not self._table_exists(tname):
                continue
            meta = TABLE_REGISTRY.get(tname)
            if not meta or not meta.date_col:
                continue
            gaps = self._find_missing_days(tname, meta)
            all_gaps.extend(gaps)
            if gaps:
                results.append(CheckResult(
                    "missing_days", tname, "warning", False,
                    f"发现 {len(gaps)} 个缺失交易日",
                    detail={"missing_dates": [g.gap_start for g in gaps[:20]]},
                    affected_count=len(gaps),
                ))
            else:
                results.append(CheckResult("missing_days", tname, "info", True,
                                           "无日期缺口"))

        # 分钟级缺口（最近5天抽样）
        minute_tables = [
            ("kline_1m", 240), ("kline_5m", 48),
            ("index_kline_1m", 240), ("index_kline_5m", 48),
        ]
        for tname, expected_bars in minute_tables:
            if table_filter and tname != table_filter:
                continue
            if not self._table_exists(tname):
                continue
            r = self._find_incomplete_minute_days(tname, expected_bars)
            if r:
                results.append(r)

        return results, all_gaps

    def _find_missing_days(self, table: str, meta: TableMeta) -> List[GapRecord]:
        date_expr = self._date_expr(meta)
        if meta.date_type == "timestamp":
            distinct_date_sql = f"SELECT DISTINCT {date_expr} as d FROM {table}"
        else:
            distinct_date_sql = f"SELECT DISTINCT {meta.date_col} as d FROM {table}"

        sql = f"""
            WITH actual AS ({distinct_date_sql}),
                 bounds AS (
                     SELECT MIN(d) as min_d, MAX(d) as max_d FROM actual
                 )
            SELECT tc.date as missing_date
            FROM trading_calendar tc, bounds b
            WHERE tc.is_trading = true
              AND tc.date BETWEEN b.min_d AND b.max_d
              AND tc.date NOT IN (SELECT d FROM actual)
            ORDER BY tc.date
        """
        try:
            df = self._query(sql)
        except Exception:
            return []

        gaps = []
        for _, row in df.iterrows():
            gaps.append(GapRecord(
                table_name=table, code="ALL",
                gap_start=str(row["missing_date"]),
                gap_end=str(row["missing_date"]),
                gap_type="missing_day",
                expected_records=1, actual_records=0,
                fillable=True,
            ))
        return gaps

    def _find_incomplete_minute_days(self, table: str,
                                      expected_bars: int) -> Optional[CheckResult]:
        recent = self._get_recent_trading_dates(5)
        if not recent:
            return None
        dates_str = ", ".join(f"'{d}'" for d in recent)

        sql = f"""
            SELECT code, trade_time::date as dt, COUNT(*) as bar_count
            FROM {table}
            WHERE trade_time::date IN ({dates_str})
            GROUP BY code, dt
            HAVING COUNT(*) < {expected_bars * 0.8}
            ORDER BY bar_count ASC
            LIMIT 100
        """
        try:
            df = self._query(sql)
        except Exception:
            return None

        if df.empty:
            return CheckResult("incomplete_minute", table, "info", True,
                               f"近5天分钟K线条数正常 (≥{int(expected_bars*0.8)})")

        return CheckResult(
            "incomplete_minute", table, "warning", False,
            f"近5天有 {len(df)} 个(code,date)组合分钟条数不足"
            f" (预期{expected_bars}, 检出<{int(expected_bars*0.8)})",
            affected_count=len(df),
            sample_rows=df.head(10).to_dict("records"),
        )

    # ================================================================
    # C7: 聚合链验证
    # ================================================================

    def _check_agg_chain(self, table_filter=None) -> Tuple[list, list]:
        results = []

        # 5m → 60m (stock)
        agg_checks = [
            ("kline_5m", "kline_60m", 12),
            ("index_kline_5m", "index_kline_60m", 12),
            ("sector_kline_5m", "sector_kline_60m", 12),
        ]
        for src, dst, ratio in agg_checks:
            if table_filter and dst != table_filter:
                continue
            if not self._table_exists(src) or not self._table_exists(dst):
                continue
            r = self._verify_agg(src, dst, ratio)
            if r:
                results.append(r)

        # daily → weekly / monthly
        for dst_name in ["stock_kline_weekly", "stock_kline_monthly"]:
            if table_filter and dst_name != table_filter:
                continue
            if not self._table_exists(dst_name):
                continue
            r = self._verify_daily_agg(dst_name)
            if r:
                results.append(r)

        return results, []

    def _verify_agg(self, src: str, dst: str, ratio: int) -> Optional[CheckResult]:
        """验证 5m→60m 聚合一致性（抽样 3 天）"""
        recent = self._get_recent_trading_dates(3)
        if not recent:
            return None
        dates_str = ", ".join(f"'{d}'" for d in recent)

        sql = f"""
            WITH numbered AS (
                SELECT code, trade_time,
                    (ROW_NUMBER() OVER (
                        PARTITION BY code, trade_time::date
                        ORDER BY trade_time) - 1) // {ratio} as grp,
                    volume, high, low, open, close, amount
                FROM {src}
                WHERE trade_time::date IN ({dates_str})
            ),
            src_agg AS (
                SELECT code, trade_time::date as dt, grp,
                    SUM(volume) as sum_vol, MAX(high) as max_high,
                    MIN(low) as min_low,
                    FIRST(open ORDER BY trade_time) as first_open,
                    LAST(close ORDER BY trade_time) as last_close
                FROM numbered
                GROUP BY code, trade_time::date, grp
            ),
            dst_grp AS (
                SELECT code, trade_time::date as dt,
                    (ROW_NUMBER() OVER (
                        PARTITION BY code, trade_time::date
                        ORDER BY trade_time) - 1) as grp,
                    volume, high, low, open, close
                FROM {dst}
                WHERE trade_time::date IN ({dates_str})
            )
            SELECT COUNT(*) as total,
                SUM(CASE WHEN ABS(f.sum_vol - d.volume) > 1 THEN 1 ELSE 0 END) as vol_mismatch,
                SUM(CASE WHEN ABS(f.max_high - d.high) > 0.01 THEN 1 ELSE 0 END) as high_mismatch,
                SUM(CASE WHEN ABS(f.min_low - d.low) > 0.01 THEN 1 ELSE 0 END) as low_mismatch
            FROM src_agg f
            JOIN dst_grp d ON f.code = d.code AND f.dt = d.dt AND f.grp = d.grp
        """
        try:
            row = self._query(sql).iloc[0]
        except Exception as e:
            return CheckResult("agg_chain", dst, "error", False,
                               f"查询失败: {e}")

        total = int(row["total"]) if pd.notna(row["total"]) else 0
        if total == 0:
            return CheckResult("agg_chain", dst, "warning", False,
                               "无法比较（抽样无数据）")

        vol_m = int(row["vol_mismatch"]) if pd.notna(row["vol_mismatch"]) else 0
        hi_m = int(row["high_mismatch"]) if pd.notna(row["high_mismatch"]) else 0
        lo_m = int(row["low_mismatch"]) if pd.notna(row["low_mismatch"]) else 0

        mismatches = vol_m + hi_m + lo_m
        if mismatches == 0:
            return CheckResult("agg_chain", dst, "info", True,
                               f"{src}→{dst} 聚合一致 (抽样{total}条)")

        return CheckResult(
            "agg_chain", dst, "error", False,
            f"{src}→{dst} 聚合不一致: vol={vol_m}, high={hi_m}, low={lo_m}"
            f" (抽样{total}条)",
            affected_count=mismatches, total_count=total,
        )

    def _verify_daily_agg(self, dst: str) -> Optional[CheckResult]:
        """验证 daily → weekly/monthly 聚合
        注意: weekly/monthly 的 date 是该周的最后一个交易日/月末最后一个交易日，
        不是简单的 SUM(daily WHERE date BETWEEN ...)。这里只做抽样验证最近数据。
        """
        if not self._table_exists("stock_daily_kline"):
            return None

        # 取最近一个 weekly/monthly 的 date，看是否能找到对应的 daily 数据
        if "weekly" in dst:
            agg_type = "weekly"
        else:
            agg_type = "monthly"

        # 简单验证: 最近 5 条 weekly/monthly 的 volume 不应为 0
        sql = f"""
            SELECT COUNT(*) as total,
                SUM(CASE WHEN volume = 0 THEN 1 ELSE 0 END) as zero_vol,
                SUM(CASE WHEN close <= 0 THEN 1 ELSE 0 END) as zero_close
            FROM {dst}
            WHERE date >= (SELECT MAX(date) - INTERVAL 30 DAY FROM {dst})
        """
        try:
            row = self._query(sql).iloc[0]
        except Exception:
            return None

        total = int(row["total"]) if pd.notna(row["total"]) else 0
        zero_vol = int(row["zero_vol"]) if pd.notna(row["zero_vol"]) else 0
        zero_close = int(row["zero_close"]) if pd.notna(row["zero_close"]) else 0

        if total == 0:
            return None
        issues = zero_vol + zero_close
        if issues == 0:
            return CheckResult("agg_chain", dst, "info", True,
                               f"daily→{dst} 近期数据正常 (抽样{total}条)")

        return CheckResult(
            "agg_chain", dst, "warning", False,
            f"daily→{dst} 近期有异常: zero_vol={zero_vol}, zero_close={zero_close}",
            affected_count=issues, total_count=total,
        )

    # ================================================================
    # C8: 跨表验证
    # ================================================================

    def _check_cross_table(self, table_filter=None) -> Tuple[list, list]:
        results = []
        tables_needed = ["stock_extended_info", "stock_daily_kline", "stock_capital_data"]

        # 市值交叉校验
        if all(self._table_exists(t) for t in tables_needed):
            if not table_filter or table_filter in tables_needed:
                r = self._check_market_cap()
                if r:
                    results.append(r)

        # 涨跌停价 vs 收盘价
        if (self._table_exists("stock_extended_info")
                and self._table_exists("stock_daily_kline")):
            if not table_filter or table_filter in ("stock_extended_info", "stock_daily_kline"):
                r = self._check_zt_dt_price()
                if r:
                    results.append(r)

        return results, []

    def _check_market_cap(self) -> Optional[CheckResult]:
        """总市值 ≈ total_shares * close / 1e8"""
        sql = """
            SELECT COUNT(*) as total,
                SUM(CASE
                    WHEN ABS(e.total_market_cap -
                        (c.total_shares * k.close / 1e8))
                        / NULLIF(e.total_market_cap, 0) > 0.05
                    THEN 1 ELSE 0 END) as mismatch
            FROM stock_extended_info e
            JOIN stock_daily_kline k ON e.code = k.code AND e.date = k.date
            JOIN stock_capital_data c ON e.code = c.code AND e.date = c.date
            WHERE e.total_market_cap > 0
              AND c.total_shares > 0 AND k.close > 0
        """
        try:
            row = self._query(sql).iloc[0]
        except Exception:
            return None

        total = int(row["total"]) if pd.notna(row["total"]) else 0
        mismatch = int(row["mismatch"]) if pd.notna(row["mismatch"]) else 0

        if total == 0:
            return None
        pct = mismatch / total * 100
        if pct < 5:
            return CheckResult("cross_market_cap", "stock_extended_info",
                               "info", True,
                               f"市值交叉校验: {total} 条中 {mismatch} 条偏差>5%")

        return CheckResult(
            "cross_market_cap", "stock_extended_info",
            "warning" if pct < 20 else "error", False,
            f"市值交叉校验: {mismatch}/{total} ({pct:.1f}%) 偏差>5%",
            affected_count=mismatch, total_count=total,
        )

    def _check_zt_dt_price(self) -> Optional[CheckResult]:
        """收盘价不应超过涨停价或低于跌停价（排除停牌 zt=0 的记录）"""
        sql = """
            SELECT COUNT(*) as bad
            FROM stock_extended_info e
            JOIN stock_daily_kline k ON e.code = k.code AND e.date = k.date
            WHERE e.zt_price > 0
              AND (k.close > e.zt_price + 0.01
               OR k.close < e.dt_price - 0.01)
        """
        try:
            bad = int(self._query(sql).iloc[0]["bad"])
        except Exception:
            return None

        if bad == 0:
            return CheckResult("zt_dt_vs_close", "stock_extended_info",
                               "info", True, "收盘价均在涨跌停范围内")
        return CheckResult(
            "zt_dt_vs_close", "stock_extended_info",
            "error", False,
            f"{bad} 条收盘价超出涨跌停范围",
            affected_count=bad,
        )

    # ================================================================
    # C9: 重复/PK冲突检测
    # ================================================================

    def _check_duplicates(self, table_filter=None) -> Tuple[list, list]:
        results = []
        for tname, meta in TABLE_REGISTRY.items():
            if not meta.pk_cols or not self._table_exists(tname):
                continue
            if table_filter and tname != table_filter:
                continue
            r = self._check_pk_duplicates(tname, meta)
            if r:
                results.append(r)
        return results, []

    def _check_pk_duplicates(self, table: str, meta: TableMeta) -> Optional[CheckResult]:
        pk = meta.pk_cols
        if not pk:
            return None
        pk_str = ", ".join(pk)
        sql = f"""
            SELECT {pk_str}, COUNT(*) as cnt
            FROM {table}
            GROUP BY {pk_str}
            HAVING COUNT(*) > 1
            LIMIT 100
        """
        try:
            df = self._query(sql)
        except Exception:
            return None

        if df.empty:
            return CheckResult("pk_duplicate", table, "info", True,
                               "无PK冲突")

        return CheckResult(
            "pk_duplicate", table, "error", False,
            f"发现 {len(df)} 组PK冲突",
            affected_count=len(df),
            sample_rows=df.head(10).to_dict("records"),
        )

    # ================================================================
    # 评分
    # ================================================================

    def _compute_score(self, results: List[CheckResult]) -> float:
        """计算加权总评分"""
        category_scores = {}

        for r in results:
            # 单项分数
            if r.passed:
                score = 100.0
            elif r.severity == "warning":
                score = 85.0
            else:
                # error: 按 affected/total 比例扣分
                if r.total_count > 0:
                    ratio = r.affected_count / r.total_count
                else:
                    ratio = 1.0
                if ratio < 0.0001:
                    score = 95.0
                elif ratio < 0.01:
                    score = 70.0
                else:
                    score = 40.0

            if r.check_id not in category_scores:
                category_scores[r.check_id] = []
            category_scores[r.check_id].append(score)

        # 按 check_id 分组求平均，再映射到类别
        check_to_category = {
            "non_trading_day": "non_trading_day",
            "field_range": "field_validation", "ohlc_consistency": "field_validation",
            "future_date": "date_time", "minute_time": "date_time",
            "amount_unit": "unit_consistency", "amount_volume_ratio": "unit_consistency",
            "per_stock_coverage": "completeness",
            "missing_days": "gaps", "incomplete_minute": "gaps",
            "agg_chain": "agg_chain",
            "cross_market_cap": "cross_table", "zt_dt_vs_close": "cross_table",
            "pk_duplicate": "duplicates",
        }

        cat_avgs = {}
        for check_id, scores in category_scores.items():
            cat = check_to_category.get(check_id, check_id)
            avg = sum(scores) / len(scores)
            if cat not in cat_avgs:
                cat_avgs[cat] = []
            cat_avgs[cat].append(avg)

        total_weight = 0.0
        weighted_sum = 0.0
        for cat, weight in CATEGORY_WEIGHTS.items():
            if cat in cat_avgs:
                avg = sum(cat_avgs[cat]) / len(cat_avgs[cat])
                weighted_sum += avg * weight
                total_weight += weight

        if total_weight == 0:
            return 0.0
        return round(weighted_sum / total_weight, 1)

    # ================================================================
    # 自动修复
    # ================================================================

    def _generate_repairs(self, results: List[CheckResult],
                          gaps: List[GapRecord]) -> List[RepairCandidate]:
        repairs = []

        # 非交易日数据 → 删除
        for r in results:
            if r.check_id == "non_trading_day" and not r.passed:
                meta = TABLE_REGISTRY.get(r.table_name)
                if meta and meta.date_col:
                    date_expr = self._date_expr(meta)
                    repairs.append(RepairCandidate(
                        table_name=r.table_name,
                        repair_type="delete_non_trading",
                        description=f"删除 {r.table_name} 中 {r.affected_count} 条非交易日数据",
                        sql_or_command=(
                            f"DELETE FROM {r.table_name} WHERE NOT EXISTS ("
                            f"SELECT 1 FROM trading_calendar tc "
                            f"WHERE tc.date = {date_expr} AND tc.is_trading = true)"
                        ),
                        estimated_records=r.affected_count,
                        risk_level="safe",
                    ))

            # PK 冲突 → 删除重复
            if r.check_id == "pk_duplicate" and not r.passed:
                meta = TABLE_REGISTRY.get(r.table_name)
                if meta and meta.pk_cols:
                    pk_str = ", ".join(meta.pk_cols)
                    repairs.append(RepairCandidate(
                        table_name=r.table_name,
                        repair_type="delete_duplicates",
                        description=f"删除 {r.table_name} 中 {r.affected_count} 组PK重复",
                        sql_or_command=(
                            f"DELETE FROM {r.table_name} WHERE rowid NOT IN "
                            f"(SELECT MAX(rowid) FROM {r.table_name} "
                            f"GROUP BY {pk_str})"
                        ),
                        estimated_records=r.affected_count,
                        risk_level="safe",
                    ))

        # 缺口 → 聚合修复
        gap_tables = set()
        for g in gaps:
            if g.fillable:
                meta = TABLE_REGISTRY.get(g.table_name)
                if meta and meta.agg_source:
                    gap_tables.add(g.table_name)

        for tname in gap_tables:
            meta = TABLE_REGISTRY.get(tname)
            repairs.append(RepairCandidate(
                table_name=tname,
                repair_type="reaggregate",
                description=f"从 {meta.agg_source} 重新聚合 {tname}",
                sql_or_command=f"reaggregate:{tname}",
                estimated_records=0,
                risk_level="safe",
            ))

        return repairs

    def execute_repair(self, repair: RepairCandidate, dry_run: bool = True) -> str:
        """执行修复（默认 dry_run 模式）"""
        if dry_run:
            return f"[DRY RUN] {repair.description}\n  SQL: {repair.sql_or_command}"

        # 实际执行需要写连接
        try:
            conn = duckdb.connect(self.db_path, read_only=False)
            conn.execute(repair.sql_or_command)
            affected = conn.execute("SELECT changes()").fetchone()[0]
            conn.close()
            return f"[EXECUTED] {repair.description} — {affected} rows affected"
        except Exception as e:
            return f"[ERROR] {repair.description} — {e}"

    # ================================================================
    # 输出
    # ================================================================

    def format_report(self, report: QualityReport) -> str:
        """控制台格式化输出"""
        lines = []
        lines.append("=" * 60)
        lines.append(f"数据质量报告 — {report.generated_at}")
        lines.append(f"总评分: {report.overall_score:.1f}/100")
        lines.append(f"检查项: {report.total_checks} (通过 {report.passed_checks}, "
                     f"错误 {report.error_count}, 警告 {report.warning_count})")
        lines.append("=" * 60)

        # 按类别分组
        check_to_label = {
            "non_trading_day": "C1 非交易日检测",
            "field_range": "C2 字段范围", "ohlc_consistency": "C2 OHLC一致性",
            "future_date": "C3 未来日期", "minute_time": "C3 时间范围",
            "amount_unit": "C4 单位一致性", "amount_volume_ratio": "C4 成交额校验",
            "per_stock_coverage": "C5 数据完整性",
            "missing_days": "C6 日期缺口", "incomplete_minute": "C6 分钟缺口",
            "agg_chain": "C7 聚合链",
            "cross_market_cap": "C8 市值校验", "zt_dt_vs_close": "C8 涨跌停",
            "pk_duplicate": "C9 PK冲突",
        }

        # 按 table 分组
        by_table = {}
        for r in report.check_results:
            tname = r.table_name
            if tname not in by_table:
                by_table[tname] = []
            by_table[tname].append(r)

        for tname, table_results in sorted(by_table.items()):
            lines.append(f"\n── {tname} ──")
            for r in table_results:
                icon = "✓" if r.passed else ("✗" if r.severity == "error" else "⚠")
                label = check_to_label.get(r.check_id, r.check_id)
                line = f"  {icon} [{label}] {r.message}"
                if r.affected_count > 0:
                    line += f" ({r.affected_count}/{r.total_count})"
                lines.append(line)

        # 缺口汇总
        if report.gaps:
            lines.append(f"\n── 缺口汇总 ({len(report.gaps)} 条) ──")
            gap_by_table = {}
            for g in report.gaps:
                gap_by_table.setdefault(g.table_name, []).append(g)
            for tname, gaps in sorted(gap_by_table.items()):
                dates = [g.gap_start for g in gaps[:10]]
                lines.append(f"  {tname}: {len(gaps)} 个缺失日 {dates}")

        # 修复建议
        if report.repair_candidates:
            lines.append(f"\n── 修复建议 ({len(report.repair_candidates)}) ──")
            for r in report.repair_candidates:
                risk_icon = {"safe": "🟢", "moderate": "🟡", "risky": "🔴"}.get(
                    r.risk_level, "?")
                lines.append(f"  {risk_icon} [{r.repair_type}] {r.description}")

        return "\n".join(lines)

    def to_json(self, report: QualityReport, path: str = None) -> str:
        """JSON 输出"""
        def _serialize(obj):
            if isinstance(obj, (CheckResult, GapRecord, RepairCandidate, QualityReport)):
                return obj.__dict__
            if isinstance(obj, (datetime, date, pd.Timestamp)):
                return str(obj)
            if isinstance(obj, pd.DataFrame):
                return obj.to_dict("records")
            if isinstance(obj, (np_int := type(0))):
                return int(obj)
            return str(obj)

        import numpy as np
        data = {
            "generated_at": report.generated_at,
            "overall_score": report.overall_score,
            "total_checks": report.total_checks,
            "passed_checks": report.passed_checks,
            "error_count": report.error_count,
            "warning_count": report.warning_count,
            "check_results": [
                {
                    "check_id": r.check_id,
                    "table_name": r.table_name,
                    "severity": r.severity,
                    "passed": r.passed,
                    "message": r.message,
                    "affected_count": r.affected_count,
                    "total_count": r.total_count,
                }
                for r in report.check_results
            ],
            "gaps": [
                {
                    "table_name": g.table_name,
                    "gap_start": g.gap_start,
                    "gap_end": g.gap_end,
                    "gap_type": g.gap_type,
                    "fillable": g.fillable,
                }
                for g in report.gaps
            ],
            "repair_candidates": [
                {
                    "table_name": r.table_name,
                    "repair_type": r.repair_type,
                    "description": r.description,
                    "risk_level": r.risk_level,
                }
                for r in report.repair_candidates
            ],
        }

        text = json.dumps(data, ensure_ascii=False, indent=2, default=str)
        if path:
            Path(path).write_text(text, encoding="utf-8")
        return text


# ============================================================
# 快捷入口
# ============================================================

def quick_check(db_path: str = None, categories: List[str] = None) -> QualityReport:
    """快捷检查"""
    checker = DataQualityChecker(db_path)
    report = checker.run_all(categories)
    print(checker.format_report(report))
    checker._close()
    return report


if __name__ == "__main__":
    import sys
    cats = None
    if len(sys.argv) > 1:
        cats = sys.argv[1:]
    quick_check(categories=cats)
