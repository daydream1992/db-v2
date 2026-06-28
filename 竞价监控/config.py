"""竞价监控雷达 — 配置层

冻结 dataclass 集中存放阈值/采样时刻/路径。
所有可调参数在此改,避免散落在业务代码里。

@meta table=auction_monitor cn=竞价监控雷达 dir=竞价监控 sort=005
@meta schedule=realtime mode=monitor source=tqcenter+snapshot
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import time
from pathlib import Path


@dataclass(frozen=True)
class THRESHOLDS:
    """评分阈值（双模式共用）"""

    # 赛道分流（按 s3 相对昨收涨幅）
    trend_pct: float = 1.0          # pct > 1%  → 趋势追高
    dip_pct: float = -1.0           # pct < -1%  → 反核低吸

    # 数据熔断
    last_close_floor: float = 0.01  # 昨收 <= 此值视为异常（新股/停牌/分母为零）
    trap_floor: float = 0.95        # trap_ratio < 0.95 视为诱多(trend 扣分)
    trap_ceiling: float = 1.05      # trap_ratio > 1.05 视为低吸成功(dip 加分)

    # 满分基准（线性映射到 0..1，再乘权重）
    full_amt: float = 50_000_000.0  # 5千万 = 金额满分线
    full_vol_lots: int = 10_000     # 1万手 = 成交量满分线（Volume 字段单位:手）

    # 弱信号分（pct 在 ±1% 之间）
    weak_score: int = 40


@dataclass(frozen=True)
class SAMPLING:
    """三时刻采样时刻

    09:15:00  s1  集合竞价开盘（接受订单,可能有指示价）
    09:20:05  s2  撮合阶段早盘指示（9:20-9:25 是撮合期）
    09:25:05  s3  撮合完成后 5 秒（Open 已确定,数据稳定）
    """

    s1: time = time(9, 15, 0)
    s2: time = time(9, 20, 5)
    s3: time = time(9, 25, 5)

    def all(self) -> tuple[time, time, time]:
        return (self.s1, self.s2, self.s3)


@dataclass(frozen=True)
class CONFIG:
    """运行时配置"""

    # 路径
    base_dir: Path = Path(__file__).resolve().parent
    pool_path: Path = Path(__file__).resolve().parent / "pool.txt"
    output_dir: Path = Path(__file__).resolve().parent / "output"
    report_dir: Path = Path(__file__).resolve().parents[1] / "reports"  # 项目级 reports/

    # tqcenter 路径（user 版本与 sys 版本都存在，sys 有错误处理补丁）
    tq_sys_path: str = r"K:\txdlianghua\PYPlugins\sys"

    # 评分阈值
    thresholds: THRESHOLDS = THRESHOLDS()

    # 采样时刻
    sampling: SAMPLING = SAMPLING()

    # 输出
    top_n: int = 20
    parquet_per_day: bool = True  # True: 每天一个文件;False: 单文件追加

    # 重试
    snapshot_retry: int = 3
    snapshot_timeout_s: float = 2.0
    retry_backoff_s: float = 0.2

    # 飞书推送 webhook（None 表示禁用）
    feishu_webhook: str | None = None
