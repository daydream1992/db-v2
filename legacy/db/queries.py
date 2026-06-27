"""
数据查询层 — 封装常用查询，对接 DuckDBManager。

所有查询均走 DuckDB 热数据，冷数据通过 Parquet 路径按需加载。
"""

import pandas as pd
from datetime import datetime
from typing import Optional, List, Dict, Union
from db.manager import DuckDBManager, get_manager


class DataQueries:
    def __init__(self, manager: Optional[DuckDBManager] = None):
        self.mgr = manager or get_manager()

    def get_stock_kline(
        self,
        code: str,
        start_date: Optional[Union[str, datetime]] = None,
        end_date: Optional[Union[str, datetime]] = None,
        limit: Optional[int] = None,
    ) -> pd.DataFrame:
        return self.mgr.query("stock_daily_kline", {"code": code}, start_date, end_date, limit)

    def get_sector_daily(
        self,
        sector_code: str,
        start_date: Optional[Union[str, datetime]] = None,
        end_date: Optional[Union[str, datetime]] = None,
        limit: Optional[int] = None,
    ) -> pd.DataFrame:
        return self.mgr.query("sector_daily_data", {"sector_code": sector_code}, start_date, end_date, limit)

    def get_stock_list(self, market: Optional[str] = None) -> pd.DataFrame:
        filters = {"market": market} if market else None
        return self.mgr.query("stock_basic_info", filters)

    def get_sector_list(self, sector_type: Optional[str] = None) -> pd.DataFrame:
        filters = {"sector_type": sector_type} if sector_type else None
        return self.mgr.query("sector_list", filters)

    def get_stock_sector_map(self, stock_code: Optional[str] = None, sector_code: Optional[str] = None) -> pd.DataFrame:
        filters = {}
        if stock_code:
            filters["stock_code"] = stock_code
        if sector_code:
            filters["sector_code"] = sector_code
        return self.mgr.query("stock_sector_relation", filters if filters else None)

    def get_trading_calendar(self, market: str = "SH") -> pd.DataFrame:
        return self.mgr.query("trading_calendar", {"market": market})

    def get_latest_trade_date(self) -> Optional[str]:
        df = self.mgr.execute("SELECT MAX(date) as max_date FROM trading_calendar WHERE is_trading = true")
        if not df.empty and df["max_date"].iloc[0] is not None:
            return str(df["max_date"].iloc[0])
        return None

    def get_sector_ranking(self, date: Optional[str] = None, sector_type: Optional[str] = None, top_n: int = 20) -> pd.DataFrame:
        if not date:
            date = self.get_latest_trade_date()
        if not date:
            return pd.DataFrame()
        sql = """
            SELECT sector_code, name, sector_type, change_pct, amount, turnover,
                   advance, decline, total_stocks, pe_ttm, pb_mrq, total_market_cap
            FROM sector_daily_data
            WHERE date = ?
        """
        params: list = [date]
        if sector_type:
            sql += " AND sector_type = ?"
            params.append(sector_type)
        sql += " ORDER BY change_pct DESC LIMIT ?"
        params.append(top_n)
        return self.mgr.execute(sql, params)

    def get_stock_ranking_by_sector(
        self, sector_code: str, date: Optional[str] = None, top_n: int = 20
    ) -> pd.DataFrame:
        if not date:
            date = self.get_latest_trade_date()
        if not date:
            return pd.DataFrame()
        sql = """
            SELECT k.code, k.date, k.close, k.change_pct, k.amount, k.turnover
            FROM stock_daily_kline k
            JOIN stock_sector_relation r ON k.code = r.stock_code
            WHERE r.sector_code = ? AND k.date = ?
            ORDER BY k.change_pct DESC
            LIMIT ?
        """
        return self.mgr.execute(sql, [sector_code, date, top_n])

    def get_sector_trend(self, sector_code: str, days: int = 30) -> pd.DataFrame:
        return self.mgr.execute(
            """
            SELECT date, change_pct, amount, turnover, advance, decline, total_stocks
            FROM sector_daily_data
            WHERE sector_code = ?
            ORDER BY date DESC
            LIMIT ?
            """,
            [sector_code, days],
        )

    def get_db_summary(self) -> Dict:
        info = self.mgr.get_info()
        counts = self.mgr.get_table_counts()
        return {"db_info": info, "table_counts": counts}
