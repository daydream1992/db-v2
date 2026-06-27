"""
K线采集步骤 — 消除 kline_1m/kline_5m 的重复代码

复用结构：
  _KlineStep（基类）
    ├── _StockMinuteKlineStep  → ingest_kline_1m / ingest_kline_5m
    ├── _IndexKlineStep       → ingest_index_kline（日线+1m+5m）
    └── _SectorKlineStep     → ingest_sector_kline（日线+5m）
"""

import time
import logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta

import pandas as pd

from .base import BaseStep, StepContext
from db.manager import DuckDBManager

logger = logging.getLogger(__name__)


class _KlineStepMixin:
    """K线采集混入 — 通用 OHLCV DataFrame → 行列表转换"""

    def _parse_ohlcv_dataframe(
        self,
        data: dict,
        period: str,
        batch: List[str],
        change_pct: bool = False,
    ) -> List[dict]:
        """
        将 TDX get_market_data 返回的多列 DataFrame 解析为行列表。

        参数：
          data: TDX 返回的 dict，key 为 "Open"/"High"/"Low"/"Close"/"Volume"/"Amount"
          period: "1d" | "1m" | "5m"
          batch: 股票代码列表
          change_pct: 是否计算涨跌幅（仅日线需要）

        返回：
          list[dict]，每个 dict 含 code/date 或 code/trade_time/open/high/low/close/volume/amount
        """
        close_df = data.get("Close")
        if not isinstance(close_df, pd.DataFrame) or close_df.empty:
            return []

        open_df = data.get("Open", pd.DataFrame(index=close_df.index, columns=close_df.columns))
        high_df = data.get("High", pd.DataFrame(index=close_df.index, columns=close_df.columns))
        low_df = data.get("Low", pd.DataFrame(index=close_df.index, columns=close_df.columns))
        vol_df = data.get("Volume", pd.DataFrame(index=close_df.index, columns=close_df.columns))
        amt_df = data.get("Amount", pd.DataFrame(index=close_df.index, columns=close_df.columns))

        rows = []
        for code in batch:
            if code not in close_df.columns:
                continue
            try:
                c_s = close_df[code].dropna()
                if c_s.empty:
                    continue
                o_s = open_df[code] if code in open_df.columns else pd.Series(dtype=float)
                h_s = high_df[code] if code in high_df.columns else pd.Series(dtype=float)
                l_s = low_df[code] if code in low_df.columns else pd.Series(dtype=float)
                v_s = vol_df[code] if code in vol_df.columns else pd.Series(dtype=float)
                a_s = amt_df[code] if code in amt_df.columns else pd.Series(dtype=float)

                if change_pct:
                    prev_close = c_s.shift(1)
                    for idx in c_s.index:
                        curr = c_s[idx]
                        prev = prev_close.get(idx)
                        chg = ((curr - prev) / prev * 100) if pd.notna(prev) and prev > 0 else 0.0
                        ts = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                        rows.append({
                            "code": code,
                            "date": idx.date() if hasattr(idx, "date") else idx,
                            "open": float(o_s.get(idx, 0)) if pd.notna(o_s.get(idx)) else 0.0,
                            "high": float(h_s.get(idx, 0)) if pd.notna(h_s.get(idx)) else 0.0,
                            "low": float(l_s.get(idx, 0)) if pd.notna(l_s.get(idx)) else 0.0,
                            "close": float(curr),
                            "volume": float(v_s.get(idx, 0)) if pd.notna(v_s.get(idx)) else 0.0,
                            "amount": float(a_s.get(idx, 0)) if pd.notna(a_s.get(idx)) else 0.0,
                            "change_pct": round(chg, 2),
                        })
                else:
                    for idx in c_s.index:
                        ts = idx.to_pydatetime() if hasattr(idx, "to_pydatetime") else idx
                        rows.append({
                            "code": code,
                            "trade_time": ts,
                            "open": float(o_s.get(idx, 0)) if pd.notna(o_s.get(idx)) else 0.0,
                            "high": float(h_s.get(idx, 0)) if pd.notna(h_s.get(idx)) else 0.0,
                            "low": float(l_s.get(idx, 0)) if pd.notna(l_s.get(idx)) else 0.0,
                            "close": float(c_s[idx]),
                            "volume": float(v_s.get(idx, 0)) if pd.notna(v_s.get(idx)) else 0.0,
                            "amount": float(a_s.get(idx, 0)) if pd.notna(a_s.get(idx)) else 0.0,
                        })
            except Exception:
                pass
        return rows

    def _fetch_kline_batch(
        self,
        tq,
        codes: List[str],
        period: str,
        start_dt: str,
        end_dt: str,
        change_pct: bool = False,
    ) -> List[dict]:
        """拉取一批股票的 K 线数据"""
        data = self._safe_call(
            tq.get_market_data,
            field_list=["Open", "High", "Low", "Close", "Volume", "Amount"],
            stock_list=codes,
            period=period,
            start_time=start_dt,
            end_time=end_dt,
            count=-1,
            dividend_type="front",
            fill_data=False,
        )
        if not isinstance(data, dict) or "Close" not in data:
            return []
        return self._parse_ohlcv_dataframe(data, period, codes, change_pct)


# ─────────────────────────────────────────────────────────────
# 分钟K线步骤（股票 1m / 5m 共用逻辑）
# ─────────────────────────────────────────────────────────────

class _StockMinuteKlineStep(_KlineStepMixin, BaseStep):
    """
    股票分钟K线采集步骤基类。

    子类只需定义：
      name          = "kline_1m" | "kline_5m"
      period        = "1m" | "5m"
      table_name    = "kline_1m" | "kline_5m"
      data_range_days = 30（默认）
    """

    period: str = "1m"

    def _execute(self) -> int:
        tq = self._get_tq()
        if not tq:
            return 0

        codes = self._fetch_stock_codes()
        if not codes:
            return 0

        total = len(codes)
        all_rows = []
        end_dt = datetime.now().strftime("%Y%m%d")
        start_dt = (datetime.now() - timedelta(days=self.data_range_days)).strftime("%Y%m%d")

        for i, batch in enumerate(self._batch_iter(codes)):
            rows = self._fetch_kline_batch(tq, batch, self.period, start_dt, end_dt)
            all_rows.extend(rows)

            if (i + 1) % 4 == 0 and all_rows:
                df = pd.DataFrame(all_rows)
                df = df[["code", "trade_time", "open", "high", "low", "close", "volume", "amount"]]
                write_fn = getattr(self.mgr, f"write_{self.table_name}", None)
                if write_fn:
                    write_fn(df)
                logger.info("%s K线进度: %d/%d, 已写 %d 条", self.period, i + 1, total, len(all_rows))
                all_rows = []
            self._throttle(1.5)

        if all_rows:
            df = pd.DataFrame(all_rows)
            df = df[["code", "trade_time", "open", "high", "low", "close", "volume", "amount"]]
            write_fn = getattr(self.mgr, f"write_{self.table_name}", None)
            if write_fn:
                write_fn(df)

        cnt = self.mgr.get_table_counts().get(self.table_name, 0)
        logger.info("%s K线入库完成: %d 条", self.period, cnt)
        return cnt

    def _get_tq(self):
        """延迟获取 TDX 实例（子进程内导入）"""
        if hasattr(self, "_tq"):
            return self._tq
        try:
            from tqcenter import tq as _tq_mod
            _tq_mod.initialize("")
            self._tq = _tq_mod
            return self._tq
        except Exception as e:
            logger.warning("TDXQuant 初始化失败: %s", e)
            return None


class StockMinuteKline1mStep(_StockMinuteKlineStep):
    name = "ingest_kline_1m"
    table_name = "kline_1m"
    period = "1m"
    data_range_days = 30


class StockMinuteKline5mStep(_StockMinuteKlineStep):
    name = "ingest_kline_5m"
    table_name = "kline_5m"
    period = "5m"
    data_range_days = 30


# ─────────────────────────────────────────────────────────────
# 指数K线步骤
# ─────────────────────────────────────────────────────────────

class IndexKlineStep(_KlineStepMixin, BaseStep):
    """指数K线（日线 + 1m + 5m）"""
    name = "ingest_index_kline"
    table_name = "index_daily_kline"
    data_range_days = 365

    INDEX_CODES = {
        "000001.SH": "上证指数",
        "399001.SZ": "深证成指",
        "399006.SZ": "创业板指",
        "000300.SH": "沪深300",
        "000905.SH": "中证500",
        "000852.SH": "中证1000",
        "000016.SH": "上证50",
        "399673.SZ": "创业板50",
        "000688.SH": "科创50",
    }

    def _execute(self) -> dict:
        tq = self._get_tq()
        if not tq:
            return {"index_daily": 0, "index_1m": 0, "index_5m": 0}

        codes = list(self.INDEX_CODES.keys())
        end_dt = datetime.now().strftime("%Y%m%d")
        start_dt_daily = (datetime.now() - timedelta(days=self.data_range_days)).strftime("%Y%m%d")
        start_dt_min = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        results = {}

        # 日线
        rows = self._fetch_kline_batch(tq, codes, "1d", start_dt_daily, end_dt, change_pct=True)
        if rows:
            df = pd.DataFrame(rows)
            df = df[["code", "date", "open", "high", "low", "close", "volume", "amount", "change_pct"]]
            self.mgr.write_index_daily_kline(df)
        results["index_daily"] = len(rows)
        logger.info("指数日K线: %d 条", len(rows))
        self._throttle(1)

        # 1m
        rows_1m = self._fetch_kline_batch(tq, codes, "1m", start_dt_min, end_dt)
        if rows_1m:
            df = pd.DataFrame(rows_1m)
            df = df[["code", "trade_time", "open", "high", "low", "close", "volume", "amount"]]
            self.mgr.write_index_kline_1m(df)
        results["index_1m"] = len(rows_1m)
        logger.info("指数1mK线: %d 条", len(rows_1m))
        self._throttle(1)

        # 5m
        rows_5m = self._fetch_kline_batch(tq, codes, "5m", start_dt_min, end_dt)
        if rows_5m:
            df = pd.DataFrame(rows_5m)
            df = df[["code", "trade_time", "open", "high", "low", "close", "volume", "amount"]]
            self.mgr.write_index_kline_5m(df)
        results["index_5m"] = len(rows_5m)
        logger.info("指数5mK线: %d 条", len(rows_5m))
        return results

    def _get_tq(self):
        if hasattr(self, "_tq"):
            return self._tq
        try:
            from tqcenter import tq as _tq_mod
            _tq_mod.initialize("")
            self._tq = _tq_mod
            return self._tq
        except Exception as e:
            logger.warning("TDXQuant 初始化失败: %s", e)
            return None


# ─────────────────────────────────────────────────────────────
# 板块K线步骤
# ─────────────────────────────────────────────────────────────

class SectorKlineStep(_KlineStepMixin, BaseStep):
    """板块K线（日线 + 5m）"""
    name = "ingest_sector_kline"
    table_name = "sector_kline_daily"
    data_range_days = 365

    def _execute(self) -> dict:
        tq = self._get_tq()
        if not tq:
            return {"sector_daily": 0, "sector_5m": 0}

        sector_codes = self._fetch_sector_codes()
        if not sector_codes:
            return {"sector_daily": 0, "sector_5m": 0}

        end_dt = datetime.now().strftime("%Y%m%d")
        start_dt_daily = (datetime.now() - timedelta(days=self.data_range_days)).strftime("%Y%m%d")
        start_dt_min = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        results = {}

        # 日线
        all_daily = []
        for i, batch in enumerate(self._batch_iter(sector_codes)):
            rows = self._fetch_kline_batch(tq, batch, "1d", start_dt_daily, end_dt, change_pct=True)
            all_daily.extend(rows)
            if (i + 1) % 4 == 0:
                logger.info("板块日K线进度: %d/%d", min((i + 1) * self.batch_size, len(sector_codes)), len(sector_codes))
            self._throttle(1.5)

        if all_daily:
            df = pd.DataFrame(all_daily)
            df = df[["code", "date", "open", "high", "low", "close", "volume", "amount", "change_pct"]]
            self.mgr.write_sector_kline_daily(df)
        results["sector_daily"] = len(all_daily)
        logger.info("板块日K线: %d 条", len(all_daily))

        # 5m
        all_5m = []
        for i, batch in enumerate(self._batch_iter(sector_codes)):
            rows = self._fetch_kline_batch(tq, batch, "5m", start_dt_min, end_dt)
            all_5m.extend(rows)
            if (i + 1) % 4 == 0:
                logger.info("板块5mK线进度: %d/%d", min((i + 1) * self.batch_size, len(sector_codes)), len(sector_codes))
            self._throttle(1.5)

        if all_5m:
            df = pd.DataFrame(all_5m)
            df = df[["code", "trade_time", "open", "high", "low", "close", "volume", "amount"]]
            self.mgr.write_sector_kline_5m(df)
        results["sector_5m"] = len(all_5m)
        logger.info("板块5mK线: %d 条", len(all_5m))

        return results

    def _get_tq(self):
        if hasattr(self, "_tq"):
            return self._tq
        try:
            from tqcenter import tq as _tq_mod
            _tq_mod.initialize("")
            self._tq = _tq_mod
            return self._tq
        except Exception as e:
            logger.warning("TDXQuant 初始化失败: %s", e)
            return None