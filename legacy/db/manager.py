"""
DuckDB 连接管理器 — 热数据(DuckDB) + 冷数据(Parquet) 混合架构。

职责：
  - 建表 DDL（20张表）
  - 连接管理（上下文管理器）
  - CRUD 基础操作
  - Parquet 冷热数据归档/查询
  - 数据校验（对接 data_spec.py）
"""

import duckdb
import pandas as pd
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Union
from contextlib import contextmanager
from .data_validator import DataValidator, load_trading_dates_from_db

BASE_PATH = Path(__file__).resolve().parent.parent

# ============================================================
# ===== 可调参数（改这里就行）=====
# ============================================================
DB_PATH = BASE_PATH / "profit_radar.duckdb"
PROGRESS_DB_PATH = BASE_PATH / "progress_monitor.db"
PARQUET_PATH = BASE_PATH / "parquet"
LOGS_PATH = BASE_PATH / "logs"
HOT_YEARS = 2               # 热数据保留年数（超过的归档到Parquet）
# ================================================

for folder in [PARQUET_PATH / "stock_daily", PARQUET_PATH / "sector_daily", LOGS_PATH]:
    folder.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler(LOGS_PATH / "db_manager.log", encoding="utf-8"),
    ],
    force=True,
)
logger = logging.getLogger(__name__)

DDL_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS stock_daily_kline (
        code VARCHAR, date DATE,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume BIGINT, amount DOUBLE, change_pct DOUBLE, turnover DOUBLE,
        forward_factor DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS sector_daily_data (
        sector_code VARCHAR, date DATE, name VARCHAR, sector_type VARCHAR,
        change_pct DOUBLE, amount DOUBLE, turnover DOUBLE,
        advance INTEGER, decline INTEGER, total_stocks INTEGER,
        pe_ttm DOUBLE, pb_mrq DOUBLE, total_market_cap DOUBLE,
        limit_up INTEGER, limit_down INTEGER,
        PRIMARY KEY (sector_code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_basic_info (
        code VARCHAR PRIMARY KEY, name VARCHAR, market VARCHAR,
        list_date DATE, delist_date DATE, main_business VARCHAR,
        is_st BOOLEAN, is_suspend BOOLEAN
    )""",
    """CREATE TABLE IF NOT EXISTS stock_extended_info (
        code VARCHAR, date DATE,
        zt_price DOUBLE, dt_price DOUBLE,
        total_market_cap DOUBLE, float_market_cap DOUBLE,
        pe_ttm DOUBLE, pb_mrq DOUBLE, dy_ratio DOUBLE,
        turnover_rate DOUBLE, volume_ratio DOUBLE,
        zaf DOUBLE, beta_value DOUBLE, free_float_shares DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS financial_data (
        code VARCHAR, date DATE, report_type VARCHAR,
        field_name VARCHAR, field_value DOUBLE,
        PRIMARY KEY (code, date, report_type, field_name)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_trading_data (
        code VARCHAR, date DATE, field_type VARCHAR, field_name VARCHAR,
        value_0 DOUBLE, value_1 DOUBLE,
        PRIMARY KEY (code, date, field_type, field_name)
    )""",
    """CREATE TABLE IF NOT EXISTS sector_trading_data (
        sector_code VARCHAR, date DATE, field_type VARCHAR, field_name VARCHAR,
        value_0 DOUBLE, value_1 DOUBLE,
        PRIMARY KEY (sector_code, date, field_type, field_name)
    )""",
    """CREATE TABLE IF NOT EXISTS market_trading_data (
        date DATE, field_name VARCHAR, value_0 DOUBLE, value_1 DOUBLE,
        market VARCHAR, PRIMARY KEY (date, field_name, market)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_sector_relation (
        stock_code VARCHAR, sector_code VARCHAR, sector_type VARCHAR,
        PRIMARY KEY (stock_code, sector_code)
    )""",
    """CREATE TABLE IF NOT EXISTS sector_list (
        sector_code VARCHAR PRIMARY KEY, name VARCHAR,
        sector_type VARCHAR, stock_count INTEGER, update_date DATE
    )""",
    """CREATE TABLE IF NOT EXISTS sector_hierarchy (
        sector_code VARCHAR PRIMARY KEY, name VARCHAR, category VARCHAR,
        ind1_code VARCHAR, ind2_code VARCHAR, ind3_code VARCHAR
    )""",
    """CREATE TABLE IF NOT EXISTS index_constituents (
        index_code VARCHAR, stock_code VARCHAR, weight DOUBLE,
        in_date DATE, out_date DATE, is_active BOOLEAN,
        PRIMARY KEY (index_code, stock_code)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_minute_kline (
        code VARCHAR, date DATE, time VARCHAR, datetime TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume BIGINT, amount DOUBLE,
        PRIMARY KEY (code, datetime)
    )""",
    """CREATE TABLE IF NOT EXISTS kline_1m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS kline_5m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS kline_15m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS kline_30m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS kline_60m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_kline_weekly (
        code VARCHAR, date DATE,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume BIGINT, amount DOUBLE, change_pct DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_kline_monthly (
        code VARCHAR, date DATE,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume BIGINT, amount DOUBLE, change_pct DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS index_daily_kline (
        code VARCHAR, date DATE,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        change_pct DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS index_kline_1m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS index_kline_5m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS sector_kline_daily (
        code VARCHAR, date DATE,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        change_pct DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS sector_kline_5m (
        code VARCHAR, trade_time TIMESTAMP,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume DOUBLE, amount DOUBLE,
        PRIMARY KEY (code, trade_time)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_trading_data_bk (
        code VARCHAR, date DATE, field VARCHAR,
        value_0 DOUBLE, value_1 DOUBLE,
        PRIMARY KEY (code, date, field)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_capital_data (
        code VARCHAR, date DATE, total_shares BIGINT, float_shares BIGINT,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS stock_dividend_data (
        code VARCHAR, ex_date DATE, record_date DATE,
        dividend_cash DOUBLE, dividend_share DOUBLE,
        right_issue_price DOUBLE, right_issue_ratio DOUBLE,
        PRIMARY KEY (code, ex_date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_data (
        code VARCHAR, date DATE, name VARCHAR, price DOUBLE,
        pre_close DOUBLE, iopv DOUBLE, outstanding_units BIGINT, scale DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS cb_data (
        code VARCHAR, date DATE, name VARCHAR, hs_code VARCHAR,
        zg_price DOUBLE, rest_scope DOUBLE, put_back DOUBLE,
        force_redeem DOUBLE, premium_rate DOUBLE, zg_value DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS futures_data (
        code VARCHAR, date DATE, name VARCHAR,
        open DOUBLE, high DOUBLE, low DOUBLE, close DOUBLE,
        volume BIGINT, amount DOUBLE, position BIGINT,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS trading_calendar (
        date DATE PRIMARY KEY, is_trading BOOLEAN, market VARCHAR
    )""",
    """CREATE TABLE IF NOT EXISTS pipeline_progress (
        id INTEGER PRIMARY KEY,
        task_name TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        total_count INTEGER NOT NULL DEFAULT 0,
        processed_count INTEGER NOT NULL DEFAULT 0,
        last_update TIMESTAMP NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NULL,
        error_message TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        progress_percent DECIMAL(10,2) DEFAULT 0.0,
        metadata JSON NULL
    );

    CREATE INDEX IF NOT EXISTS idx_progress_task ON pipeline_progress(task_name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_progress_task_unique ON pipeline_progress(task_name);
    CREATE INDEX IF NOT EXISTS idx_progress_time ON pipeline_progress(start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_progress_status ON pipeline_progress(status);

    CREATE TABLE IF NOT EXISTS pipeline_progress_history (
        id INTEGER PRIMARY KEY,
        task_name TEXT NOT NULL,
        task_type TEXT NOT NULL,
        status TEXT NOT NULL,
        total_count INTEGER NOT NULL,
        processed_count INTEGER NOT NULL,
        progress_percent DECIMAL(10,2) NOT NULL,
        duration_seconds INTEGER NOT NULL,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        metadata JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_progress_history_task ON pipeline_progress_history(task_name);
    CREATE INDEX IF NOT EXISTS idx_progress_history_time ON pipeline_progress_history(start_time DESC);
    """,
    """CREATE TABLE IF NOT EXISTS data_sync_log (
        id INTEGER PRIMARY KEY, data_type VARCHAR,
        start_date DATE, end_date DATE, sync_time TIMESTAMP,
        record_count INTEGER, status VARCHAR, error_message VARCHAR
    )""",
    """CREATE TABLE IF NOT EXISTS data_archive_log (
        id INTEGER PRIMARY KEY, archive_type VARCHAR, data_type VARCHAR,
        year INTEGER, archive_time TIMESTAMP, record_count INTEGER,
        status VARCHAR, parquet_path VARCHAR
    )""",
    """CREATE TABLE IF NOT EXISTS sector_stocks (
        sector_code VARCHAR, stock_code VARCHAR,
        PRIMARY KEY (sector_code, stock_code)
    )""",
    """CREATE TABLE IF NOT EXISTS fact_finance_report (
        code VARCHAR,
        report_period DATE,
        eps DOUBLE,
        eps_adjusted DOUBLE,
        bvps DOUBLE,
        roe DOUBLE,
        ocfps DOUBLE,
        total_assets DOUBLE,
        total_liabilities DOUBLE,
        share_capital DOUBLE,
        total_equity DOUBLE,
        net_profit_parent DOUBLE,
        operating_cf DOUBLE,
        investing_cf DOUBLE,
        financing_cf DOUBLE,
        net_profit_parent2 DOUBLE,
        total_shares DOUBLE,
        total_revenue_wan DOUBLE,
        raw_fields JSON,
        PRIMARY KEY (code, report_period)
    )""",
    """CREATE TABLE IF NOT EXISTS dim_fn_meta (
        fn_index INTEGER PRIMARY KEY,
        fn_name VARCHAR,
        fn_col VARCHAR,
        is_mapped BOOLEAN,
        unit_hint VARCHAR
    )""",
    """CREATE TABLE IF NOT EXISTS ipo_info (
        code VARCHAR PRIMARY KEY, name VARCHAR, set_code VARCHAR,
        sg_date VARCHAR, sg_price DOUBLE, sg_code VARCHAR,
        max_sg DOUBLE, pe_issue DOUBLE
    )""",
    """CREATE TABLE IF NOT EXISTS technical_indicators (
        code VARCHAR, date DATE, formula_name VARCHAR, output_key VARCHAR,
        value DOUBLE,
        PRIMARY KEY (code, date, formula_name, output_key)
    )""",
    # ─── 板块底座层 VIEW ───
    """CREATE VIEW IF NOT EXISTS dim_sector_tree AS
        SELECT
            s.sector_code,
            s.name AS sector_name,
            s.sector_type,
            CASE
                WHEN s.sector_type = 'tdx_research_ind1' THEN 1
                WHEN s.sector_type = 'tdx_research_ind2' THEN 2
                WHEN s.sector_type = 'tdx_research_ind3' THEN 3
                ELSE 0
            END AS level,
            CASE
                WHEN s.sector_type = 'tdx_research_ind2' THEN h.ind1_code
                WHEN s.sector_type = 'tdx_research_ind3' THEN h.ind2_code
                ELSE NULL
            END AS parent_sector_code
        FROM sector_list s
        LEFT JOIN sector_hierarchy h ON s.sector_code = h.sector_code""",
    # ─── ETF 扩展表 ───
    """CREATE TABLE IF NOT EXISTS etf_product (
        code VARCHAR PRIMARY KEY,
        name VARCHAR,
        market VARCHAR,
        track_index VARCHAR,
        track_index_name VARCHAR,
        fund_company VARCHAR,
        management_fee DOUBLE,
        custody_fee DOUBLE,
        etf_type VARCHAR,
        category_l1 VARCHAR,
        category_l2 VARCHAR,
        list_date DATE,
        delist_date DATE,
        is_active BOOLEAN DEFAULT true,
        updated_at TIMESTAMP
    )""",
    """CREATE TABLE IF NOT EXISTS etf_iopv_daily (
        code VARCHAR, date DATE,
        close DOUBLE,
        iopv DOUBLE,
        premium_rate DOUBLE,
        total_share BIGINT,
        total_scale DOUBLE,
        pre_close DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_share_scale (
        code VARCHAR, date DATE,
        total_share BIGINT,
        total_scale DOUBLE,
        share_change BIGINT,
        scale_change DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_capital_flow (
        code VARCHAR, date DATE,
        super_large_net DOUBLE, large_net DOUBLE,
        medium_net DOUBLE, small_net DOUBLE,
        super_large_in DOUBLE, super_large_out DOUBLE,
        large_in DOUBLE, large_out DOUBLE,
        medium_in DOUBLE, medium_out DOUBLE,
        small_in DOUBLE, small_out DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_holding_stock (
        etf_code VARCHAR, report_date DATE, stock_code VARCHAR,
        stock_name VARCHAR,
        weight DOUBLE,
        shares BIGINT,
        market_value DOUBLE,
        PRIMARY KEY (etf_code, report_date, stock_code)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_pcf_list (
        etf_code VARCHAR, pcf_date DATE, stock_code VARCHAR,
        stock_name VARCHAR,
        shares BIGINT,
        amount DOUBLE,
        replace_flag INTEGER,
        PRIMARY KEY (etf_code, pcf_date, stock_code)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_derived_indicator (
        code VARCHAR, date DATE,
        tracking_error_20d DOUBLE,
        tracking_error_60d DOUBLE,
        excess_return_1d DOUBLE,
        excess_return_5d DOUBLE,
        excess_return_20d DOUBLE,
        liquidity_score DOUBLE,
        avg_daily_amount_20d DOUBLE,
        avg_daily_volume_20d BIGINT,
        bid_ask_spread DOUBLE,
        PRIMARY KEY (code, date)
    )""",
    """CREATE TABLE IF NOT EXISTS etf_index_tracking (
        etf_code VARCHAR, index_code VARCHAR,
        index_name VARCHAR,
        is_primary BOOLEAN DEFAULT true,
        PRIMARY KEY (etf_code, index_code)
    )""",
    # ─── ETF 索引 ───
    "CREATE INDEX IF NOT EXISTS idx_etf_iopv_code ON etf_iopv_daily(code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_share_code ON etf_share_scale(code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_capital_code ON etf_capital_flow(code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_holding_etf ON etf_holding_stock(etf_code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_holding_stock ON etf_holding_stock(stock_code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_derived_code ON etf_derived_indicator(code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_track_etf ON etf_index_tracking(etf_code)",
    "CREATE INDEX IF NOT EXISTS idx_etf_track_idx ON etf_index_tracking(index_code)",
]

TABLE_TO_PARQUET = {
    "stock_daily_kline": "stock_daily",
    "stock_minute_kline": "stock_minute",
    "sector_daily_data": "sector_daily",
    "financial_data": "financial",
    "stock_trading_data": "stock_trading",
    "sector_trading_data": "sector_trading",
    "market_trading_data": "market_trading",
    "stock_capital_data": "capital",
    "stock_dividend_data": "dividend",
    "etf_data": "etf",
    "cb_data": "cb",
    "futures_data": "futures",
    "sector_stocks": "sector_stocks",
    "ipo_info": "ipo",
    "technical_indicators": "tech_indicators",
    "kline_1m": "kline_1m",
    "kline_5m": "kline_5m",
    "kline_15m": "kline_15m",
    "kline_30m": "kline_30m",
    "kline_60m": "kline_60m",
    "stock_kline_weekly": "kline_weekly",
    "stock_kline_monthly": "kline_monthly",
    "index_daily_kline": "index_daily",
    "index_kline_1m": "index_kline_1m",
    "index_kline_5m": "index_kline_5m",
    "sector_kline_daily": "sector_kline_daily",
    "sector_kline_5m": "sector_kline_5m",
    "stock_trading_data_bk": "stock_trading_data_bk",
    # ─── ETF 扩展表 ───
    "etf_product": "etf_product",
    "etf_iopv_daily": "etf_iopv",
    "etf_share_scale": "etf_share",
    "etf_capital_flow": "etf_capital",
    "etf_holding_stock": "etf_holding",
    "etf_pcf_list": "etf_pcf",
    "etf_derived_indicator": "etf_derived",
    "etf_index_tracking": "etf_tracking",
}


class DuckDBManager:
    def __init__(self, db_path: Optional[Path] = None, hot_years: int = HOT_YEARS):
        self.db_path = Path(db_path) if db_path else DB_PATH
        self.hot_years = hot_years
        self._ensure_tables()
        self._validator: Optional[DataValidator] = None
        self._create_progress_tables()

    @property
    def validator(self) -> DataValidator:
        if self._validator is None:
            try:
                trading_dates = load_trading_dates_from_db(str(self.db_path))
                self._validator = DataValidator(trading_dates)
                logger.info("校验器初始化: 加载 %d 个交易日", len(trading_dates))
            except Exception as e:
                logger.warning("校验器初始化失败(交易日历未就绪): %s", e)
                self._validator = DataValidator()
        return self._validator

    @contextmanager
    def connect(self, read_only: bool = False):
        config = {"memory_limit": "4GB", "temp_directory": str(self.db_path.parent / "duckdb_temp")}
        conn = duckdb.connect(str(self.db_path), read_only=read_only, config=config)
        try:
            yield conn
        finally:
            conn.close()

    def _ensure_tables(self):
        with self.connect() as conn:
            for ddl in DDL_STATEMENTS:
                conn.execute(ddl)
        logger.info("DuckDB 表结构初始化完成: %s", self.db_path)

    def write_df(self, df: pd.DataFrame, table_name: str, pk_columns: List[str]) -> int:
        if df.empty:
            logger.warning("空 DataFrame，跳过写入 %s", table_name)
            return 0
        df = df.copy()

        vr = self.validator.validate(df, table_name)
        if vr.errors:
            for err in vr.errors:
                logger.error("写入校验[%s]: %s", table_name, err)
        if vr.warnings:
            for warn in vr.warnings:
                logger.warning("写入校验[%s]: %s", table_name, warn)

        tmp_name = f"_tmp_{table_name}"
        with self.connect() as conn:
            conn.register(tmp_name, df)
            pk_sel = ", ".join(pk_columns)
            cols = [c[0] for c in conn.execute(
                f"SELECT column_name FROM information_schema.columns WHERE table_name='{table_name}' ORDER BY ordinal_position").fetchall()]
            sel = ", ".join(f'"{c}"' for c in cols)
            conn.execute(f"DELETE FROM {table_name} WHERE ({pk_sel}) IN (SELECT {pk_sel} FROM {tmp_name})")
            conn.execute(f"INSERT INTO {table_name} SELECT {sel} FROM {tmp_name}")
            conn.unregister(tmp_name)
            logger.info("写入 %s: %d 条数据 %s", table_name, len(df), vr.summary())
            self._log_sync(table_name, df, "success")
            return len(df)

    def write_rows_fast(self, rows: list, table_name: str, columns: List[str],
                        pk_columns: List[str] = None) -> int:
        """
        Fast bulk insert from list of tuples. Bypasses validator + df.copy().
        If pk_columns provided, uses temp table + DELETE+INSERT for upsert.
        Otherwise uses executemany for raw INSERT (faster, no upsert).
        """
        if not rows:
            return 0

        with self.connect() as conn:
            if pk_columns:
                # Upsert via temp table (avoids executemany PK conflict)
                import pandas as pd
                tmp_name = f"_tmp_fast_{table_name}"
                tmp_df = pd.DataFrame(rows, columns=columns)
                conn.register(tmp_name, tmp_df)
                pk_sel = ", ".join(pk_columns)
                conn.execute(f"DELETE FROM {table_name} WHERE ({pk_sel}) IN (SELECT {pk_sel} FROM {tmp_name})")
                conn.execute(f"INSERT INTO {table_name} SELECT * FROM {tmp_name}")
                conn.unregister(tmp_name)
                del tmp_df
            else:
                # Raw INSERT - fastest path, no PK check
                col_count = len(columns)
                placeholders = ", ".join(["?"] * col_count)
                cols_str = ", ".join(columns)
                conn.executemany(f"INSERT INTO {table_name} ({cols_str}) VALUES ({placeholders})", rows)

        logger.info("fast write %s: %d rows", table_name, len(rows))
        return len(rows)

    def _get_date_column(self, table_name: str) -> Optional[str]:
        """推断表的日期列名"""
        from .data_validator import TABLE_HAS_DATE
        return TABLE_HAS_DATE.get(table_name, "date" if table_name.endswith("_daily_kline") else None)

    def write_df_incremental(self, df: pd.DataFrame, table_name: str,
                             pk_columns: List[str], date_column: str = None) -> int:
        """增量写入：只写比已有数据更新的行

        使用场景：日常定时采集，不需要每次都全量覆盖。
        工作原理：
          1. 查表中最新的日期
          2. 过滤 df 只保留比最新日期新的行
          3. 调用 write_df 写入
        """
        if df.empty:
            return 0
        if not date_column:
            date_column = self._get_date_column(table_name)
        if date_column and date_column in df.columns:
            try:
                with self.connect(read_only=True) as conn:
                    existing = conn.execute(
                        f"SELECT MAX({date_column}) FROM {table_name}"
                    ).fetchone()
                max_date = existing[0] if existing and existing[0] else None
                if max_date:
                    before = len(df)
                    df = df[df[date_column] > max_date].copy()
                    skipped = before - len(df)
                    if skipped > 0:
                        logger.info("增量写入 %s: 跳过 %d 条已有数据", table_name, skipped)
                    if df.empty:
                        return 0
            except Exception:
                pass
        return self.write_df(df, table_name, pk_columns)

    def write_stock_kline(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_daily_kline", ["code", "date"])

    def write_sector_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_daily_data", ["sector_code", "date"])

    def write_stock_basic_info(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_basic_info", ["code"])

    def write_stock_sector_relation(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_sector_relation", ["stock_code", "sector_code"])

    def write_sector_list(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_list", ["sector_code"])

    def write_trading_calendar(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "trading_calendar", ["date"])

    def write_stock_extended_info(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_extended_info", ["code", "date"])

    def write_stock_trading_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_trading_data", ["code", "date", "field_type", "field_name"])

    def write_sector_trading_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_trading_data", ["sector_code", "date", "field_type", "field_name"])

    def write_market_trading_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "market_trading_data", ["date", "field_name", "market"])

    def write_stock_capital_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "stock_capital_data", ["code", "date"])

    def write_financial_data(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "financial_data", ["code", "date", "report_type", "field_name"])

    def write_sector_stocks(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_stocks", ["sector_code", "stock_code"])

    def write_ipo_info(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "ipo_info", ["code"])

    def write_etf_info(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_data", ["code", "date"])

    def write_technical_indicators(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "technical_indicators", ["code", "date", "formula_name", "output_key"])

    def write_kline_1m(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "kline_1m", ["code", "trade_time"])

    def write_kline_5m(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "kline_5m", ["code", "trade_time"])

    def write_index_daily_kline(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "index_daily_kline", ["code", "date"])

    def write_index_kline_1m(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "index_kline_1m", ["code", "trade_time"])

    def write_index_kline_5m(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "index_kline_5m", ["code", "trade_time"])

    def write_sector_kline_daily(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_kline_daily", ["code", "date"])

    def write_sector_kline_5m(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "sector_kline_5m", ["code", "trade_time"])

    # ─── ETF 扩展 write 方法 ───
    def write_etf_product(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_product", ["code"])

    def write_etf_iopv_daily(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_iopv_daily", ["code", "date"])

    def write_etf_share_scale(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_share_scale", ["code", "date"])

    def write_etf_capital_flow(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_capital_flow", ["code", "date"])

    def write_etf_holding_stock(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_holding_stock", ["etf_code", "report_date", "stock_code"])

    def write_etf_pcf_list(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_pcf_list", ["etf_code", "pcf_date", "stock_code"])

    def write_etf_derived_indicator(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_derived_indicator", ["code", "date"])

    def write_etf_index_tracking(self, df: pd.DataFrame) -> int:
        return self.write_df(df, "etf_index_tracking", ["etf_code", "index_code"])

    def query(
        self,
        table_name: str,
        filters: Optional[Dict] = None,
        start_date: Optional[Union[str, datetime]] = None,
        end_date: Optional[Union[str, datetime]] = None,
        limit: Optional[int] = None,
    ) -> pd.DataFrame:
        parts = [f"SELECT * FROM {table_name} WHERE 1=1"]
        params = []
        if filters:
            for key, value in filters.items():
                if isinstance(value, list):
                    placeholders = ", ".join(["?" for _ in value])
                    parts.append(f"AND {key} IN ({placeholders})")
                    params.extend(value)
                else:
                    parts.append(f"AND {key} = ?")
                    params.append(value)

        # 检测日期列名（支持 date 和 trade_time）
        date_col = "date"
        try:
            with self.connect(read_only=True) as conn:
                cols = [row[0] for row in conn.execute(f"DESCRIBE {table_name}").fetchall()]
            if "date" not in cols and "trade_time" in cols:
                date_col = "trade_time"
        except Exception:
            pass

        if start_date:
            parts.append(f"AND {'DATE(' + date_col + ')' if date_col == 'trade_time' else date_col} >= ?")
            params.append(start_date)
        if end_date:
            parts.append(f"AND {'DATE(' + date_col + ')' if date_col == 'trade_time' else date_col} <= ?")
            params.append(end_date)

        try:
            cols  # already fetched above
            if date_col in cols:
                parts.append(f"ORDER BY {date_col} DESC")
        except Exception:
            pass
        if limit:
            parts.append(f"LIMIT {limit}")
        sql = " ".join(parts)
        with self.connect(read_only=True) as conn:
            return conn.execute(sql, params).df()

    def execute(self, sql: str, params: Optional[List] = None, read_only: bool = True) -> pd.DataFrame:
        with self.connect(read_only=read_only) as conn:
            if params:
                return conn.execute(sql, params).df()
            return conn.execute(sql).df()

    def get_info(self) -> Dict:
        with self.connect(read_only=True) as conn:
            info = {}
            try:
                stock_count = conn.execute("SELECT COUNT(DISTINCT code) FROM stock_daily_kline").fetchone()[0]
                stock_total = conn.execute("SELECT COUNT(*) FROM stock_daily_kline").fetchone()[0]
                stock_dates = conn.execute("SELECT MIN(date), MAX(date) FROM stock_daily_kline").fetchone()
                info["stocks"] = {
                    "unique_count": stock_count,
                    "total_records": stock_total,
                    "date_min": str(stock_dates[0]),
                    "date_max": str(stock_dates[1]),
                }
            except Exception:
                info["stocks"] = {"unique_count": 0, "total_records": 0, "date_min": "-", "date_max": "-"}

            try:
                sector_count = conn.execute("SELECT COUNT(DISTINCT sector_code) FROM sector_daily_data").fetchone()[0]
                sector_total = conn.execute("SELECT COUNT(*) FROM sector_daily_data").fetchone()[0]
                sector_dates = conn.execute("SELECT MIN(date), MAX(date) FROM sector_daily_data").fetchone()
                info["sectors"] = {
                    "unique_count": sector_count,
                    "total_records": sector_total,
                    "date_min": str(sector_dates[0]),
                    "date_max": str(sector_dates[1]),
                }
            except Exception:
                info["sectors"] = {"unique_count": 0, "total_records": 0, "date_min": "-", "date_max": "-"}

            info["db_path"] = str(self.db_path)
            info["db_size_mb"] = round(self.db_path.stat().st_size / (1024 * 1024), 2) if self.db_path.exists() else 0
            info["hot_years"] = self.hot_years
            return info

    def get_table_counts(self) -> Dict[str, int]:
        with self.connect(read_only=True) as conn:
            tables = conn.execute("SHOW TABLES").fetchall()
            counts = {}
            for (name,) in tables:
                try:
                    cnt = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
                    counts[name] = cnt
                except Exception:
                    counts[name] = -1
            return counts

    TABLE_META = {
        "stock_daily_kline":    ("股票日K线",       "kline",     "date"),
        "kline_1m":             ("1分钟K线",        "kline",     "trade_time"),
        "kline_5m":             ("5分钟K线",        "kline",     "trade_time"),
        "kline_15m":            ("15分钟K线",       "kline",     "trade_time"),
        "kline_30m":            ("30分钟K线",       "kline",     "trade_time"),
        "kline_60m":            ("60分钟K线",       "kline",     "trade_time"),
        "stock_kline_weekly":   ("周K线",           "kline",     "date"),
        "stock_kline_monthly":  ("月K线",           "kline",     "date"),
        "stock_extended_info":  ("股票扩展信息",     "extended",  "date"),
        "stock_capital_data":   ("股本数据",         "capital",   "date"),
        "stock_trading_data":   ("股票交易数据(EAV)", "trading",   "date"),
        "stock_trading_data_bk":("股票BK数据(EAV)",  "trading",   "date"),
        "market_trading_data":  ("市场交易数据",     "trading",   "date"),
        "technical_indicators": ("技术指标",         "indicator", "date"),
        "sector_daily_data":    ("板块日行情",       "sector",    "date"),
        "sector_kline_daily":   ("板块日K线",       "kline",     "date"),
        "sector_kline_5m":      ("板块5分钟K线",     "kline",     "trade_time"),
        "index_daily_kline":    ("指数日K线",       "kline",     "date"),
        "index_kline_1m":       ("指数1分钟K线",     "kline",     "trade_time"),
        "index_kline_5m":       ("指数5分钟K线",     "kline",     "trade_time"),
        "etf_data":             ("ETF数据",          "etf",       "date"),
        "ipo_info":             ("新股申购",         "ipo",       None),
        "stock_basic_info":     ("股票列表",         "basic",     None),
        "sector_list":          ("板块列表",         "basic",     None),
        "sector_stocks":        ("板块成份股",       "basic",     None),
        "stock_sector_relation":("股票板块关系",     "basic",     None),
        "trading_calendar":     ("交易日历",         "basic",     "date"),
        "financial_data":       ("财务数据",         "financial", "date"),
        "cb_data":              ("可转债数据",       "cb",        "date"),
        "futures_data":         ("期货数据",         "futures",   "date"),
        "index_constituents":   ("指数成份股",       "basic",     None),
        "sector_trading_data":  ("板块交易数据",     "trading",   "date"),
        "pipeline_progress":    ("采集进度",         "system",    None),
        "pipeline_progress_history": ("采集历史",     "system",    None),
        "data_archive_log":     ("归档日志",         "system",    None),
        "data_sync_log":        ("同步日志",         "system",    None),
        "stock_dividend_data":  ("分红数据",         "capital",   "date"),
        "stock_minute_kline":   ("分钟K线(旧)",      "kline",     "date"),
        # ─── ETF 扩展表 ───
        "etf_product":          ("ETF产品维度",      "etf",       None),
        "etf_iopv_daily":       ("ETF IOPV",        "etf",       "date"),
        "etf_share_scale":      ("ETF份额规模",      "etf",       "date"),
        "etf_capital_flow":     ("ETF资金流向",      "etf",       "date"),
        "etf_holding_stock":    ("ETF持仓",         "etf",       "report_date"),
        "etf_pcf_list":         ("ETF PCF清单",     "etf",       "pcf_date"),
        "etf_derived_indicator":("ETF衍生指标",      "etf",       "date"),
        "etf_index_tracking":   ("ETF跟踪指数",      "etf",       None),
    }

    def get_table_overview(self) -> list:
        """返回所有表的概览信息：名称/中文名/分类/行数/日期范围/占用空间"""
        with self.connect(read_only=True) as conn:
            tables = [r[0] for r in conn.execute("SHOW TABLES").fetchall()]
            size_rows = conn.execute(
                "SELECT table_name, estimated_size FROM duckdb_tables()"
            ).fetchall()
            size_map = {r[0]: r[1] for r in size_rows}
            col_rows = conn.execute(
                "SELECT table_name, column_count FROM duckdb_tables()"
            ).fetchall()
            col_map = {r[0]: r[1] for r in col_rows}

            results = []
            for name in tables:
                meta = self.TABLE_META.get(name, (name, "other", None))
                cn_name, category, date_col = meta
                row_count = 0
                date_min = None
                date_max = None
                try:
                    row_count = conn.execute(
                        f'SELECT COUNT(*) FROM "{name}"'
                    ).fetchone()[0]
                except Exception:
                    row_count = -1

                if date_col and row_count > 0:
                    try:
                        dr = conn.execute(
                            f'SELECT MIN("{date_col}"), MAX("{date_col}") FROM "{name}"'
                        ).fetchone()
                        if dr and dr[0] is not None:
                            date_min = str(dr[0])[:10]
                            date_max = str(dr[1])[:10]
                    except Exception:
                        pass

                est_bytes = size_map.get(name, 0)
                col_count = col_map.get(name, 0)

                results.append({
                    "table_name": name,
                    "cn_name": cn_name,
                    "category": category,
                    "row_count": row_count,
                    "col_count": col_count,
                    "date_min": date_min,
                    "date_max": date_max,
                    "est_bytes": est_bytes,
                })
            return results

    def archive_old_data(self, year: Optional[int] = None, data_types: Optional[List[str]] = None):
        hot_cutoff = datetime.now() - timedelta(days=365 * self.hot_years)
        all_types = list(TABLE_TO_PARQUET.keys())
        target_types = [dt for dt in (data_types or all_types) if dt in all_types]
        for data_type in target_types:
            self._archive_data_type(data_type, year, hot_cutoff)

    def _archive_data_type(self, data_type: str, year: Optional[int], hot_cutoff: datetime):
        with self.connect() as conn:
            try:
                df = conn.execute(f"SELECT DISTINCT YEAR(date) as y FROM {data_type}").df()
                all_years = sorted(df["y"].tolist())
                hot_year = hot_cutoff.year
                years_to_archive = [y for y in all_years if y < hot_year] if not year else [year]
            except Exception as e:
                logger.warning("无法获取 %s 年份: %s", data_type, e)
                return
        for y in years_to_archive:
            self._archive_single_year(data_type, y)

    def _archive_single_year(self, data_type: str, year: int):
        year_start = pd.Timestamp(f"{year}-01-01").date()
        year_end = pd.Timestamp(f"{year}-12-31").date()
        logger.info("归档 %s 年份: %d", data_type, year)
        with self.connect() as conn:
            df = conn.execute(f"SELECT * FROM {data_type} WHERE date >= ? AND date <= ?", [year_start, year_end]).df()
            if df.empty:
                return
            pq_type = TABLE_TO_PARQUET.get(data_type, data_type)
            save_path = PARQUET_PATH / pq_type / f"year={year}" / "data.parquet"
            save_path.parent.mkdir(parents=True, exist_ok=True)
            df.to_parquet(save_path, engine="pyarrow", compression="zstd")
            logger.info("写入 Parquet: %s, %d 条", save_path, len(df))
            conn.execute(f"DELETE FROM {data_type} WHERE date >= ? AND date <= ?", [year_start, year_end])
            max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM data_archive_log").fetchone()[0]
            conn.execute(
                "INSERT INTO data_archive_log VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [max_id + 1, "full", data_type, year, datetime.now(), len(df), "success", str(save_path.parent)],
            )

    def _log_sync(self, table_name: str, df: pd.DataFrame, status: str, error_msg: str = None):
        try:
            start_date = df["date"].min() if "date" in df.columns else None
            end_date = df["date"].max() if "date" in df.columns else None
            with self.connect() as conn:
                max_id = conn.execute("SELECT COALESCE(MAX(id), 0) FROM data_sync_log").fetchone()[0]
                conn.execute(
                    "INSERT INTO data_sync_log VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [max_id + 1, table_name, start_date, end_date, datetime.now(), len(df), status, error_msg],
                )
        except Exception as e:
            logger.warning("日志写入失败: %s", e)

    def _create_progress_tables(self):
        """创建进度监控表"""
        with self.connect() as conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_progress (
                id INTEGER,
                task_name VARCHAR(200) NOT NULL,
                task_type VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                processed_count INTEGER NOT NULL DEFAULT 0,
                last_update TIMESTAMP NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NULL,
                error_message TEXT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                progress_percent DOUBLE DEFAULT 0.0,
                metadata VARCHAR
            )
            """)
            conn.execute("""
            CREATE TABLE IF NOT EXISTS pipeline_progress_history (
                id INTEGER,
                task_name VARCHAR(200) NOT NULL,
                task_type VARCHAR(50) NOT NULL,
                status VARCHAR(20) NOT NULL,
                total_count INTEGER NOT NULL,
                processed_count INTEGER NOT NULL,
                progress_percent DOUBLE NOT NULL,
                duration_seconds INTEGER NOT NULL,
                start_time TIMESTAMP NOT NULL,
                end_time TIMESTAMP NOT NULL,
                metadata VARCHAR,
                created_at TIMESTAMP
            )
            """)
        logger.info("进度监控表创建完成")

    def get_progress(self, task_name: Optional[str] = None) -> Optional[Dict]:
        """获取进度（可选传入任务名称）"""
        with self.connect(read_only=True) as conn:
            if task_name:
                sql = "SELECT * FROM pipeline_progress WHERE task_name = ?"
                rows = conn.execute(sql, [task_name]).fetchall()
                return dict(zip([col[0] for col in conn.execute("DESCRIBE pipeline_progress").fetchall()], rows[0])) if rows else None
            else:
                sql = "SELECT task_name, status, total_count, processed_count, progress_percent, last_update, start_time FROM pipeline_progress"
                rows = conn.execute(sql).fetchall()
                return [
                    dict(zip([col[0] for col in conn.execute("DESCRIBE pipeline_progress").fetchall()], row))
                    for row in rows
                ]

    def save_task_progress(self, task_name: str, status: str, total_count: int, processed_count: int,
                          progress_percent: float, error_message: Optional[str] = None, metadata: Optional[Dict] = None):
        """保存任务进度（兼容progress_monitor的数据库操作）"""
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.connect() as conn:
            sql = """
            INSERT INTO pipeline_progress (
                task_name, task_type, status, total_count, processed_count,
                last_update, start_time, end_time, error_message,
                progress_percent, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(task_name) DO UPDATE SET
                status = excluded.status,
                total_count = excluded.total_count,
                processed_count = excluded.processed_count,
                last_update = excluded.last_update,
                end_time = excluded.end_time,
                error_message = excluded.error_message,
                progress_percent = excluded.progress_percent,
                metadata = excluded.metadata
            """
            conn.execute(sql, (
                task_name, "", status, total_count, processed_count,
                current_time, current_time, current_time, error_message,
                progress_percent, json.dumps(metadata) if metadata else None
            ))
            conn.commit()

    def save_task_history(self, task_name: str, status: str, total_count: int, processed_count: int,
                          progress_percent: float, progress_metadata: Optional[Dict] = None):
        """保存任务历史记录"""
        current_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.connect() as conn:
            sql = """
            INSERT INTO pipeline_progress_history (
                task_name, task_type, status, total_count, processed_count,
                progress_percent, duration_seconds, start_time, end_time, metadata
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """
            conn.execute(sql, (
                task_name, "", status, total_count, processed_count,
                progress_percent, 0, current_time, current_time,
                json.dumps(progress_metadata) if progress_metadata else None
            ))
            conn.commit()

_manager_instance: Optional[DuckDBManager] = None


def get_manager() -> DuckDBManager:
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = DuckDBManager()
    return _manager_instance
