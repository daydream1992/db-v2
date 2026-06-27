#!/usr/bin/env python3
"""
ETF 数据入库管道 — 产品信息/IOPV/份额/资金流向/衍生指标

数据来源优先级: 二进制(K线已有) > API(get_trackzs_etf_info/get_more_info/get_gpjy_value) > SQL计算

运行方式:
  python etf_pipeline.py --init         # 首次初始化 (产品维度+衍生指标)
  python etf_pipeline.py --daily        # 盘后增量 (IOPV+份额+资金流+衍生)
  python etf_pipeline.py --product      # 仅刷新产品维度
  python etf_pipeline.py --derived      # 仅重算衍生指标
"""
import re
import struct
import sys
import time
import logging
import argparse
from pathlib import Path
from datetime import datetime
from typing import Optional, Set, Dict, List, Tuple

import pandas as pd
import numpy as np

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

# TDX 本地缓存目录 — 二进制优先数据源
# ============================================================
# ===== 可调参数（改这里就行）=====
# ============================================================
TDX_CACHE_DIRS = [
    Path(r"I:\new_tdx_mock\T0002\hq_cache"),
    Path(r"C:\new_tdx64\T0002\hq_cache"),
]
TDX_USER_DIRS = [
    Path(r"I:\new_tdx_mock\PYPlugins\user"),
    Path(r"C:\new_tdx64\PYPlugins\user"),
]
# ================================================
TDX_CACHE_DIR: Optional[Path] = None
for d in TDX_CACHE_DIRS:
    if d.exists():
        TDX_CACHE_DIR = d
        break

for p in TDX_USER_DIRS:
    if p.exists():
        sys.path.insert(0, str(p))
        break

from db.manager import DuckDBManager, DB_PATH
from tqcenter import tq

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(levelname)s] %(message)s",
                    datefmt="%H:%M:%S")
log = logging.getLogger("etf_pipeline")

# ─── ETF 代码前缀 → 分类启发式 ───

ETF_TYPE_MAP = {
    # SH 前缀
    "511": ("债券", "债券ETF", "利率债/信用债"),
    "518": ("商品", "商品ETF", "黄金/原油"),
    "520": ("商品", "商品ETF", "黄金"),
    "513": ("跨境", "跨境ETF", "QDII"),
    "588": ("科创", "科创板ETF", "科创50/双创"),
    "589": ("科创", "科创板ETF", "科创板"),
    # SZ 前缀
    "159": ("股票", "股票ETF", "指数跟踪"),
    "160": ("LOF", "LOF基金", "上市开放式"),
    "161": ("LOF", "LOF基金", "上市开放式"),
    "162": ("LOF", "LOF基金", "分级/LOF"),
    "163": ("LOF", "LOF基金", "分级/LOF"),
    "164": ("LOF", "LOF基金", "分级/LOF"),
    "165": ("LOF", "LOF基金", "分级/LOF"),
    "166": ("LOF", "LOF基金", "分级/LOF"),
    "167": ("LOF", "LOF基金", "跨境LOF"),
    "168": ("LOF", "LOF基金", "跨境LOF"),
    "169": ("LOF", "LOF基金", "跨境LOF"),
    "180": ("债券", "债券ETF", "政金债"),
    "184": ("债券", "债券ETF", "国债"),
    "188": ("债券", "债券ETF", "地方债"),
}

# SZ 159xxx 细分
SZ_159_SUBTYPE = {
    range(0, 400): ("股票", "宽基ETF", "沪深300/中证500等"),
    range(400, 600): ("股票", "行业ETF", "行业/主题"),
    range(600, 900): ("股票", "主题ETF", "热门主题"),
    range(900, 1000): ("跨境", "跨境ETF", "QDII"),
}

# 已知指数代码
TRACK_INDICES = {
    "950162.CSI": "中证全指",
    "000300.SH": "沪深300",
    "000905.SH": "中证500",
    "000852.SH": "中证1000",
    "000016.SH": "上证50",
    "000688.SH": "科创50",
    "399006.SZ": "创业板指",
    "000689.SH": "科创创业50",
    "000001.SH": "上证指数",
    "399001.SZ": "深证成指",
    "399673.SZ": "创业板50",
    "399005.SZ": "中小板指",
}

# 宽基/活跃ETF板块代码
ETF_SECTOR_CODES = {
    "880676.SH": "活跃ETF",
    "880698.SH": "宽基ETF",
}


def classify_etf(code: str) -> tuple:
    """
    根据代码前缀返回 (etf_type, category_l1, category_l2)
    """
    num_part = code.split(".")[0] if "." in code else code[:6]
    prefix = num_part[:3]
    suffix = code.split(".")[-1] if "." in code else ""

    # SZ 159 细分
    if prefix == "159":
        num = int(num_part[3:6]) if len(num_part) >= 6 else 0
        for rng, info in SZ_159_SUBTYPE.items():
            if num in rng:
                return info
        return ("股票", "股票ETF", "其他")

    if prefix in ETF_TYPE_MAP:
        return ETF_TYPE_MAP[prefix]

    # SH 510/512/515/516/517/530/551/560/561/562/563 → 股票ETF
    sh_stock = {"510", "512", "515", "516", "517", "530", "551",
                "560", "561", "562", "563", "526"}
    if prefix in sh_stock:
        return ("股票", "股票ETF", "指数跟踪")

    return ("其他", "其他", "其他")


class ETFPipeline:
    """ETF 数据入库管道"""

    def __init__(self, manager: DuckDBManager = None, tq_obj=None):
        self.mgr = manager or DuckDBManager()
        self._tq = tq_obj
        self._tq_initialized = False

    @property
    def tq(self):
        if not self._tq_initialized:
            if self._tq is None:
                try:
                    tq.initialize(str(BASE / "pipeline.py"))
                    self._tq = tq
                    log.info("TQ API 已连接")
                except Exception as e:
                    log.warning(f"TQ API 连接失败: {e}")
                    self._tq = None
            self._tq_initialized = True
        return self._tq

    def _safe_call(self, func, *args, **kwargs):
        try:
            return func(*args, **kwargs)
        except Exception as e:
            log.debug(f"API 调用失败 {func.__name__}: {e}")
            return None

    # ─── 工具方法 ───

    def _get_etf_codes(self) -> Set[str]:
        """从 etf_daily_kline 获取所有 ETF 代码"""
        try:
            df = self.mgr.execute(
                "SELECT DISTINCT code FROM etf_daily_kline ORDER BY code"
            )
            if df is not None and len(df) > 0:
                return set(df["code"].tolist())
        except Exception:
            pass
        return set()

    # ─── 二进制解析方法 ───

    def _parse_specetfdata(self) -> Dict[str, Dict]:
        """
        解析 TDX 本地 specetfdata.txt — ETF 元数据
        格式: market,code,track_index,is_primary,fund_code,,list_date,listing_date
        market: 0=SZ, 1=SH

        Returns: {code_suffix: {track_index, is_primary, fund_code, list_date, listing_date, market}}
        """
        if TDX_CACHE_DIR is None:
            log.warning("  TDX 缓存目录不存在, 跳过 specetfdata 解析")
            return {}

        path = TDX_CACHE_DIR / "specetfdata.txt"
        if not path.exists():
            log.warning(f"  {path} 不存在")
            return {}

        result = {}
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split(",")
                if len(parts) < 8:
                    continue
                try:
                    market = int(parts[0])  # 0=SZ, 1=SH
                    code_num = parts[1].strip()
                    track_index = parts[2].strip()
                    is_primary = int(parts[3]) if parts[3].strip() else 0
                    fund_code = parts[4].strip()
                    list_date_str = parts[6].strip()
                    listing_date_str = parts[7].strip()
                except (ValueError, IndexError):
                    continue

                if not code_num or len(code_num) != 6:
                    continue

                # 解析日期 YYYYMMDD → YYYY-MM-DD
                def _parse_date(s):
                    if len(s) == 8 and s.isdigit():
                        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
                    return None

                suffix = "SH" if market == 1 else "SZ"
                result[code_num] = {
                    "track_index": track_index,
                    "is_primary": bool(is_primary),
                    "fund_code": fund_code,
                    "list_date": _parse_date(list_date_str),
                    "listing_date": _parse_date(listing_date_str),
                    "market": suffix,
                }

        log.info(f"  specetfdata.txt: {len(result)} 条 ETF 元数据")
        return result

    def _parse_tnf_names(self) -> Dict[str, str]:
        """
        解析 shs.tnf / szs.tnf — 从二进制文件提取 ETF code→名称 映射
        TNF 格式: 变长记录，代码为 ASCII 6 位数字，夹在 \\x00\\x00 与 \\x00 之间
        名称紧跟代码后的 GBK 字节

        Returns: {6位代码: 名称}
        """
        if TDX_CACHE_DIR is None:
            log.warning("  TDX 缓存目录不存在, 跳过 TNF 解析")
            return {}

        etf_prefixes = {
            "SH": {"510", "511", "512", "513", "515", "516", "517", "518", "520",
                    "526", "530", "551", "560", "561", "562", "563", "588", "589"},
            "SZ": {"159", "160", "161", "162", "163", "164", "165", "166", "167",
                    "168", "169", "180", "184", "188"},
        }

        names = {}
        for filename, prefixes in [("shs.tnf", etf_prefixes["SH"]),
                                    ("szs.tnf", etf_prefixes["SZ"])]:
            path = TDX_CACHE_DIR / filename
            if not path.exists():
                log.debug(f"  {path} 不存在, 跳过")
                continue

            with open(path, "rb") as f:
                raw = f.read()

            # 正则匹配: 6位ASCII数字代码夹在两个\x00之间
            pattern = rb'(?<=\x00\x00)(\d{6})(?=\x00)'
            count = 0
            for m in re.finditer(pattern, raw):
                code = m.group(1).decode("ascii")
                if code[:3] not in prefixes:
                    continue

                pos = m.start()
                # 名称: 跳过代码后的\x00, 读 GBK 到下一个\x00
                name_start = m.end()
                while name_start < len(raw) and raw[name_start] == 0:
                    name_start += 1
                name_end = name_start
                while name_end < len(raw) and raw[name_end] != 0:
                    name_end += 1

                name_bytes = raw[name_start:name_end]
                try:
                    name = name_bytes.decode("gbk", errors="replace").strip()
                except Exception:
                    name = ""

                if name and len(name) > 1:
                    names[code] = name
                    count += 1

            log.info(f"  {filename}: {count} 个 ETF 名称")

        log.info(f"  TNF 名称合计: {len(names)} 条")
        return names

    @staticmethod
    def _normalize_track_index(idx_num: str) -> str:
        """
        将 specetfdata.txt 中的 track_index 纯数字映射为标准指数代码
        非数字代码 (Au99.99, SPSIOPTR 等) 返回空串 — 对应商品/跨境指数
        """
        if not idx_num or not idx_num.isdigit() or len(idx_num) != 6:
            return ""
        # 上证: 000xxx, 880xxx (板块) → .SH
        if idx_num[:3] in ("000", "880"):
            return f"{idx_num}.SH"
        # 深证: 399xxx → .SZ
        if idx_num[:3] == "399":
            return f"{idx_num}.SZ"
        # 其他 6 位纯数字, 默认尝试 .SH
        return f"{idx_num}.SH"

    # ─── API 回退方法 ───

    def _api_get_etf_index_mapping(self) -> Dict[str, str]:
        """API 回退: 通过 get_trackzs_etf_info 获取 ETF-指数映射"""
        if self.tq is None:
            return {}

        mapping = {}
        for idx_code, idx_name in TRACK_INDICES.items():
            raw = self._safe_call(self.tq.get_trackzs_etf_info, zs_code=idx_code)
            if not raw:
                continue
            items = raw.get("Value", raw) if isinstance(raw, dict) else raw
            if isinstance(items, dict):
                items = [items]
            if isinstance(items, list):
                for item in items:
                    if isinstance(item, dict):
                        etf_code = item.get("Code", "")
                        if etf_code:
                            mapping[etf_code] = idx_code
            log.info(f"  API {idx_code} ({idx_name}): "
                     f"{sum(1 for v in mapping.values() if v == idx_code)} 只 ETF")
            time.sleep(0.25)

        return mapping

    def _api_get_etf_names(self) -> Dict[str, str]:
        """API 回退: 从板块获取 ETF 代码→名称映射"""
        if self.tq is None:
            return {}

        names = {}
        for sector_code, sector_name in ETF_SECTOR_CODES.items():
            raw = self._safe_call(
                self.tq.get_stock_list_in_sector,
                block_code=sector_code, list_type=1
            )
            if not raw:
                continue
            items = raw if isinstance(raw, list) else []
            for item in items:
                if isinstance(item, dict):
                    code = item.get("Code", "")
                    name = item.get("Name", "")
                    if code:
                        names[code] = name
            time.sleep(0.3)

        return names

    # ─── Phase 1: 产品维度 (二进制优先) ───

    def ingest_product_info(self) -> int:
        """
        填充 etf_product + etf_index_tracking

        数据源优先级:
          1. TDX 本地二进制 (specetfdata.txt + shs.tnf/szs.tnf)
          2. 已有 K 线表 (etf_daily_kline → 代码种子 + 首末交易日)
          3. API 回退 (get_trackzs_etf_info + get_stock_list_in_sector)
          4. 代码前缀启发式 (classify_etf)
        """
        log.info("=" * 50)
        log.info("ETF 产品维度入库 (二进制优先)")
        log.info("=" * 50)

        t0 = time.time()

        # ── Step 1: 从已有 K 线表获取 ETF 代码种子 ──
        codes = self._get_etf_codes()
        log.info(f"  [K线种子] etf_daily_kline → {len(codes)} 个 ETF 代码")
        if not codes:
            log.warning("  无 ETF 代码, 跳过")
            return 0

        # ── Step 2: 本地二进制解析 ──
        log.info("  ── 二进制解析 ──")

        # 2a. specetfdata.txt → 跟踪指数 + 上市日期 + 市场
        spec_data = self._parse_specetfdata()

        # 2b. shs.tnf / szs.tnf → ETF 名称
        tnf_names = self._parse_tnf_names()

        # 合并统计
        codes_with_name = 0
        codes_with_track = 0
        codes_with_listdate = 0
        for code in codes:
            num_part = code.split(".")[0]
            if num_part in tnf_names:
                codes_with_name += 1
            if num_part in spec_data and spec_data[num_part].get("track_index"):
                codes_with_track += 1
            if num_part in spec_data and spec_data[num_part].get("list_date"):
                codes_with_listdate += 1

        log.info(f"  [二进制] 名称覆盖: {codes_with_name}/{len(codes)}")
        log.info(f"  [二进制] 跟踪指数: {codes_with_track}/{len(codes)}")
        log.info(f"  [二进制] 上市日期: {codes_with_listdate}/{len(codes)}")

        # ── Step 3: API 回退填充名称缺口 ──
        missing_names = set()
        for code in codes:
            num_part = code.split(".")[0]
            if num_part not in tnf_names:
                missing_names.add(code)

        api_names: Dict[str, str] = {}
        if missing_names and self.tq is not None:
            log.info(f"  ── API 回退: 补充 {len(missing_names)} 个缺失名称 ──")
            api_names = self._api_get_etf_names()
            still_missing = missing_names - set(api_names.keys())
            if still_missing:
                log.info(f"  API 后仍有 {len(still_missing)} 个名称缺失")
        else:
            if missing_names:
                log.info(f"  有 {len(missing_names)} 个名称缺失, API 未连接, 跳过回退")

        # ── Step 4: API 回退补充 ETF-指数映射 ──
        # 先统计二进制已覆盖的跟踪指数
        local_track_count = sum(1 for c in codes
                                if c.split(".")[0] in spec_data
                                and spec_data[c.split(".")[0]].get("track_index"))

        api_idx_mapping: Dict[str, str] = {}
        if local_track_count < len(codes) * 0.8 and self.tq is not None:
            log.info(f"  ── API 回退: 补充 ETF-指数映射 ──")
            api_idx_mapping = self._api_get_etf_index_mapping()
            log.info(f"  API 映射: {len(api_idx_mapping)} 只")
        else:
            log.info(f"  二进制跟踪指数覆盖充分 ({local_track_count}/{len(codes)}), 跳过 API 回退")

        # ── Step 5: 从 K 线表获取首末交易日 ──
        try:
            df_kline_range = self.mgr.execute("""
                SELECT code, MIN(date) as first_trade, MAX(date) as last_trade
                FROM etf_daily_kline
                GROUP BY code
            """)
            kline_range = {}
            if df_kline_range is not None and len(df_kline_range) > 0:
                for _, row in df_kline_range.iterrows():
                    kline_range[row["code"]] = {
                        "first_trade": row["first_trade"],
                        "last_trade": row["last_trade"],
                    }
        except Exception:
            kline_range = {}

        # ── Step 6: 构建 etf_product 数据 ──
        rows = []
        track_rows = []
        seen_track = set()  # 去重 etf_index_tracking

        for code in sorted(codes):
            num_part = code.split(".")[0]
            suffix = code.split(".")[-1]
            etf_type, cat_l1, cat_l2 = classify_etf(code)

            # 名称: 二进制 → API → 空
            name = tnf_names.get(num_part, "") or api_names.get(code, "")

            # 跟踪指数: 二进制 specetfdata → API → 空
            track_idx_full = ""
            track_name = ""
            meta = spec_data.get(num_part, {})
            if meta and meta.get("track_index"):
                idx_num = meta["track_index"]
                track_idx_full = self._normalize_track_index(idx_num)
                track_name = TRACK_INDICES.get(track_idx_full, "") if track_idx_full else ""
            elif code in api_idx_mapping:
                track_idx_full = api_idx_mapping[code]
                track_name = TRACK_INDICES.get(track_idx_full, "")

            # 上市日期: 二进制 → K 线首日 → 空
            list_date = None
            if meta and meta.get("list_date"):
                list_date = meta["list_date"]
            elif code in kline_range:
                list_date = str(kline_range[code]["first_trade"])

            # 市场: 二进制 → 代码后缀
            market = meta.get("market", suffix) if meta else suffix

            # 是否活跃: K 线末日在最近 60 天内
            is_active = True
            if code in kline_range:
                from datetime import date as date_cls
                last = kline_range[code]["last_trade"]
                if hasattr(last, 'date'):
                    last = last.date()
                elif isinstance(last, str):
                    last = date_cls.fromisoformat(last)
                if hasattr(last, '__sub__'):
                    is_active = (date_cls.today() - last).days < 60

            rows.append({
                "code": code,
                "name": name,
                "market": market,
                "track_index": track_idx_full,
                "track_index_name": track_name,
                "fund_company": "",
                "management_fee": None,
                "custody_fee": None,
                "etf_type": etf_type,
                "category_l1": cat_l1,
                "category_l2": cat_l2,
                "list_date": list_date,
                "delist_date": None,
                "is_active": is_active,
                "updated_at": datetime.now(),
            })

            # etf_index_tracking
            if track_idx_full:
                key = (code, track_idx_full)
                if key not in seen_track:
                    seen_track.add(key)
                    track_rows.append({
                        "etf_code": code,
                        "index_code": track_idx_full,
                        "index_name": track_name or TRACK_INDICES.get(track_idx_full, ""),
                        "is_primary": True,
                    })

        df = pd.DataFrame(rows)
        n = self.mgr.write_etf_product(df)
        log.info(f"  etf_product: {n} 行写入")

        # ── Step 7: 写入 etf_index_tracking ──
        if track_rows:
            df_track = pd.DataFrame(track_rows)
            n2 = self.mgr.write_etf_index_tracking(df_track)
            log.info(f"  etf_index_tracking: {n2} 行写入")
        else:
            log.info(f"  etf_index_tracking: 无映射数据")

        elapsed = time.time() - t0
        log.info(f"  完成, 耗时 {elapsed:.0f}s")

        # ── Step 8: 打印分类分布 ──
        self._print_type_distribution(df)

        return n

    def _print_type_distribution(self, df: pd.DataFrame):
        """打印 ETF 分类分布"""
        log.info("  ── ETF 类型分布 ──")
        for etf_type, grp in df.groupby("etf_type"):
            log.info(f"    {etf_type}: {len(grp)} 只")
            for cat, sub in grp.groupby("category_l1"):
                if cat != etf_type:
                    log.info(f"      {cat}: {len(sub)} 只")

    # ─── Phase 2: IOPV 每日快照 ───

    def ingest_iopv_snapshot(self) -> int:
        """
        ETF 每日快照入库

        数据源:
          - close / pre_close: 从 etf_daily_kline 最近两日 K 线取
          - total_scale: 从 get_more_info → Zsz 字段取 (亿元)
          - iopv / premium_rate / total_share: API 不返回, 填 NULL

        验证结论 (2026-05-31):
          get_more_info 对 ETF 不返回 NowPrice/PreClose/IOPV 字段
          GP11/12/13 对 ETF 返回 None
          可用字段: Zsz(总规模亿元), HqDate(日期), ZAF(涨跌幅)
        """
        log.info("=" * 50)
        log.info("ETF 每日快照入库")
        log.info("=" * 50)

        # 1. 从 K 线获取最近两日 close
        try:
            df_kline = self.mgr.execute("""
                WITH ranked AS (
                    SELECT code, date, close,
                           ROW_NUMBER() OVER (PARTITION BY code ORDER BY date DESC) as rn
                    FROM etf_daily_kline
                    WHERE date >= CURRENT_DATE - 7
                )
                SELECT
                    r1.code,
                    r1.date,
                    r1.close as close,
                    COALESCE(r2.close, r1.close) as pre_close
                FROM ranked r1
                LEFT JOIN ranked r2 ON r1.code = r2.code AND r2.rn = 2
                WHERE r1.rn = 1
            """)
        except Exception as e:
            log.warning(f"  K 线查询失败: {e}")
            return 0

        if df_kline is None or df_kline.empty:
            log.warning("  K 线无数据, 跳过")
            return 0

        kline_map = {}
        for _, row in df_kline.iterrows():
            kline_map[row["code"]] = {
                "date": row["date"],
                "close": float(row["close"]),
                "pre_close": float(row["pre_close"]),
            }
        log.info(f"  K 线价格: {len(kline_map)} 只 ETF")

        if not kline_map:
            return 0

        # 2. API 获取规模快照 (Zsz)
        if self.tq is None:
            log.warning("  TQ API 未连接, 仅写入 K 线价格数据")

        codes = sorted(kline_map.keys())
        total = len(codes)
        written = 0
        t0 = time.time()

        for i, code in enumerate(codes):
            kl = kline_map[code]
            total_scale = 0.0

            if self.tq is not None:
                info = self._safe_call(self.tq.get_more_info, stock_code=code)
                if info and isinstance(info, dict):
                    try:
                        total_scale = float(info.get("Zsz", 0) or 0)
                    except (ValueError, TypeError):
                        total_scale = 0.0

            row = {
                "code": code,
                "date": kl["date"],
                "close": kl["close"],
                "iopv": None,           # API 不返回
                "premium_rate": None,   # 依赖 IOPV
                "total_share": None,    # API 不返回
                "total_scale": total_scale if total_scale > 0 else None,
                "pre_close": kl["pre_close"],
            }

            try:
                df = pd.DataFrame([row])
                written += self.mgr.write_etf_iopv_daily(df)
            except Exception as e:
                log.debug(f"  写入失败 {code}: {e}")

            if (i + 1) % 500 == 0:
                log.info(f"  进度 {i+1}/{total} ({(i+1)/total*100:.0f}%)")
            if self.tq is not None:
                time.sleep(0.15)

        elapsed = time.time() - t0
        has_scale = sum(1 for c in codes
                        if self.tq is not None and kline_map.get(c, {}).get("_scale", 0) > 0)
        log.info(f"  etf_iopv_daily: {written} 行, 耗时 {elapsed:.0f}s")
        return written

    # ─── Phase 3: 份额规模变动 ───

    def ingest_share_scale(self) -> int:
        """
        ETF 份额规模变动入库

        从 etf_iopv_daily 提取 total_scale, 计算 scale_change
        total_share 和 share_change 暂不可用 (API 不返回份额数据)
        """
        log.info("=" * 50)
        log.info("ETF 份额规模入库")
        log.info("=" * 50)

        try:
            df_curr = self.mgr.execute("""
                SELECT code, date, total_scale
                FROM etf_iopv_daily
                WHERE total_scale IS NOT NULL AND total_scale > 0
            """)
        except Exception as e:
            log.warning(f"  查询失败: {e}")
            return 0

        if df_curr is None or df_curr.empty:
            log.info("  无可用规模数据, 跳过")
            return 0

        rows = []
        for _, row in df_curr.iterrows():
            rows.append({
                "code": row["code"],
                "date": row["date"],
                "total_share": None,      # API 不返回
                "total_scale": float(row["total_scale"]),
                "share_change": None,     # 依赖 total_share
                "scale_change": 0.0,      # 单日快照无前值, 填 0
            })

        if not rows:
            return 0

        df = pd.DataFrame(rows)
        n = self.mgr.write_etf_share_scale(df)
        log.info(f"  etf_share_scale: {n} 行")
        return n

    # ─── Phase 4: 资金流向 ───

    def ingest_capital_flow(self) -> int:
        """
        ETF 资金流向 — API 不支持

        验证结论 (2026-05-31):
          GP11/GP12/GP13 对 ETF 全部返回 None
          其他 GP 字段 (GP14/GP47/GP1) 同样返回 None
          TDX API 不提供 ETF 级别的资金流向数据
        """
        log.info("ETF 资金流向 — API 不支持 ETF, 跳过")
        return 0

    # ─── Phase 5: 持仓 (框架) ───

    def ingest_holdings(self) -> int:
        """持仓数据 — 框架预留，暂无数据源"""
        log.info("ETF 持仓数据 — 暂无数据源, 跳过")
        return 0

    # ─── Phase 6: 衍生指标 (纯 SQL 计算) ───

    def compute_derived_indicators(self, days: int = 120) -> int:
        """
        从 etf_daily_kline + index_daily_kline 计算衍生指标
        纯 SQL 计算, 无需 API 调用
        """
        log.info("=" * 50)
        log.info("ETF 衍生指标计算 (纯 SQL)")
        log.info("=" * 50)

        t0 = time.time()
        total = 0

        with self.mgr.connect(read_only=False) as conn:
            # 1. 流动性指标 (不需要指数映射, 所有 ETF 都可计算)
            log.info("  计算流动性指标 ...")
            conn.execute("DELETE FROM etf_derived_indicator")
            conn.execute(f"""
                INSERT INTO etf_derived_indicator
                    (code, date, avg_daily_amount_20d, avg_daily_volume_20d,
                     liquidity_score, bid_ask_spread)
                SELECT
                    code,
                    date,
                    avg_amount,
                    avg_volume,
                    -- 流动性评分: 基于日均成交额的对数映射到 0-100
                    CASE
                        WHEN avg_amount <= 0 THEN 0
                        WHEN avg_amount >= 1e8 THEN 100
                        ELSE LEAST(100, GREATEST(0,
                            50 + 20 * LOG10(avg_amount / 10000)
                        ))
                    END as liquidity_score,
                    0.0 as bid_ask_spread
                FROM (
                    SELECT
                        code,
                        date,
                        AVG(amount) OVER (
                            PARTITION BY code ORDER BY date
                            ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                        ) as avg_amount,
                        CAST(AVG(volume) OVER (
                            PARTITION BY code ORDER BY date
                            ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                        ) AS BIGINT) as avg_volume
                    FROM etf_daily_kline
                    WHERE date >= CURRENT_DATE - {days}
                ) sub
            """)
            liq_cnt = conn.execute(
                "SELECT COUNT(*) FROM etf_derived_indicator"
            ).fetchone()[0]
            log.info(f"  流动性指标: {liq_cnt:,} 行")
            total += liq_cnt

            # 2. 跟踪误差 + 超额收益 (需要 ETF-指数映射)
            log.info("  计算跟踪误差 + 超额收益 ...")
            try:
                # 用临时表存储 ETF-指数 日收益率对
                conn.execute("DROP TABLE IF EXISTS _etf_idx_returns")
                conn.execute(f"""
                    CREATE TEMPORARY TABLE _etf_idx_returns AS
                    SELECT
                        e.code,
                        e.date,
                        -- ETF 日收益率
                        (e.close - LAG(e.close) OVER w_e) /
                            NULLIF(LAG(e.close) OVER w_e, 0) as etf_ret,
                        -- 指数日收益率
                        (i.close - LAG(i.close) OVER w_i) /
                            NULLIF(LAG(i.close) OVER w_i, 0) as idx_ret
                    FROM etf_daily_kline e
                    JOIN etf_index_tracking t
                        ON e.code = t.etf_code AND t.is_primary = true
                    JOIN index_daily_kline i
                        ON t.index_code = i.code AND e.date = i.date
                    WHERE e.date >= CURRENT_DATE - {days}
                    WINDOW
                        w_e AS (PARTITION BY e.code ORDER BY e.date),
                        w_i AS (PARTITION BY i.code ORDER BY i.date)
                """)

                ret_cnt = conn.execute("SELECT COUNT(*) FROM _etf_idx_returns").fetchone()[0]
                log.info(f"  ETF-指数收益率对: {ret_cnt:,} 行")

                if ret_cnt > 0:
                    # 更新跟踪误差和超额收益
                    conn.execute(f"""
                        UPDATE etf_derived_indicator d
                        SET
                            tracking_error_20d = sub.te20,
                            tracking_error_60d = sub.te60,
                            excess_return_1d = sub.er1,
                            excess_return_5d = sub.er5,
                            excess_return_20d = sub.er20
                        FROM (
                            SELECT
                                code,
                                date,
                                -- 20日跟踪误差 (年化)
                                SQRT(252) * STDDEV_POP(etf_ret - idx_ret) OVER (
                                    PARTITION BY code ORDER BY date
                                    ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                                ) * 100 as te20,
                                -- 60日跟踪误差 (年化)
                                SQRT(252) * STDDEV_POP(etf_ret - idx_ret) OVER (
                                    PARTITION BY code ORDER BY date
                                    ROWS BETWEEN 59 PRECEDING AND CURRENT ROW
                                ) * 100 as te60,
                                -- 1日超额收益
                                (etf_ret - idx_ret) * 100 as er1,
                                -- 5日累计超额收益
                                SUM(etf_ret - idx_ret) OVER (
                                    PARTITION BY code ORDER BY date
                                    ROWS BETWEEN 4 PRECEDING AND CURRENT ROW
                                ) * 100 as er5,
                                -- 20日累计超额收益
                                SUM(etf_ret - idx_ret) OVER (
                                    PARTITION BY code ORDER BY date
                                    ROWS BETWEEN 19 PRECEDING AND CURRENT ROW
                                ) * 100 as er20
                            FROM _etf_idx_returns
                        ) sub
                        WHERE d.code = sub.code AND d.date = sub.date
                    """)
                    upd_cnt = conn.execute("""
                        SELECT COUNT(*) FROM etf_derived_indicator
                        WHERE tracking_error_20d IS NOT NULL
                    """).fetchone()[0]
                    log.info(f"  跟踪误差已更新: {upd_cnt:,} 行")

                conn.execute("DROP TABLE IF EXISTS _etf_idx_returns")
            except Exception as e:
                log.warning(f"  跟踪误差计算失败: {e}")
                conn.execute("DROP TABLE IF EXISTS _etf_idx_returns")

        elapsed = time.time() - t0
        log.info(f"  衍生指标完成: {total:,} 行, 耗时 {elapsed:.0f}s")
        return total

    # ─── 入口方法 ───

    def run_full_init(self):
        """首次初始化"""
        log.info("=" * 60)
        log.info("ETF 全量初始化")
        log.info("=" * 60)

        self.ingest_product_info()
        self.compute_derived_indicators(days=365)

        # 统计
        counts = self.mgr.get_table_counts()
        for t in ["etf_product", "etf_index_tracking", "etf_derived_indicator"]:
            log.info(f"  {t}: {counts.get(t, 0):,} 行")

        log.info("=" * 60)
        log.info("ETF 初始化完成")

    def run_daily(self):
        """盘后增量"""
        log.info("=" * 60)
        log.info("ETF 盘后增量")
        log.info("=" * 60)

        self.ingest_iopv_snapshot()
        self.ingest_share_scale()
        self.ingest_capital_flow()
        self.compute_derived_indicators(days=120)

        counts = self.mgr.get_table_counts()
        for t in ["etf_iopv_daily", "etf_share_scale", "etf_capital_flow",
                   "etf_derived_indicator"]:
            log.info(f"  {t}: {counts.get(t, 0):,} 行")

        log.info("=" * 60)
        log.info("ETF 盘后增量完成")

    def close(self):
        try:
            if self._tq is not None:
                self._tq.close()
        except Exception:
            pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ETF 数据入库管道")
    parser.add_argument("--init", action="store_true", help="首次初始化")
    parser.add_argument("--daily", action="store_true", help="盘后增量")
    parser.add_argument("--product", action="store_true", help="仅产品维度")
    parser.add_argument("--derived", action="store_true", help="仅衍生指标")
    parser.add_argument("--days", type=int, default=120, help="衍生指标回溯天数")
    args = parser.parse_args()

    pipe = ETFPipeline()
    try:
        if args.init:
            pipe.run_full_init()
        elif args.daily:
            pipe.run_daily()
        elif args.product:
            pipe.ingest_product_info()
        elif args.derived:
            pipe.compute_derived_indicators(days=args.days)
        else:
            parser.print_help()
    finally:
        pipe.close()
