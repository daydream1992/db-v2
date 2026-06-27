"""
采集步骤基类 — 所有采集步骤的抽象基类

职责：
  1. 统一生命周期（setup → execute → teardown）
  2. 从 CollectorTask 读取配置参数
  3. 向 PipelineProgressMonitor 报告进度
  4. 支持取消信号

用法：
  class MyStep(BaseStep):
      name = "my_task"          # 必须在子类定义
      depends_on: List[str] = [] # 可选

      def _execute(self) -> int:
          ...                   # 返回入库条数
          return count

  step = MyStep(manager=db, task_config=task)
  count = step.run()
"""

import time
import logging
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from dataclasses import dataclass, field
from datetime import datetime, timedelta

import pandas as pd

from db.manager import DuckDBManager
from progress_monitor import get_monitor

logger = logging.getLogger(__name__)


@dataclass
class StepContext:
    """步骤执行上下文（跨步骤传递数据）"""
    # 股票代码列表（由前置步骤填充）
    stock_codes: List[str] = field(default_factory=list)
    # 板块代码列表
    sector_codes: List[str] = field(default_factory=list)
    # 交易日列表
    trading_dates: List[Any] = field(default_factory=list)
    # 任意扩展数据
    extra: Dict[str, Any] = field(default_factory=dict)


class BaseStep(ABC):
    """采集步骤基类"""

    # ── 子类必须定义 ──────────────────────────────────────
    name: str = ""

    # ── 标准属性（有默认值）───────────────────────────────
    table_name: str = ""          # 入库目标表名
    depends_on: List[str] = []    # 依赖的前置步骤名
    batch_size: int = 50          # 批次大小
    max_workers: int = 10         # 最大并发线程数
    data_range_days: int = 365    # 数据范围（天）
    incremental: bool = True      # 是否增量采集
    timeout: int = 300            # 超时时间（秒）

    def __init__(self, manager: DuckDBManager, context: Optional[StepContext] = None,
                 task_config: Optional[Any] = None):
        """
        参数：
          manager: DuckDBManager 实例
          context: StepContext 共享上下文
          task_config: CollectorTask 配置对象（用于读取 batch_size 等参数）
        """
        self.mgr = manager
        self.context = context or StepContext()
        self._cancelled = False
        self._cancel_lock = time.sleep.__self__ if hasattr(time.sleep, '__self__') else None
        self._monitor = get_monitor()

        # 从 task_config 覆盖默认属性
        if task_config:
            self.batch_size = getattr(task_config, "batch_size", self.batch_size)
            self.max_workers = getattr(task_config, "max_workers", self.max_workers)
            self.data_range_days = getattr(task_config, "data_range_days", self.data_range_days)
            self.incremental = getattr(task_config, "incremental", self.incremental)
            self.timeout = getattr(task_config, "timeout", self.timeout)

    # ── 公共 API ────────────────────────────────────────
    def run(self) -> int:
        """执行步骤主流程：setup → execute → teardown"""
        if not self.name:
            raise ValueError("Step.name 未定义")

        logger.info("▶ Step [%s] 开始", self.name)
        self._monitor.start_task(self.name, total_count=self._total_for_monitor())

        try:
            self._setup()
            count = self._execute()
            self._teardown()
            # _execute 可能返回 dict（多频次步骤）或 int
            monitor_count = sum(count.values()) if isinstance(count, dict) else count
            self._monitor.update_progress(self.name, monitor_count)
            if isinstance(count, dict):
                detail = ", ".join(f"{k}={v}" for k, v in count.items())
                logger.info("✔ Step [%s] 完成: %s", self.name, detail)
            else:
                logger.info("✔ Step [%s] 完成: %d 条", self.name, count)
            return count
        except Exception as e:
            self._monitor.fail_task(self.name, str(e))
            logger.error("✘ Step [%s] 失败: %s", self.name, e)
            raise

    def cancel(self):
        """接收取消信号"""
        self._cancelled = True

    @property
    def is_cancelled(self) -> bool:
        return self._cancelled

    # ── 子类可覆盖 ───────────────────────────────────────
    def _setup(self):
        """初始化（如加载股票列表等）"""
        pass

    def _teardown(self):
        """清理（如关闭连接等）"""
        pass

    @abstractmethod
    def _execute(self) -> int:
        """执行采集逻辑，子类必须实现。返回入库条数。"""
        ...

    # ── 工具方法 ────────────────────────────────────────
    def _total_for_monitor(self) -> int:
        """计算总数量用于进度监控"""
        if self.table_name:
            counts = self.mgr.get_table_counts()
            return counts.get(self.table_name, 0)
        return 1

    def _safe_call(self, func, *args, **kwargs):
        """安全调用 TDX API，超时或异常返回 None"""
        try:
            if self._cancelled:
                return None
            result = func(*args, **kwargs)
            return result
        except Exception as e:
            logger.warning("API 调用失败 %s: %s",
                           getattr(func, '__name__', str(func)), e)
            return None

    def _date_range(self, days: Optional[int] = None) -> tuple:
        """返回 (start_dt, end_dt)，格式 YYYYMMDD"""
        d = days if days is not None else self.data_range_days
        end = datetime.now()
        start = end - timedelta(days=d)
        return start.strftime("%Y%m%d"), end.strftime("%Y%m%d")

    def _fetch_stock_codes(self) -> List[str]:
        """获取全量股票代码列表"""
        if self.context.stock_codes:
            return self.context.stock_codes
        df = self.mgr.query("stock_basic_info")
        if df is not None and not df.empty:
            codes = df["code"].tolist()
            self.context.stock_codes = codes
            return codes
        return []

    def _fetch_sector_codes(self) -> List[str]:
        """获取全量板块代码列表"""
        if self.context.sector_codes:
            return self.context.sector_codes
        df = self.mgr.query("sector_list")
        if df is not None and not df.empty:
            codes = df["sector_code"].tolist()
            self.context.sector_codes = codes
            return codes
        return []

    def _batch_iter(self, items: List, batch_size: Optional[int] = None):
        """分批迭代器，每批之间检查取消信号"""
        bs = batch_size or self.batch_size
        for i in range(0, len(items), bs):
            if self._cancelled:
                break
            yield items[i:i + bs]

    def _throttle(self, seconds: float = 1.0):
        """节流（每批次后调用）"""
        time.sleep(seconds)