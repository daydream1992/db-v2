"""竞价监控雷达 v2 — 开盘决策辅助 — 配置层

定位:9:25 集合竞价撮合后,用开盘价 + DB 历史多维数据,
      给每只票打"追/避/观察/警示"标签,辅助 9:30 开盘决策。

@meta table=auction_monitor cn=竞价监控雷达 dir=竞价监控 sort=005
@meta schedule=realtime mode=monitor source=tqcenter+snapshot+db
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import time
from pathlib import Path


# ============ 涨停幅度规则(按 code 前缀,A 股固定规则,不查 DB) ============
# 前缀 → 涨停幅度(%),default=主板 10%
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
    prefix3 = code[:3]
    return LIMIT_UP_PCT.get(prefix3, LIMIT_UP_DEFAULT)


# ============ 阈值(开盘决策) ============
@dataclass(frozen=True)
class THRESHOLDS:
    # 开盘强度划分
    open_up_pct: float = 1.0          # 高开 > 1%
    open_down_pct: float = -1.0       # 低开 < -1%
    dip_buy_low: float = -3.0         # 低吸区间下限
    dip_buy_high: float = -1.0        # 低吸区间上限(-1% ~ -3% 顺势小低开)

    # 资金面(相对流通市值,避免绝对值误判)
    fund_diverge_ratio: float = -0.005  # Zjl/流通市值 < -0.5% → 资金背离
    fund_inflow_ratio: float = 0.001    # Zjl/流通市值 > 0.1% → 主力流入(强势延续条件)

    # 流动性
    float_mcap_warn: float = 30e8     # 流通市值 < 30亿 → 流动性警示(单位:元)

    # 9:31 修正
    confirm_drop_pct: float = -3.0    # 现价相对开盘价跌 > 3% → 🟢 降级 🟠

    # pianpao 惯骗判定
    pianpao_recent_days: int = 60     # 近 N 天内骗炮视为惯骗(一票否决)
    pianpao_min_count: int = 1        # 历史骗炮次数 ≥ 此值即标记


# ============ 推送时点(两阶段) ============
@dataclass(frozen=True)
class SCHEDULE:
    initial_wait: time = time(9, 25, 5)   # 第一次:9:25:05 启动取数
    confirm_wait: time = time(9, 31, 0)   # 第二次:9:31:00 二次确认


# ============ 竞价趋势采样(9:15-9:25 每2分钟) ============
@dataclass(frozen=True)
class TREND:
    sample_times: tuple = (
        time(9, 15), time(9, 17), time(9, 19),
        time(9, 21), time(9, 23), time(9, 25),
    )
    # 强势判定(线性拟合)
    slope_min: float = 0.05       # 斜率下限(%/min),正且大于此才算强势
    r2_stable: float = 0.7        # R²≥此 = 稳定上升
    r2_volatile: float = 0.4      # R²<此 = 波动
    # 高风险剔除(不输出)
    exclude_pianpao_cnt: int = 3  # 近60天骗炮≥此值剔除
    exclude_fund_diverge: float = -0.005  # 主力净额/市值<此剔除
    exclude_float_mcap: float = 20e8      # 流通市值<20亿剔除(易操纵)


# ============ 路径 & 运行时 ============
def _load_webhook() -> str | None:
    """从 feishu_webhook.txt 读 webhook(该文件被 .gitignore 排除,防泄露)"""
    p = Path(__file__).resolve().parent / "feishu_webhook.txt"
    if p.exists():
        s = p.read_text(encoding="utf-8").strip()
        return s or None
    return None


@dataclass(frozen=True)
class CONFIG:
    base_dir: Path = Path(__file__).resolve().parent
    pool_path: Path = Path(__file__).resolve().parent / "pool.txt"
    output_dir: Path = Path(__file__).resolve().parent / "output"
    report_dir: Path = Path(__file__).resolve().parent / "reports"  # 本地表格输出文件夹(MD+xlsx)

    # DB
    db_path: Path = Path(r"K:\DB数据库_v2\db\profit_radar.duckdb")

    # tqcenter
    tq_sys_path: str = r"K:\txdlianghua\PYPlugins\sys"

    thresholds: THRESHOLDS = THRESHOLDS()
    schedule: SCHEDULE = SCHEDULE()
    trend: TREND = TREND()

    top_n: int = 30

    # 飞书推送(耦合:模块加载时从 feishu_webhook.txt 读;空则只本地输出)
    feishu_webhook: str | None = _load_webhook()

    # 动态池:昨日涨停 + 自选
    pool_include_yesterday_limit_up: bool = True
    yesterday_limit_up_min: int = 0   # 昨日涨停股最少纳入数(0=全部)


# ============ 信号标签(输出用) ============
@dataclass(frozen=True)
class Label:
    key: str
    cn: str
    color: str  # rich 颜色 / 飞书 emoji


LABELS: dict[str, Label] = {
    "strong_continue": Label("strong_continue", "强势延续", "green"),
    "trap_warning":    Label("trap_warning",    "高开陷阱警示", "red"),
    "fund_diverge":    Label("fund_diverge",    "资金背离", "yellow"),
    "nuclear":         Label("nuclear",         "核按钮/情绪转弱", "yellow"),
    "dip_buy":         Label("dip_buy",         "低吸观察", "blue"),
    "liquidity":       Label("liquidity",       "流动性警示", "white"),
    "downgraded":      Label("downgraded",      "9:30跌破·降级", "yellow"),
}
