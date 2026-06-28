"""
数据入库管道 — TDXQuant API → DuckDB + Parquet。

入库步骤（按依赖顺序）：
  1. trading_calendar       交易日历
  2. stock_list             股票列表
  3. sector_list            板块列表
  4. stock_sector_relation  股票-板块关系
  5. stock_daily_kline      股票日K线
  6. stock_extended_info    股票扩展信息（涨跌停、市值等）
  7. stock_capital_data     股本数据
  8. sector_daily_data      板块日行情（BK5/BK6）
  9. stock_trading_data     股票交易数据（融资融券等）
 10. sector_trading_data    板块交易数据
 11. market_trading_data    市场交易数据

接口文档：TDXQuant_完整接口文档3.0.md
"""

import sys
import time
import logging
import pandas as pd
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, List

import threading
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_PATH = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_PATH))

from db.manager import DuckDBManager, get_manager
from db.steps.kline_steps import StockMinuteKline1mStep, StockMinuteKline5mStep, IndexKlineStep, SectorKlineStep
from etf_pipeline import ETFPipeline
from progress_monitor import get_monitor
from collector_config import COLLECTOR_TASKS

# ============================================================
# ===== 可调参数（改这里就行）=====
# ============================================================
TDX_PATHS = [
    Path(r"I:\new_tdx_mock\PYPlugins\user"),
    Path(r"C:\new_tdx64\PYPlugins\user"),
]
DEFAULT_YEARS = 1           # 默认拉取年数
ETF_SECTOR_CODES = ['880676.SH', '880698.SH']  # ETF板块代码
ETF_INDEX_CODES = [         # ETF跟踪指数代码
    '950162.CSI', '000300.SH', '000905.SH', '000852.SH', '000016.SH',
    '000688.SH', '399006.SZ', '000689.SH',
]
ETF_CODE_PREFIXES = ['159', '150', '510', '511', '512', '513', '515', '516', '517', '518', '560', '561', '562', '563', '588', '589', '526', '530']
BK_FIELDS = ["BK5", "BK6", "BK9", "BK10", "BK12", "BK13", "BK15", "BK16"]
EXTENDED_INFO_THREAD_COUNT = 10  # 扩展信息并发线程数
# ================================================
for p in TDX_PATHS:
    if p.exists():
        sys.path.insert(0, str(p))
        break

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=[
        logging.FileHandler(BASE_PATH / "logs" / "pipeline.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
logger = logging.getLogger("pipeline")


class DataPipeline:
    def __init__(self, manager: Optional[DuckDBManager] = None, years: int = DEFAULT_YEARS):
        self.mgr = manager or get_manager()
        self.years = years
        self.tq = None
        self.monitor = get_monitor()
        self._init_tq()

    def _init_tq(self):
        try:
            from tqcenter import tq
            tq.initialize(str(BASE_PATH / "pipeline.py"))
            self.tq = tq
            logger.info("TDXQuant 初始化成功")
        except Exception as e:
            logger.warning("TDXQuant 初始化失败: %s，将使用离线模式", e)
            self.tq = None

    # ── ETF Pipeline 懒加载 ──
    @property
    def etf(self) -> ETFPipeline:
        """ETFPipeline 懒加载实例"""
        if not hasattr(self, '_etf_pipeline') or self._etf_pipeline is None:
            self._etf_pipeline = ETFPipeline(
                manager=self.mgr,
                tq_obj=self.tq,
            )
        return self._etf_pipeline

    def _date_range(self) -> tuple:
        end = datetime.now()
        start = end - timedelta(days=365 * self.years)
        return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

    def _safe_call(self, func, *args, **kwargs):
        try:
            result = func(*args, **kwargs)
            return result
        except Exception as e:
            logger.warning("API调用失败 %s: %s", func.__name__ if hasattr(func, '__name__') else func, e)
            return None

    # ──────────────────────────────────────────────
    # Step 11: 板块成份股（get_stock_list_in_sector）
    # ──────────────────────────────────────────────
    def ingest_sector_stocks(self) -> int:
        sector_df = self.mgr.query("sector_list")
        if sector_df.empty:
            return 0
        all_rows = []
        codes = sector_df["sector_code"].tolist()
        for i, code in enumerate(codes):
            stocks = self._safe_call(self.tq.get_stock_list_in_sector, block_code=code, list_type=0)
            if not stocks or not isinstance(stocks, list):
                continue
            for s in stocks:
                if isinstance(s, str) and s.strip():
                    all_rows.append({
                        "sector_code": code,
                        "stock_code": s.strip(),
                    })
                elif isinstance(s, dict):
                    sc = s.get("Code", s.get("code", ""))
                    if sc:
                        all_rows.append({
                            "sector_code": code,
                            "stock_code": sc,
                        })
            if (i + 1) % 50 == 0:
                logger.info("板块成份股进度: %d/%d", i + 1, len(codes))
                time.sleep(0.2)
        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        df.drop_duplicates(inplace=True)
        self.mgr.write_sector_stocks(df)
        logger.info("板块成份股: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 12: 新股申购（get_ipo_info）
    # ──────────────────────────────────────────────
    def ingest_ipo_info(self) -> int:
        ipo = self._safe_call(self.tq.get_ipo_info, ipo_type=2, ipo_date=1)
        if not ipo or not isinstance(ipo, list):
            return 0
        all_rows = []
        for item in ipo:
            if not isinstance(item, dict):
                continue
            all_rows.append({
                "code": item.get("Code", ""),
                "name": item.get("Name", ""),
                "set_code": item.get("SetCode", ""),
                "sg_date": item.get("SGDate", ""),
                "sg_price": float(item.get("SGPrice", 0) or 0),
                "sg_code": item.get("SGCode", ""),
                "max_sg": float(item.get("MaxSG", 0) or 0),
                "pe_issue": float(item.get("PE_Issue", 0) or 0),
            })
        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        self.mgr.write_ipo_info(df)
        logger.info("新股申购: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 13: ETF信息（get_trackzs_etf_info）
    # ──────────────────────────────────────────────
    def ingest_etf_info(self) -> int:
        """获取ETF全量数据 - 从指数跟踪+ETF板块拉全量代码，再逐个查详细信息"""
        all_rows = []
        today = datetime.now().date()

        etf_patterns = ETF_CODE_PREFIXES
        etf_codes = set()

        # 方式1: 从指数跟踪获取ETF（与 ingest_etf_kline 对齐）
        indices = ETF_INDEX_CODES
        for zs_code in indices:
            etf = self._safe_call(self.tq.get_trackzs_etf_info, zs_code=zs_code)
            if etf and isinstance(etf, list):
                for item in etf:
                    if isinstance(item, dict) and item.get("Code"):
                        code = item["Code"]
                        if any(code.startswith(p) for p in etf_patterns):
                            etf_codes.add(code)
            time.sleep(0.1)

        # 方式2: 从ETF板块获取完整ETF代码
        # 880676.SH = 活跃ETF, 880698.SH = 宽基ETF
        sector_codes = ETF_SECTOR_CODES
        for sec in sector_codes:
            stocks = self._safe_call(self.tq.get_stock_list_in_sector, block_code=sec)
            if isinstance(stocks, list):
                for c in stocks:
                    if isinstance(c, str) and any(c.startswith(p) for p in etf_patterns):
                        etf_codes.add(c.strip())
                    elif isinstance(c, dict):
                        code = c.get("Code", c.get("code", ""))
                        if code and any(code.startswith(p) for p in etf_patterns):
                            etf_codes.add(code)
            time.sleep(0.2)

        # 去重已有记录（只补缺）
        existing_df = self.mgr.query("etf_data")
        existing_codes = set(existing_df["code"].unique()) if not existing_df.empty else set()
        new_codes = etf_codes - existing_codes
        if not new_codes:
            logger.info("ETF信息已完整，无需更新 (%d 只)", len(existing_codes))
            return 0
        logger.info("ETF全量代码: %d 个，已有: %d，需补: %d", len(etf_codes), len(existing_codes), len(new_codes))

        for code in sorted(new_codes):
            info = self._safe_call(self.tq.get_more_info, stock_code=code)
            if not info or not isinstance(info, dict):
                continue
            try:
                all_rows.append({
                    "code": code,
                    "date": today,
                    "price": float(info.get("NowPrice", 0) or 0),
                    "pre_close": float(info.get("PreClose", 0) or 0),
                    "iopv": float(info.get("IOPV", 0) or 0),
                    "outstanding_units": float(info.get("Zgb", 0) or 0) * 10000,
                    "scale": float(info.get("Ltsz", 0) or 0),
                    "name": info.get("Name", ""),
                })
            except (ValueError, TypeError):
                pass
            if len(all_rows) % 50 == 0:
                logger.info("ETF信息进度: %d/%d", len(all_rows), len(new_codes))
            time.sleep(0.3)

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        df = df[["code", "date", "name", "price", "pre_close", "iopv", "outstanding_units", "scale"]]
        self.mgr.write_etf_info(df)
        logger.info("ETF信息: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 13b: ETF历史K线（get_market_data + get_trackzs_etf_info）
    # ──────────────────────────────────────────────
    def ingest_etf_kline(self) -> int:
        """获取ETF历史K线 - 从板块和指数获取所有ETF代码后批量拉取K线"""
        all_rows = []
        etf_codes = set()

        # 方式1: 从指数跟踪获取ETF
        indices = [
            '950162.CSI', '000300.SH', '000905.SH', '000852.SH', '000016.SH',
            '000688.SH', '399006.SZ', '000689.SH',
        ]
        for zs_code in indices:
            etf = self._safe_call(self.tq.get_trackzs_etf_info, zs_code=zs_code)
            if etf and isinstance(etf, list):
                for item in etf:
                    if isinstance(item, dict) and item.get("Code"):
                        etf_codes.add(item["Code"])
            time.sleep(0.1)

        # 方式2: 从ETF板块获取完整ETF代码
        # 880676.SH = 活跃ETF, 880698.SH = 宽基ETF
        sector_codes = ETF_SECTOR_CODES
        etf_patterns = ETF_CODE_PREFIXES
        for sec in sector_codes:
            stocks = self._safe_call(self.tq.get_stock_list_in_sector, block_code=sec)
            if isinstance(stocks, list):
                for c in stocks:
                    if isinstance(c, str) and any(c.startswith(p) for p in etf_patterns):
                        etf_codes.add(c)
            time.sleep(0.1)

        if not etf_codes:
            logger.warning("未获取到任何ETF代码")
            return 0

        # 去重已有K线
        existing_df = self.mgr.query("stock_daily_kline")
        existing = set(existing_df["code"].unique()) & etf_codes
        etf_codes = etf_codes - existing
        if not etf_codes:
            logger.info("所有ETF已有K线数据")
            return 0

        logger.info("开始采集 %d 只ETF历史K线...", len(etf_codes))
        count = 0
        for code in sorted(etf_codes):
            result = self._safe_call(
                self.tq.get_market_data,
                stock_list=[code],
                period='1d',
                count=5000,
            )
            if not result or not isinstance(result, dict):
                continue
            closes = result.get("Close")
            if not isinstance(closes, pd.DataFrame) or closes.empty:
                continue

            code_col = closes.columns[0]
            prev_close = None
            for i in range(len(closes)):
                dt = pd.to_datetime(closes.index[i])
                close_price = float(closes[code_col].iloc[i])
                open_price = float(result["Open"][code_col].iloc[i]) if "Open" in result else close_price
                high_price = float(result["High"][code_col].iloc[i]) if "High" in result else close_price
                low_price = float(result["Low"][code_col].iloc[i]) if "Low" in result else close_price
                vol = int(result["Volume"][code_col].iloc[i]) if "Volume" in result else 0
                amt = float(result["Amount"][code_col].iloc[i]) if "Amount" in result else 0
                ff = float(result["ForwardFactor"][code_col].iloc[i]) if "ForwardFactor" in result else 0

                change = (close_price - prev_close) / prev_close * 100 if prev_close and prev_close != 0 else 0
                turnover = 0.0  # ETF不适用传统换手率（无流通股本概念）

                all_rows.append({
                    "code": code,
                    "date": dt.date(),
                    "open": open_price,
                    "high": high_price,
                    "low": low_price,
                    "close": close_price,
                    "volume": vol,
                    "amount": amt,
                    "change_pct": change,
                    "turnover": turnover,
                    "forward_factor": ff,
                })
                prev_close = close_price
                count += 1
            time.sleep(0.1)

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        df = df[["code", "date", "open", "high", "low", "close", "volume", "amount", "change_pct", "turnover", "forward_factor"]]
        self.mgr.write_df(df, "stock_daily_kline", ["code", "date"])
        logger.info("ETF历史K线: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 14: 技术指标（formula_process_mul_zb）
    # ──────────────────────────────────────────────
    def ingest_technical_indicators(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0
        codes = stock_df["code"].tolist()
        total = len(codes)
        all_rows = []
        cfg = self._get_task_config("technical_indicators")
        batch_size = cfg.get("batch_size", 100)
        start_dt, end_dt = self._get_date_range(cfg.get("data_range_days", 365))
        formulas = {
            "MACD": {"formula_arg": "", "xsflag": 2},
            "KDJ": {"formula_arg": "", "xsflag": 2},
            "RSI": {"formula_arg": "", "xsflag": 2},
            "BOLL": {"formula_arg": "", "xsflag": 2},
            "MA": {"formula_arg": "5", "xsflag": 2},
        }
        for formula_name, cfg in formulas.items():
            logger.info("技术指标 %s 开始计算...", formula_name)
            for i in range(0, total, batch_size):
                batch = codes[i: i + batch_size]
                result = self._safe_call(
                    self.tq.formula_process_mul_zb,
                    formula_name=formula_name,
                    formula_arg=cfg["formula_arg"],
                    xsflag=cfg["xsflag"],
                    return_count=1,
                    return_date=True,
                    stock_list=batch,
                    stock_period="1d",
                    count=-1,
                    start_time=start_dt,
                    end_time=end_dt,
                    dividend_type=1,
                )
                if not result or not isinstance(result, dict):
                    time.sleep(0.5)
                    continue
                for code in batch:
                    code_data = result.get(code, {})
                    if not isinstance(code_data, dict):
                        continue
                    for key, items in code_data.items():
                        if key == "ErrorId":
                            continue
                        if not isinstance(items, list) or not items:
                            continue
                        for item in items:
                            if not isinstance(item, dict):
                                continue
                            d = item.get("Date", "")
                            v_str = item.get("Value", "")
                            try:
                                v = float(v_str) if v_str is not None else None
                            except (ValueError, TypeError):
                                v = None
                            if v is not None and d:
                                all_rows.append({
                                    "code": code,
                                    "date": pd.to_datetime(str(d)).date(),
                                    "formula_name": formula_name,
                                    "output_key": key,
                                    "value": v,
                                })
                if (i + batch_size) % 500 == 0 and all_rows:
                    temp_df = pd.DataFrame(all_rows)
                    self.mgr.write_technical_indicators(temp_df)
                    logger.info("技术指标 %s 进度: %d/%d, 已写入 %d 条", formula_name, i + batch_size, total, len(all_rows))
                    all_rows = []
                time.sleep(2)
        if all_rows:
            temp_df = pd.DataFrame(all_rows)
            self.mgr.write_technical_indicators(temp_df)
        counts = self.mgr.get_table_counts()
        ti_count = counts.get("technical_indicators", 0)
        logger.info("技术指标入库完成, 总计: %d 条", ti_count)
        return ti_count

    # ──────────────────────────────────────────────
    # Step 15: 1分钟K线（委托 Step）
    # ──────────────────────────────────────────────
    def ingest_kline_1m(self, months: int = 1) -> int:
        task = COLLECTOR_TASKS.get("kline_1m")
        step = StockMinuteKline1mStep(manager=self.mgr, task_config=task)
        return step.run()

    def ingest_kline_5m(self, months: int = 1) -> int:
        task = COLLECTOR_TASKS.get("kline_5m")
        step = StockMinuteKline5mStep(manager=self.mgr, task_config=task)
        return step.run()

    # ──────────────────────────────────────────────
    # Step 17: 指数K线（日线+1m+5m，委托 Step）
    # ──────────────────────────────────────────────
    def ingest_index_kline(self, months: int = 1) -> dict:
        task = COLLECTOR_TASKS.get("index_kline")
        step = IndexKlineStep(manager=self.mgr, task_config=task)
        return step.run()

    # ──────────────────────────────────────────────
    # Step 18: 板块K线（日线+5m，委托 Step）
    # ──────────────────────────────────────────────
    def ingest_sector_kline(self, months: int = 1) -> dict:
        task = COLLECTOR_TASKS.get("sector_kline")
        step = SectorKlineStep(manager=self.mgr, task_config=task)
        return step.run()

    # ──────────────────────────────────────────────
    # Step 19: BK板块交易数据补跑
    # ──────────────────────────────────────────────
    def ingest_bk_trading_data(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0
        codes = stock_df["code"].tolist()
        bk_fields = BK_FIELDS
        cfg = self._get_task_config("bk_trading_data")
        batch_size = cfg.get("batch_size", 10)
        start_dt, end_dt = self._get_date_range(cfg.get("data_range_days", 90))
        all_rows = []
        total = len(codes)

        for i in range(0, total, batch_size):
            batch = codes[i:i + batch_size]
            for bk in bk_fields:
                data = self._safe_call(
                    self.tq.get_bkjy_value,
                    field_list=[bk],
                    stock_list=batch,
                    start_time=start_dt,
                    end_time=end_dt,
                )
                if not isinstance(data, dict):
                    continue
                for code, v in data.items():
                    if not isinstance(v, dict) or bk not in v:
                        continue
                    items = v[bk]
                    if not isinstance(items, list):
                        continue
                    for item in items:
                        try:
                            vals = item.get("Value", [])
                            row = {
                                "code": code,
                                "date": item.get("Date", ""),
                                "field": bk,
                                "value_0": float(vals[0]) if len(vals) > 0 and vals[0] else 0.0,
                                "value_1": float(vals[1]) if len(vals) > 1 and vals[1] else 0.0,
                            }
                            all_rows.append(row)
                        except (ValueError, TypeError, IndexError):
                            pass
                time.sleep(0.5)
            if (i + batch_size) % 100 == 0:
                logger.info("BK数据进度: %d/%d, 已收集 %d 条", i + batch_size, total, len(all_rows))
            time.sleep(1)

        if not all_rows:
            logger.info("BK板块交易数据: 无数据")
            return 0

        df = pd.DataFrame(all_rows)
        df["date"] = pd.to_datetime(df["date"], format="%Y%m%d").dt.date
        df = df[["code", "date", "field", "value_0", "value_1"]]
        self.mgr.write_df(df, "stock_trading_data_bk", ["code", "date", "field"])
        logger.info("BK板块交易数据: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 20: 股票扩展信息刷新（涨停价/换手率/量比/市值）
    # ──────────────────────────────────────────────
    def ingest_stock_extended_info_refresh(self) -> int:
        return self.ingest_stock_extended_info()

    # ──────────────────────────────────────────────
    # Step 6+ : 股票扩展信息线程优先采集（最近30天）
    # ──────────────────────────────────────────────
    def ingest_stock_extended_info_priority(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0

        codes = stock_df["code"].tolist()
        total = len(codes)
        all_rows = []
        today = datetime.now().date()
        end_dt = today
        cfg = self._get_task_config("stock_extended_info")
        batch_size = cfg.get("batch_size", 100)
        start_dt, _ = self._get_date_range(cfg.get("data_range_days", 30))
        lock = threading.Lock()

        def process_batch(batch_codes, start_idx):
            batch_rows = []
            for i, code in enumerate(batch_codes):
                info = self._safe_call(self.tq.get_more_info, stock_code=code)
                if not info or not isinstance(info, dict):
                    continue
                try:
                    zt_price = float(info.get("ZTPrice", 0))
                    dt_price = float(info.get("DTPrice", 0))
                    total_market_cap = float(info.get("Zsz", 0))
                    float_market_cap = float(info.get("Ltsz", 0))
                    pe_ttm = float(info.get("DynaPE", 0))
                    pb_mrq = float(info.get("PB_MRQ", 0))
                    dy_ratio = float(info.get("DYRatio", 0))
                    turnover_rate = float(info.get("fHSL", 0))
                    volume_ratio = float(info.get("fLianB", 0))
                    zaf = float(info.get("ZAF", 0))
                    beta_value = float(info.get("BetaValue", 0))
                    free_float_shares = float(info.get("FreeLtgb", 0))  # API返回万股,直接存

                    batch_rows.append({
                        "code": code,
                        "date": today,
                        "zt_price": float(info.get("ZTPrice", 0)),
                        "dt_price": float(info.get("DTPrice", 0)),
                        "total_market_cap": float(info.get("Zsz", 0)),
                        "float_market_cap": float(info.get("Ltsz", 0)),
                        "pe_ttm": float(info.get("DynaPE", 0)),
                        "pb_mrq": float(info.get("PB_MRQ", 0)),
                        "dy_ratio": float(info.get("DYRatio", 0)),
                        "turnover_rate": float(info.get("fHSL", 0)),
                        "volume_ratio": float(info.get("fLianB", 0)),
                        "zaf": float(info.get("ZAF", 0)),
                        "beta_value": float(info.get("BetaValue", 0)),
                        "free_float_shares": free_float_shares,
                    })
                except (ValueError, TypeError) as e:
                    logger.warning("解析扩展信息 %s 失败: %s", code, e)

            with lock:
                all_rows.extend(batch_rows)
            logger.info("扩展信息线程: %d/%d, 当前总数: %d", start_idx + len(batch_codes), total, len(all_rows))
            time.sleep(0.5)

        threads = []
        for i in range(0, total, batch_size):
            batch = codes[i: i + batch_size]
            thread = threading.Thread(target=process_batch, args=(batch, i))
            thread.start()
            threads.append(thread)
            if len(threads) >= EXTENDED_INFO_THREAD_COUNT:
                for t in threads:
                    t.join()
                threads = []

        for t in threads:
            t.join()

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        df["date"] = pd.to_datetime(df["date"]).dt.date
        self.mgr.write_stock_extended_info(df)
        logger.info("股票扩展信息(线程优先, 最近30天): %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 1: 交易日历
    # ──────────────────────────────────────────────
    def ingest_trading_calendar(self, years: int = 20) -> int:
        end_dt = datetime.now().strftime("%Y%m%d")
        start_dt = (datetime.now() - timedelta(days=365 * years)).strftime("%Y%m%d")
        dates = self._safe_call(
            self.tq.get_trading_dates,
            market='SH', start_time=start_dt, end_time=end_dt, count=0
        )
        if not dates:
            logger.warning("交易日历返回空")
            return 0

        trading_set = set()
        if isinstance(dates, list):
            trading_set = set(str(d) for d in dates)
        elif isinstance(dates, pd.DatetimeIndex):
            trading_set = set(d.strftime("%Y-%m-%d") for d in dates)

        all_dates = pd.date_range(start=start_dt, end=end_dt, freq="D")
        rows = []
        for d in all_dates:
            ds = d.strftime("%Y-%m-%d")
            is_trading = ds in trading_set or d.strftime("%Y%m%d") in trading_set
            if is_trading:
                rows.append({
                    "date": d.date(),
                    "is_trading": True,
                    "market": "SH",
                })
        df = pd.DataFrame(rows)
        self.mgr.write_trading_calendar(df)
        logger.info("交易日历: %d 条(仅交易日), 范围 %s ~ %s", len(df), start_dt, end_dt)
        return len(df)

    # ──────────────────────────────────────────────
    # Step 2: 股票列表
    # ──────────────────────────────────────────────
    def ingest_stock_list(self) -> int:
        stocks = self._safe_call(self.tq.get_stock_list, market='5', list_type=1)
        if not stocks:
            return 0
        all_stocks = []
        for s in stocks:
            if isinstance(s, dict):
                code = s.get("Code", s.get("code", ""))
                name = s.get("Name", s.get("name", ""))
            else:
                code = str(s)
                name = ""
            if not code:
                continue
            market = "SH" if code.endswith(".SH") else "SZ" if code.endswith(".SZ") else ""
            all_stocks.append({
                "code": code,
                "name": name,
                "market": market,
                "list_date": None,
                "delist_date": None,
                "main_business": "",
                "is_st": False,
                "is_suspend": False,
            })
        if not all_stocks:
            return 0
        df = pd.DataFrame(all_stocks)
        self.mgr.write_stock_basic_info(df)
        logger.info("股票列表: %d 只", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 3: 板块列表
    # ──────────────────────────────────────────────
    def ingest_sector_list(self) -> int:
        sectors = self._safe_call(self.tq.get_sector_list, list_type=1)
        if not sectors:
            return 0
        all_rows = []
        for s in sectors:
            if isinstance(s, dict):
                code = s.get("Code", s.get("code", ""))
                name = s.get("Name", s.get("name", ""))
            else:
                code = str(s)
                name = ""
            if code:
                all_rows.append({
                    "sector_code": code,
                    "name": name,
                    "sector_type": "industry",
                    "stock_count": 0,
                    "update_date": datetime.now().date(),
                })
        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        self.mgr.write_sector_list(df)
        logger.info("板块列表: %d 个", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 4: 股票-板块关系
    # ──────────────────────────────────────────────
    def ingest_stock_sector_relation(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            logger.warning("股票列表为空，跳过板块关系入库")
            return 0

        all_rows = []
        codes = stock_df["code"].tolist()
        total = len(codes)
        for i, code in enumerate(codes):
            relation = self._safe_call(self.tq.get_relation, stock_code=code)
            if not relation:
                continue
            if isinstance(relation, list):
                for item in relation:
                    if isinstance(item, dict):
                        sec_code = item.get("BlockCode", item.get("code", ""))
                        sec_name = item.get("BlockName", item.get("name", ""))
                        sec_type = item.get("BlockType", "")
                        if sec_code:
                            all_rows.append({
                                "stock_code": code,
                                "sector_code": sec_code,
                                "sector_type": sec_type,
                            })
            elif isinstance(relation, dict):
                for stype, sectors in relation.items():
                    if isinstance(sectors, list):
                        for sec in sectors:
                            if isinstance(sec, dict):
                                sec_code = sec.get("BlockCode", sec.get("code", ""))
                                sec_type = sec.get("BlockType", stype)
                            elif isinstance(sec, str):
                                sec_code = sec
                                sec_type = stype
                            else:
                                continue
                            if sec_code:
                                all_rows.append({
                                    "stock_code": code,
                                    "sector_code": sec_code,
                                    "sector_type": sec_type,
                                })
            if (i + 1) % 500 == 0:
                logger.info("板块关系进度: %d/%d", i + 1, total)
                time.sleep(0.3)

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        df = df.drop_duplicates(subset=["stock_code", "sector_code"])
        self.mgr.write_stock_sector_relation(df)
        logger.info("股票-板块关系: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 5: 股票日K线
    # ──────────────────────────────────────────────
    def ingest_stock_daily_kline(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            logger.warning("股票列表为空，跳过日K线入库")
            return 0

        # 加载股本数据用于换手率计算
        capital_df = self.mgr.query("stock_capital_data")
        float_shares_map = {}
        if not capital_df.empty:
            latest = capital_df.sort_values("date").groupby("code").last().reset_index()
            float_shares_map = dict(zip(latest["code"], latest["float_shares"]))

        stock_codes = stock_df["code"].tolist()
        total = len(stock_codes)
        cfg = self._get_task_config("stock_daily_kline")
        batch_size = cfg.get("batch_size", 50)
        start_dt, end_dt = self._get_date_range(cfg.get("data_range_days", 365*3))
        all_rows = []

        for i in range(0, total, batch_size):
            batch = stock_codes[i: i + batch_size]
            data = self._safe_call(
                self.tq.get_market_data,
                field_list=["Open", "High", "Low", "Close", "Volume", "Amount"],
                stock_list=batch,
                start_time=start_dt,
                end_time=end_dt,
                period="1d",
                count=-1,
                dividend_type="front",
                fill_data=False,
            )
            if not isinstance(data, dict) or not data:
                continue

            close_df = data.get("Close")
            if not isinstance(close_df, pd.DataFrame) or close_df.empty:
                continue

            open_df = data.get("Open", pd.DataFrame(index=close_df.index, columns=close_df.columns))
            high_df = data.get("High", pd.DataFrame(index=close_df.index, columns=close_df.columns))
            low_df = data.get("Low", pd.DataFrame(index=close_df.index, columns=close_df.columns))
            vol_df = data.get("Volume", pd.DataFrame(index=close_df.index, columns=close_df.columns))
            amt_df = data.get("Amount", pd.DataFrame(index=close_df.index, columns=close_df.columns))

            for code in batch:
                if code not in close_df.columns:
                    continue
                try:
                    close_s = close_df[code].dropna()
                    if close_s.empty:
                        continue
                    open_s = open_df[code] if code in open_df.columns else pd.Series(dtype=float)
                    high_s = high_df[code] if code in high_df.columns else pd.Series(dtype=float)
                    low_s = low_df[code] if code in low_df.columns else pd.Series(dtype=float)
                    vol_s = vol_df[code] if code in vol_df.columns else pd.Series(dtype=float)
                    amt_s = amt_df[code] if code in amt_df.columns else pd.Series(dtype=float)
                    prev_close = close_s.shift(1)

                    for idx in close_s.index:
                        curr = close_s[idx]
                        prev = prev_close.get(idx)
                        chg = ((curr - prev) / prev * 100) if pd.notna(prev) and prev > 0 else 0.0
                        all_rows.append({
                            "code": code,
                            "date": idx.date() if hasattr(idx, "date") else idx,
                            "open": float(open_s.get(idx, 0)) if pd.notna(open_s.get(idx)) else 0.0,
                            "high": float(high_s.get(idx, 0)) if pd.notna(high_s.get(idx)) else 0.0,
                            "low": float(low_s.get(idx, 0)) if pd.notna(low_s.get(idx)) else 0.0,
                            "close": float(curr),
                            "volume": int(vol_s.get(idx, 0)) if pd.notna(vol_s.get(idx)) else 0,
                            "amount": float(amt_s.get(idx, 0)) if pd.notna(amt_s.get(idx)) else 0.0,
                            "change_pct": round(chg, 2),
                            "turnover": round(int(vol_s.get(idx, 0)) / float_shares_map.get(code, 1) * 100, 4) if float_shares_map.get(code, 0) > 0 else 0.0,
                            "forward_factor": 1.0,
                        })
                except Exception as e:
                    logger.warning("处理股票 %s K线失败: %s", code, e)

            if (i + batch_size) % 500 == 0 and all_rows:
                temp_df = pd.DataFrame(all_rows)
                self.mgr.write_stock_kline(temp_df)
                logger.info("K线批量写入: %d 条, 进度 %d/%d", len(all_rows), i + batch_size, total)
                all_rows = []
            time.sleep(0.5)

        if all_rows:
            temp_df = pd.DataFrame(all_rows)
            self.mgr.write_stock_kline(temp_df)

        counts = self.mgr.get_table_counts()
        total_kline = counts.get("stock_daily_kline", 0)
        logger.info("股票日K线入库完成, 总计: %d 条", total_kline)
        return total_kline

    # ──────────────────────────────────────────────
    # Step 6: 股票扩展信息（get_more_info）
    # ──────────────────────────────────────────────
    def ingest_stock_extended_info(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0

        codes = stock_df["code"].tolist()
        total = len(codes)
        all_rows = []
        today = datetime.now().date()

        def _fetch_one(code):
            info = self._safe_call(self.tq.get_more_info, stock_code=code)
            if not info or not isinstance(info, dict):
                return None
            try:
                return {
                    "code": code,
                    "date": today,
                    "zt_price": float(info.get("ZTPrice", 0)),
                    "dt_price": float(info.get("DTPrice", 0)),
                    "total_market_cap": float(info.get("Zsz", 0)),
                    "float_market_cap": float(info.get("Ltsz", 0)),
                    "pe_ttm": float(info.get("DynaPE", 0)),
                    "pb_mrq": float(info.get("PB_MRQ", 0)),
                    "dy_ratio": float(info.get("DYRatio", 0)),
                    "turnover_rate": float(info.get("fHSL", 0)),
                    "volume_ratio": float(info.get("fLianB", 0)),
                    "zaf": float(info.get("ZAF", 0)),
                    "beta_value": float(info.get("BetaValue", 0)),
                    "free_float_shares": float(info.get("FreeLtgb", 0)),
                }
            except (ValueError, TypeError):
                return None

        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_fetch_one, code): code for code in codes}
            done_count = 0
            for f in as_completed(futures):
                done_count += 1
                row = f.result()
                if row:
                    all_rows.append(row)
                if done_count % 500 == 0:
                    logger.info("扩展信息进度: %d/%d", done_count, total)

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        self.mgr.write_stock_extended_info(df)
        logger.info("股票扩展信息: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 6++ : 财务数据入库（get_financial_data）
    # ──────────────────────────────────────────────
    FN_FIELD_MAP = {
        "FN001": ("每股指标", "基本每股收益"),
        "FN002": ("每股指标", "扣非每股收益"),
        "FN005": ("每股指标", "每股净资产"),
        "FN006": ("每股指标", "每股经营现金流"),
        "FN008": ("资产负债表", "货币资金"),
        "FN020": ("资产负债表", "流动资产合计"),
        "FN030": ("资产负债表", "非流动资产合计"),
        "FN031": ("资产负债表", "资产总计"),
        "FN040": ("资产负债表", "流动负债合计"),
        "FN050": ("资产负债表", "非流动负债合计"),
        "FN060": ("资产负债表", "负债合计"),
        "FN070": ("资产负债表", "所有者权益合计"),
        "FN100": ("现金流量表", "经营活动现金流量净额"),
        "FN110": ("现金流量表", "投资活动现金流量净额"),
        "FN120": ("现金流量表", "筹资活动现金流量净额"),
        "FN159": ("财务分析", "流动比率"),
        "FN161": ("财务分析", "资产负债率"),
        "FN170": ("财务分析", "毛利率"),
        "FN171": ("财务分析", "净利率"),
        "FN180": ("财务分析", "ROE"),
        "FN190": ("财务分析", "营收同比增长"),
        "FN191": ("财务分析", "净利润同比增长"),
        "FN230": ("利润表", "营业收入"),
        "FN231": ("利润表", "营业成本"),
        "FN232": ("利润表", "营业利润"),
        "FN234": ("利润表", "净利润"),
        "FN236": ("利润表", "扣非净利润"),
        "FN238": ("股本股东", "总股本"),
        "FN239": ("股本股东", "流通股本"),
    }

    def ingest_financial_data(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0

        codes = stock_df["code"].tolist()

        existing_df = self.mgr.query("financial_data")
        if not existing_df.empty:
            code_stats = existing_df.groupby("code").agg(
                n_rows=("field_name", "count"),
                n_dates=("date", "nunique"),
                n_types=("report_type", "nunique"),
            ).reset_index()
            complete_codes = set(
                code_stats[
                    (code_stats["n_dates"] >= 4) & (code_stats["n_types"] >= 5)
                ]["code"].tolist()
            )
            codes = [c for c in codes if c not in complete_codes]
            logger.info(
                "财务数据断点续传: 已完整 %d 只, 剩余 %d 只",
                len(complete_codes), len(codes),
            )

        if not codes:
            logger.info("财务数据已全部入库, 无需采集")
            return 0

        total = len(codes)
        all_rows = []
        batch_size = 50
        start_dt = (datetime.now() - timedelta(days=365 * self.years)).strftime("%Y%m%d")
        field_list = list(self.FN_FIELD_MAP.keys())

        for i in range(0, total, batch_size):
            batch = codes[i: i + batch_size]
            result = self._safe_call(
                self.tq.get_financial_data,
                stock_list=batch,
                field_list=field_list,
                start_time=start_dt,
            )
            if not isinstance(result, dict) or not result:
                failed = [c for c in batch if c not in (result or {})]
                if failed:
                    logger.info("批量失败, 逐只重试 %d 只", len(failed))
                    for code in failed:
                        single = self._safe_call(
                            self.tq.get_financial_data,
                            stock_list=[code],
                            field_list=field_list,
                            start_time=start_dt,
                        )
                        if isinstance(single, dict) and single:
                            result.update(single)
                        time.sleep(0.3)
                if not result:
                    time.sleep(0.5)
                    continue

            for code, df in result.items():
                if not isinstance(df, pd.DataFrame) or df.empty:
                    continue
                for _, row in df.iterrows():
                    tag_time = row.get("tag_time", "")
                    if not tag_time:
                        continue
                    try:
                        report_date = pd.to_datetime(str(int(tag_time))).date()
                    except (ValueError, TypeError):
                        continue

                    for fn_code, (report_type, field_name) in self.FN_FIELD_MAP.items():
                        if fn_code not in df.columns:
                            continue
                        val = row.get(fn_code)
                        if val is None or pd.isna(val):
                            continue
                        try:
                            fv = float(val)
                        except (ValueError, TypeError):
                            continue
                        all_rows.append({
                            "code": code,
                            "date": report_date,
                            "report_type": report_type,
                            "field_name": field_name,
                            "field_value": fv,
                        })

            if (i + batch_size) % 500 == 0 and all_rows:
                temp_df = pd.DataFrame(all_rows)
                self.mgr.write_financial_data(temp_df)
                logger.info("财务数据进度: %d/%d, 已写入 %d 条", i + batch_size, total, len(all_rows))
                all_rows = []
            elif len(all_rows) >= 5000:
                temp_df = pd.DataFrame(all_rows)
                self.mgr.write_financial_data(temp_df)
                logger.info("财务数据中间写入: %d 条", len(all_rows))
                all_rows = []
            time.sleep(0.5)

        if all_rows:
            temp_df = pd.DataFrame(all_rows)
            self.mgr.write_financial_data(temp_df)

        counts = self.mgr.get_table_counts()
        cnt = counts.get("financial_data", 0)
        logger.info("财务数据入库完成, 总计: %d 条", cnt)
        return cnt

    # ──────────────────────────────────────────────
    # Step 7: 股本数据（get_gb_info）
    # ──────────────────────────────────────────────
    def ingest_stock_capital_data(self) -> int:
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0

        codes = stock_df["code"].tolist()
        total = len(codes)
        all_rows = []

        cal_df = self.mgr.query("trading_calendar", filters={"is_trading": True})
        if cal_df.empty:
            logger.warning("交易日历为空，跳过股本数据入库")
            return 0
        recent_dates = cal_df.sort_values("date", ascending=False).head(5)["date"]
        date_list = [d.strftime("%Y%m%d") if hasattr(d, "strftime") else str(d) for d in recent_dates]

        def _fetch_one(code):
            gb = self._safe_call(self.tq.get_gb_info, stock_code=code, date_list=date_list)
            if not gb:
                return []
            rows = []
            items = gb if isinstance(gb, list) else [gb]
            for item in items:
                if not isinstance(item, dict):
                    continue
                ltgb = item.get("Ltgb", 0)
                zgb = item.get("Zgb", 0)
                date_val = item.get("Date", None)
                if ltgb or zgb:
                    rows.append({
                        "code": code,
                        "date": pd.to_datetime(str(date_val)).date() if date_val else datetime.now().date(),
                        "total_shares": int(float(zgb)) if zgb else 0,
                        "float_shares": int(float(ltgb)) if ltgb else 0,
                    })
            return rows

        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(_fetch_one, code): code for code in codes}
            done_count = 0
            for f in as_completed(futures):
                done_count += 1
                rows = f.result()
                all_rows.extend(rows)
                if done_count % 500 == 0:
                    logger.info("股本数据进度: %d/%d", done_count, total)

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        self.mgr.write_stock_capital_data(df)
        logger.info("股本数据: %d 条", len(df))
        return len(df)

    # ──────────────────────────────────────────────
    # Step 8: 板块日行情（get_bkjy_value）
    # ──────────────────────────────────────────────
    def ingest_sector_daily_data(self) -> int:
        start_dt, end_dt = self._date_range()
        sector_df = self.mgr.query("sector_list")
        if sector_df.empty:
            logger.warning("板块列表为空，跳过板块日行情入库")
            return 0

        sector_codes = sector_df["sector_code"].tolist()
        sector_names = sector_df.set_index("sector_code")["name"].to_dict()
        sector_types = sector_df.set_index("sector_code")["sector_type"].to_dict()
        total = len(sector_codes)
        all_rows = []
        cfg = self._get_task_config("sector_daily_data")
        batch_size = cfg.get("batch_size", 20)

        # BK字段→DB字段映射： (value_0字段, value_1字段)
        BK_FIELD_MAP = {
            "BK5":  ("pe_ttm", None),
            "BK6":  ("pb_mrq", None),
            "BK9":  ("advance", "decline"),
            "BK12": ("limit_up", None),
            "BK13": ("limit_down", None),
            "BK17": ("amount", None),
            "BK19": ("total_market_cap", None),
        }

        for i in range(0, total, batch_size):
            batch = sector_codes[i: i + batch_size]
            bkjy = self._safe_call(
                self.tq.get_bkjy_value,
                stock_list=batch,
                field_list=list(BK_FIELD_MAP.keys()),
                start_time=start_dt,
                end_time=end_dt,
            )
            if not bkjy or not isinstance(bkjy, dict):
                continue

            for sec_code in batch:
                sec_data = bkjy.get(sec_code, {})
                if not isinstance(sec_data, dict):
                    continue

                # 按日期聚合所有BK字段
                date_data = {}  # {date_str: {field: value}}
                for bk_code, (f0, f1) in BK_FIELD_MAP.items():
                    bk_list = sec_data.get(bk_code, [])
                    for item in (bk_list if isinstance(bk_list, list) else []):
                        if not isinstance(item, dict):
                            continue
                        d = item.get("Date", "")
                        vals = item.get("Value", [0, 0])
                        if d not in date_data:
                            date_data[d] = {}
                        if f0 and len(vals) > 0:
                            date_data[d][f0] = float(vals[0])
                        if f1 and len(vals) > 1:
                            date_data[d][f1] = float(vals[1])

                for d, fields in date_data.items():
                    try:
                        all_rows.append({
                            "sector_code": sec_code,
                            "date": pd.to_datetime(str(d)).date(),
                            "name": sector_names.get(sec_code, ""),
                            "sector_type": sector_types.get(sec_code, ""),
                            "change_pct": fields.get("change_pct", 0.0),
                            "amount": fields.get("amount", 0.0),
                            "turnover": 0.0,
                            "advance": int(fields.get("advance", 0)),
                            "decline": int(fields.get("decline", 0)),
                            "total_stocks": 0,
                            "pe_ttm": fields.get("pe_ttm", 0.0),
                            "pb_mrq": fields.get("pb_mrq", 0.0),
                            "total_market_cap": fields.get("total_market_cap", 0.0),
                            "limit_up": int(fields.get("limit_up", 0)),
                            "limit_down": int(fields.get("limit_down", 0)),
                            "flow_mv": fields.get("flow_mv", 0.0),
                        })
                    except Exception as e:
                        logger.warning("解析板块行情 %s 日期 %s 失败: %s", sec_code, d, e)

            if (i + batch_size) % 100 == 0 and all_rows:
                temp_df = pd.DataFrame(all_rows)
                self.mgr.write_sector_data(temp_df)
                logger.info("板块行情批量写入: %d 条, 进度 %d/%d", len(all_rows), i + batch_size, total)
                all_rows = []
            time.sleep(0.5)

        if all_rows:
            temp_df = pd.DataFrame(all_rows)
            self.mgr.write_sector_data(temp_df)

        counts = self.mgr.get_table_counts()
        total_sector = counts.get("sector_daily_data", 0)
        logger.info("板块日行情入库完成, 总计: %d 条", total_sector)
        return total_sector

    # ──────────────────────────────────────────────
    # Step 9: 股票交易数据（get_gpjy_value）
    # ──────────────────────────────────────────────
    def ingest_stock_trading_data(self) -> int:
        start_dt, end_dt = self._date_range()
        stock_df = self.mgr.query("stock_basic_info")
        if stock_df.empty:
            return 0

        codes = stock_df["code"].tolist()
        total = len(codes)
        all_rows = []
        cfg = self._get_task_config("stock_trading_data")
        batch_size = cfg.get("batch_size", 20)

        gp_fields = {
            "GP1": ("股东人数", "holder_count"),
            "GP3": ("融资融券", "margin_trading"),
            "GP11": ("资金流向", "capital_flow"),
            "GP12": ("大单小单净额", "big_small_order"),
            "GP13": ("中单超大单净额", "mid_super_order"),
            "GP14": ("涨停数据", "limit_up_data"),
            "GP16": ("总市值", "total_mv"),
            "GP19": ("市盈率", "pe_ratio"),
            "GP20": ("市净率", "pb_ratio"),
            "GP21": ("股息率", "div_yield"),
            "GP25": ("5日涨幅", "pct_5d"),
            "GP27": ("涨停统计", "limit_up_stat"),
            "GP28": ("量价指标", "vol_price"),
            "GP44": ("综合评分", "score"),
            "GP45": ("券商评级", "broker_rating"),
            "GP47": ("主力净额", "main_force_net"),
        }

        for i in range(0, total, batch_size):
            batch = codes[i: i + batch_size]
            for field_name, (field_type, field_key) in gp_fields.items():
                gpjy = self._safe_call(
                    self.tq.get_gpjy_value,
                    stock_list=batch,
                    field_list=[field_name],
                    start_time=start_dt,
                    end_time=end_dt,
                )
                if not gpjy or not isinstance(gpjy, dict):
                    continue

                for code in batch:
                    code_data = gpjy.get(code, {})
                    if not isinstance(code_data, dict):
                        continue
                    items = code_data.get(field_name, [])
                    if not isinstance(items, list):
                        continue
                    for item in items:
                        if not isinstance(item, dict):
                            continue
                        d = item.get("Date", "")
                        vals = item.get("Value", [0, 0])
                        v0 = float(vals[0]) if len(vals) > 0 and vals[0] is not None else 0.0
                        v1 = float(vals[1]) if len(vals) > 1 and vals[1] is not None else 0.0
                        try:
                            all_rows.append({
                                "code": code,
                                "date": pd.to_datetime(str(d)).date(),
                                "field_type": field_type,
                                "field_name": field_name,
                                "value_0": v0,
                                "value_1": v1,
                            })
                        except Exception:
                            pass

            if (i + batch_size) % 200 == 0 and all_rows:
                temp_df = pd.DataFrame(all_rows)
                trading_dates = set(
                    self.mgr.query("stock_daily_kline")["date"].unique().tolist()
                )
                before = len(temp_df)
                temp_df = temp_df[temp_df["date"].isin(trading_dates)]
                if before - len(temp_df) > 0:
                    logger.info("股票交易数据: 过滤非交易日 %d 条", before - len(temp_df))
                if temp_df.empty:
                    all_rows = []
                    continue
                self.mgr.write_stock_trading_data(temp_df)
                logger.info("股票交易数据批量写入: %d 条, 进度 %d/%d", len(temp_df), i + batch_size, total)
                all_rows = []
            time.sleep(0.5)

        if all_rows:
            temp_df = pd.DataFrame(all_rows)
            trading_dates = set(
                self.mgr.query("stock_daily_kline")["date"].unique().tolist()
            )
            before = len(temp_df)
            temp_df = temp_df[temp_df["date"].isin(trading_dates)]
            if before - len(temp_df) > 0:
                logger.info("股票交易数据: 过滤非交易日 %d 条", before - len(temp_df))
            if not temp_df.empty:
                self.mgr.write_stock_trading_data(temp_df)

        counts = self.mgr.get_table_counts()
        total_st = counts.get("stock_trading_data", 0)
        logger.info("股票交易数据入库完成, 总计: %d 条", total_st)
        return total_st

    # ──────────────────────────────────────────────
    # Step 10: 市场交易数据（get_scjy_value）
    # ──────────────────────────────────────────────
    def ingest_market_trading_data(self) -> int:
        start_dt, end_dt = self._date_range()
        end_dt_safe = (datetime.now() - timedelta(days=2)).strftime("%Y%m%d")
        sc_fields = {
            "SC1": "融资融券余额",
            "SC2": "陆股通资金流入",
            "SC3": "涨跌停股数",
            "SC4": "涨跌家数",
            "SC5": "融资净买入",
            "SC6": "融券净卖出",
            "SC7": "融资融券净额",
            "SC8": "北向资金",
            "SC10": "市场均价振幅",
            "SC31": "涨停跌停统计",
            "SC34": "融资融券余额明细",
        }
        all_rows = []

        for field_name, field_desc in sc_fields.items():
            scjy = self._safe_call(
                self.tq.get_scjy_value,
                field_list=[field_name],
                start_time=start_dt,
                end_time=end_dt_safe,
            )
            if not scjy or not isinstance(scjy, dict):
                continue
            items = scjy.get(field_name, [])
            if not isinstance(items, list):
                continue
            for item in items:
                if not isinstance(item, dict):
                    continue
                d = item.get("Date", "")
                vals = item.get("Value", [0, 0])
                v0 = float(vals[0]) if len(vals) > 0 and vals[0] is not None else 0.0
                v1 = float(vals[1]) if len(vals) > 1 and vals[1] is not None else 0.0
                try:
                    all_rows.append({
                        "date": pd.to_datetime(str(d)).date(),
                        "field_name": field_name,
                        "value_0": v0,
                        "value_1": v1,
                        "market": "SH",
                    })
                except Exception:
                    pass

        if not all_rows:
            return 0
        df = pd.DataFrame(all_rows)
        trading_dates = set(
            self.mgr.query("stock_daily_kline")["date"].unique().tolist()
        )
        before = len(df)
        df = df[df["date"].isin(trading_dates)]
        removed = before - len(df)
        if removed > 0:
            logger.info("市场交易数据: 过滤非交易日 %d 条", removed)
        if df.empty:
            return 0
        self.mgr.write_market_trading_data(df)
        logger.info("市场交易数据: %d 条", len(df))
        return len(df)

    def step_run(self, step_class, task_config=None) -> int:
        """通过 Step 类执行采集任务（统一生命周期 + 进度监控）"""
        from db.steps import StepContext
        task = task_config or COLLECTOR_TASKS.get(step_class.name)
        step = step_class(manager=self.mgr, task_config=task)
        return step.run()

    def _get_task_config(self, task_id: str) -> dict:
        """从 CollectorTask 配置获取执行参数"""
        task = COLLECTOR_TASKS.get(task_id)
        if task:
            return {
                "batch_size": task.batch_size,
                "data_range_days": task.data_range_days,
                "timeout": task.timeout,
                "retry_times": task.retry_times,
            }
        return {}

    # ──────────────────────────────────────────────
    # ETF Pipeline 代理方法
    # ──────────────────────────────────────────────

    def ingest_etf_product_info(self) -> int:
        """ETF 产品维度入库 (二进制优先)"""
        return self.etf.ingest_product_info()

    def ingest_etf_iopv_snapshot(self) -> int:
        """ETF IOPV 快照入库"""
        return self.etf.ingest_iopv_snapshot()

    def ingest_etf_share_scale(self) -> int:
        """ETF 份额规模入库"""
        return self.etf.ingest_share_scale()

    def ingest_etf_capital_flow(self) -> int:
        """ETF 资金流向入库"""
        return self.etf.ingest_capital_flow()

    def ingest_etf_derived_indicators(self) -> int:
        """ETF 衍生指标计算 (纯 SQL)"""
        return self.etf.compute_derived_indicators()

    def _get_date_range(self, days: int) -> tuple:
        end = datetime.now()
        start = end - timedelta(days=days)
        return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

    # ──────────────────────────────────────────────
    # 全量执行
    # ──────────────────────────────────────────────
    def run_all(self):
        logger.info("=" * 60)
        logger.info("开始全量数据入库, 范围: 近 %d 年", self.years)
        logger.info("=" * 60)

        if not self.tq:
            logger.error("TDXQuant 未连接，无法入库。请确保通达信客户端已启动。")
            return

        steps = [
            ("交易日历", self.ingest_trading_calendar),
            ("股票列表", self.ingest_stock_list),
            ("板块列表", self.ingest_sector_list),
            ("股票-板块关系", self.ingest_stock_sector_relation),
            ("股票日K线", self.ingest_stock_daily_kline),
            ("股票扩展信息", self.ingest_stock_extended_info),
            ("股本数据", self.ingest_stock_capital_data),
            ("板块日行情", self.ingest_sector_daily_data),
            ("股票交易数据", self.ingest_stock_trading_data),
            ("市场交易数据", self.ingest_market_trading_data),
            ("板块成份股", self.ingest_sector_stocks),
            ("新股申购", self.ingest_ipo_info),
            ("ETF信息", self.ingest_etf_info),
            ("ETF产品维度", self.ingest_etf_product_info),
            ("技术指标", self.ingest_technical_indicators),
            ("ETF衍生指标", self.ingest_etf_derived_indicators),
        ]

        results = {}
        for name, func in steps:
            logger.info(">>> 开始: %s", name)
            try:
                count = func()
                results[name] = {"status": "success", "count": count}
                logger.info("<<< 完成: %s, %d 条", name, count)
            except Exception as e:
                results[name] = {"status": "error", "error": str(e)}
                logger.error("<<< 失败: %s, %s", name, e)

        logger.info("=" * 60)
        logger.info("入库结果汇总:")
        for name, r in results.items():
            if r["status"] == "success":
                logger.info("  ✅ %s: %d 条", name, r["count"])
            else:
                logger.info("  ❌ %s: %s", name, r["error"])
        logger.info("=" * 60)

        # 自动更新 meta 表
        self._update_meta()

        return results

    def _update_meta(self):
        """自动更新 meta.table_registry 和 meta.data_dict"""
        import duckdb
        from datetime import datetime

        logger.info("更新 meta 表...")

        # 通过 manager 获取 db_path
        db_path = self.mgr.db_path
        conn = duckdb.connect(str(db_path))
        now = datetime.now()

        # Step 1: 更新 data_dict 的 row_count
        try:
            tables_df = conn.execute("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'main' AND table_type = 'BASE TABLE'
            """).df()

            for _, row in tables_df.iterrows():
                tbl = row['table_name']
                try:
                    cnt = conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
                    conn.execute("UPDATE meta.data_dict SET row_count = ? WHERE table_name = ?", [cnt, tbl])
                except:
                    pass
            logger.info("  data_dict.row_count 已更新")
        except Exception as e:
            logger.warning("  data_dict 更新失败: %s", e)

        # Step 2: 更新 table_registry.last_run_at
        try:
            # 从 results 中获取本次运行的表，更新 last_run_at
            step_to_table = {
                "交易日历": "trading_calendar",
                "股票列表": "stock_basic_info",
                "板块列表": "sector_list",
                "股票-板块关系": "stock_sector_relation",
                "股票日K线": "stock_daily_kline",
                "股票扩展信息": "stock_extended_info",
                "股本数据": "stock_capital_data",
                "板块日行情": "sector_daily_data",
                "股票交易数据": "stock_trading_data",
                "市场交易数据": "market_trading_data",
                "板块成份股": "sector_stocks",
                "新股申购": "ipo_info",
                "ETF信息": "etf_data",
                "ETF产品维度": "etf_product",
                "技术指标": "technical_indicators",
                "ETF衍生指标": "etf_derived_indicator",
            }

            for step_name, table_name in step_to_table.items():
                conn.execute(
                    "UPDATE meta.table_registry SET last_run_at = ? WHERE table_name = ?",
                    [now, table_name]
                )
            logger.info("  table_registry.last_run_at 已更新")
        except Exception as e:
            logger.warning("  table_registry 更新失败: %s", e)

        conn.close()
        logger.info("meta 表更新完成")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="TDXQuant 数据入库管道")
    parser.add_argument("--years", type=int, default=1, help="入库数据年限(默认1年)")
    parser.add_argument("--step", type=str, default="all",
                        help="执行步骤(all/calendar/stock_list/sector_list/relation/kline/extended/capital/sector_daily/stock_trading/market_trading)")
    args = parser.parse_args()

    pipeline = DataPipeline(years=args.years)

    step_map = {
        "calendar": pipeline.ingest_trading_calendar,
        "stock_list": pipeline.ingest_stock_list,
        "sector_list": pipeline.ingest_sector_list,
        "relation": pipeline.ingest_stock_sector_relation,
        "kline": pipeline.ingest_stock_daily_kline,
        "extended": pipeline.ingest_stock_extended_info,
        "capital": pipeline.ingest_stock_capital_data,
        "sector_daily": pipeline.ingest_sector_daily_data,
        "stock_trading": pipeline.ingest_stock_trading_data,
        "market_trading": pipeline.ingest_market_trading_data,
        "sector_stocks": pipeline.ingest_sector_stocks,
        "ipo": pipeline.ingest_ipo_info,
        "etf": pipeline.ingest_etf_info,
        "etf_product": pipeline.ingest_etf_product_info,
        "etf_iopv": pipeline.ingest_etf_iopv_snapshot,
        "etf_share": pipeline.ingest_etf_share_scale,
        "etf_flow": pipeline.ingest_etf_capital_flow,
        "etf_derived": pipeline.ingest_etf_derived_indicators,
        "tech_indicators": pipeline.ingest_technical_indicators,
        "kline_1m": pipeline.ingest_kline_1m,
        "kline_5m": pipeline.ingest_kline_5m,
        "index_kline": pipeline.ingest_index_kline,
        "sector_kline": pipeline.ingest_sector_kline,
        "bk_trading": pipeline.ingest_bk_trading_data,
        "extended_refresh": pipeline.ingest_stock_extended_info_refresh,
    }

    if args.step == "all":
        pipeline.run_all()
    elif args.step in step_map:
        step_map[args.step]()
    else:
        logger.error("未知步骤: %s, 可选: %s", args.step, ", ".join(step_map.keys()))

    info = pipeline.mgr.get_info()
    logger.info("数据库状态: %s", info)


if __name__ == "__main__":
    main()
