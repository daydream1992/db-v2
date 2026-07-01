"""01实盘监控 — 资金层(主力净额 ZLJE 差额)

数据源: 自建 ZLJE 技术指标公式(tq.formula_process_mul_zb), 基于 K 线 L2_AMO。
       盘中实时变化, 盘后冻结(差额=0, 仅交易时段有意义)。优于 get_more_info 的 Zjl(盘后归零)。

核心函数复制自 tes/tes_011_zlje.py(探针库, 不直接 import, 按治理复制核心逻辑)。
前置: ZLJE 公式须在通达信手动建好(见 tes/ZLJE公式安装说明.md), 实测已可用。

用法: fetch_zlje_values(codes) → {code: 主力净额万元}
      盘中每 capital_interval 秒调一次, 与上次的差额 → engine.detect_capital_flow。
"""
from __future__ import annotations

import sys
from datetime import datetime, timedelta

from loguru import logger

from config import CONFIG

TQ_SYS_PATH = CONFIG.tq_sys_path
if TQ_SYS_PATH not in sys.path:
    sys.path.insert(0, TQ_SYS_PATH)
try:
    from tqcenter import tq  # type: ignore
except Exception as e:  # noqa: BLE001
    tq = None  # type: ignore
    logger.warning(f"tqcenter 加载失败: {e}")


def last_valid_value(entry) -> float | None:
    """从 res[code]['主力净额'] 取最近一个非 None 的 Value; entry 可能 None/list"""
    if not isinstance(entry, list):
        return None
    for it in reversed(entry):
        v = it.get("Value")
        if v is not None:
            try:
                return float(v)
            except (TypeError, ValueError):
                return None
    return None


def fetch_zlje_values(codes: list[str], refresh: bool = False) -> dict[str, float]:
    """调 ZLJE 公式取每只票最新主力净额(万元)。返回 {code: 万元}。

    refresh=True 会 refresh_cache(全市场, 慢), 盘中实时数据无需刷新, 默认 False。
    L2 远期数据通达信只存近 1-2 月, 区间固定取最近 30 天。
    """
    if tq is None:
        raise RuntimeError("tqcenter 未加载(实盘需 K:\\txdlianghua\\PYPlugins\\sys\\tqcenter.py)")
    tq.initialize(__file__)
    try:
        if refresh:
            try:
                tq.refresh_cache(market="AG", force=True)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"refresh_cache 失败(忽略): {e}")
        end = datetime.now().strftime("%Y%m%d")
        start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
        res = tq.formula_process_mul_zb(
            formula_name="ZLJE", formula_arg="", xsflag=6,
            return_count=2, return_date=True,
            stock_list=codes, stock_period="1d", count=-1,
            start_time=start, end_time=end, dividend_type=1,
        )
    finally:
        try:
            tq.close()
        except Exception:  # noqa: BLE001
            pass

    out: dict[str, float] = {}
    if isinstance(res, dict):
        for code in codes:
            entry = res.get(code, {}).get("主力净额")
            v = last_valid_value(entry)
            if v is not None:
                out[code] = v
    logger.debug(f"ZLJE 取到 {len(out)}/{len(codes)}")
    return out
