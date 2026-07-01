"""01实盘监控 — 订阅式盘中异动监控 — 配置层

定位:盘中 09:30-15:00 每 15 秒轮询订阅池(默认 3 只),
      检测异动(涨速/涨跌幅/封板炸板/量能/超买超卖/趋势反转),推送飞书。

@meta table=intraday_monitor cn=订阅实盘监控 dir=01实盘监控 sort=001
@meta schedule=realtime mode=monitor source=tqcenter+snapshot
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from pathlib import Path


# ============ 涨停幅度规则(按 code 前缀, A 股固定规则, 不查 DB) ============
LIMIT_UP_PCT: dict[str, float] = {
    "688": 20.0,   # 科创板
    "300": 20.0,   # 创业板
    "920": 30.0, "830": 30.0, "430": 30.0, "870": 30.0,  # 北交所
}
LIMIT_UP_DEFAULT = 10.0  # 沪深主板
LIMIT_UP_ST = 5.0        # ST 股(name 含 ST/*ST)


def limit_up_pct(code: str, name: str = "") -> float:
    """根据 code 前缀 + name 判涨停幅度"""
    if name and ("ST" in name.upper()):
        return LIMIT_UP_ST
    return LIMIT_UP_PCT.get(code[:3], LIMIT_UP_DEFAULT)


# ============ 异动阈值 ============
@dataclass(frozen=True)
class THRESHOLDS:
    # 涨速异动(5 分钟涨跌幅)
    surge_5min_pct: float = 2.0          # |Now/Before5MinNow - 1|*100 ≥ 此值 → 涨速异动

    # 涨跌幅关键位(穿越即触发,%)
    pct_levels_up: tuple = (3.0, 5.0, 7.0)
    pct_levels_down: tuple = (-3.0, -5.0, -7.0)
    pct_cross_band: float = 0.05         # 穿越判定带宽(避免在关键位附近抖动反复触发, %)

    # 涨停封板/炸板
    limit_touch_band: float = 0.1        # Now 相对涨停价偏差 ≤ 此值(%) 视为在涨停价
    limit_seal_sellv_max: float = 100.0  # 卖一量 ≤ 此值(手) 视为封单吃光卖盘 → 封板

    # 量能放大(现手相对窗口均量)
    vol_window: int = 20                 # 滑动窗口(采样点, 20 个@15s = 5 分钟)
    vol_surge_ratio: float = 5.0         # 现手 > 窗口均量 × 此值 → 量能放大
    vol_min_nowvol: float = 50.0         # 现手低于此值不判量能(过滤零碎单, 手)

    # 超买超卖(日内位置 + 量价启发式)
    overbought_pos: float = 0.85         # 日内位置 (Now-Min)/(Max-Min) > 此值
    oversold_pos: float = 0.15           # 日内位置 < 此值
    obos_min5_abs: float = 0.3           # 涨速绝对值 ≥ 此值(%) 才判超买超卖(过滤平淡行情)

    # 趋势反转(滑动窗口短长均线交叉)
    reversal_window: int = 16            # 回看窗口(采样点)
    reversal_ma_short: int = 3           # 短均线
    reversal_ma_long: int = 12           # 长均线
    reversal_min_swing: float = 1.0      # 反转前窗口内累计涨跌幅绝对值 ≥ 此值(%) 才算有势可反

    # 主力资金异动(ZLJE 差额, 万元; 仅交易时段有效, 盘后差额=0)
    capital_inflow_wan: float = 2000.0   # 3 分钟主力净流入 ≥ 此值 → 主力流入异动
    capital_outflow_wan: float = 2000.0  # 3 分钟主力净流出 ≥ 此值 → 主力流出异动
    capital_min_abs: float = 500.0       # 差额绝对值 < 此值不报(过滤噪声)

    # 扩展点:标准 RSI/KDJ(v1 不启用, 留开关)
    use_rsi: bool = False


# ============ 盘中时段 & 轮询 ============
@dataclass(frozen=True)
class SCHEDULE:
    morning_start: time = time(9, 30)
    morning_end: time = time(11, 30)
    afternoon_start: time = time(13, 0)
    afternoon_end: time = time(15, 0)
    poll_interval: int = 15              # 秒(每轮轮询间隔)


# ============ 路径 & 运行时 ============
def _load_webhook() -> str | None:
    """从 feishu_webhook.txt 读 webhook(该文件被 .gitignore 排除, 防泄露)"""
    p = Path(__file__).resolve().parent / "feishu_webhook.txt"
    if p.exists():
        s = p.read_text(encoding="utf-8").strip()
        return s or None
    return None


@dataclass(frozen=True)
class CONFIG:
    base_dir: Path = Path(__file__).resolve().parent
    pool_path: Path = Path(__file__).resolve().parent / "pool.txt"
    output_dir: Path = Path(__file__).resolve().parent / "output"   # 异动事件 parquet
    report_dir: Path = Path(__file__).resolve().parent / "reports"  # 日报 MD

    # tqcenter
    tq_sys_path: str = r"K:\txdlianghua\PYPlugins\sys"

    thresholds: THRESHOLDS = THRESHOLDS()
    schedule: SCHEDULE = SCHEDULE()

    # 飞书推送(模块加载时从 feishu_webhook.txt 读; 空则只本地输出)
    feishu_webhook: str | None = _load_webhook()

    # 飞书频控:同股同类型 N 秒内不重复推(critical 类型豁免)
    dedup_window: int = 180             # 3 分钟

    # 主力资金(ZLJE 差额)轮询间隔(秒); 与价格 15s 轮询解耦, formula 慢故用长间隔
    capital_interval: int = 180         # 3 分钟


# ============ 异动事件标签(输出用) ============
@dataclass(frozen=True)
class Label:
    key: str
    cn: str
    color: str       # rich 颜色
    emoji: str       # 飞书 emoji
    severity: str    # info / warn / critical
    dedup: bool      # True=受去重, False=豁免(封板/炸板)


LABELS: dict[str, Label] = {
    "surge_up":      Label("surge_up",      "涨速冲高",   "red",     "🔥", "warn",     True),
    "surge_down":    Label("surge_down",    "涨速下挫",   "green",   "💧", "warn",     True),
    "pct_level":     Label("pct_level",     "涨跌幅触及", "yellow",  "📌", "warn",     True),
    "limit_seal":    Label("limit_seal",    "涨停封板",   "red",     "🔴", "warn",     False),
    "limit_break":   Label("limit_break",   "炸板",       "red",     "💥", "critical", False),
    "volume_surge":  Label("volume_surge",  "量能放大",   "cyan",    "📈", "info",     True),
    "overbought":    Label("overbought",    "超买",       "yellow",  "⚠",  "warn",     True),
    "oversold":      Label("oversold",      "超卖",       "yellow",  "⚠",  "warn",     True),
    "reversal_up":   Label("reversal_up",   "趋势反转↑",  "magenta", "🔄", "warn",     True),
    "reversal_down": Label("reversal_down", "趋势反转↓",  "magenta", "🔄", "warn",     True),
    "capital_in":    Label("capital_in",    "主力流入",   "red",     "💰", "warn",     True),
    "capital_out":   Label("capital_out",   "主力流出",   "green",   "💸", "warn",     True),
}


def label_cn(key: str) -> str:
    """事件 key → 中文名"""
    if not key:
        return ""
    lab = LABELS.get(key)
    return lab.cn if lab else key
