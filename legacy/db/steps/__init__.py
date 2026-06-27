"""
db.steps — 采集步骤包

集中管理所有采集步骤，提供统一的生命周期（setup → execute → teardown）
和进度监控支持。

用法：
  from db.steps import BaseStep, StepContext
  from db.steps.kline_steps import StockMinuteKline1mStep

  step = StockMinuteKline1mStep(manager=db, context=ctx, task_config=task)
  count = step.run()
"""
from .base import BaseStep, StepContext
from .kline_steps import (
    _KlineStepMixin,
    _StockMinuteKlineStep,
    StockMinuteKline1mStep,
    StockMinuteKline5mStep,
    IndexKlineStep,
    SectorKlineStep,
)

__all__ = [
    # 基类
    "BaseStep",
    "StepContext",
    # K线步骤
    "_KlineStepMixin",
    "_StockMinuteKlineStep",
    "StockMinuteKline1mStep",
    "StockMinuteKline5mStep",
    "IndexKlineStep",
    "SectorKlineStep",
]