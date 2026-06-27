"""
db — 数据库核心模块

子模块：
  - manager:       DuckDB连接管理器（热数据+冷数据混合架构）
  - queries:       数据查询层（封装常用查询）
  - data_validator: 数据入库校验器（6层校验）
  - progress_db:   进度数据库（SQLite，独立于主库）
  - steps/:        数据采集步骤定义
"""

from db.manager import DuckDBManager, get_manager

__all__ = ["DuckDBManager", "get_manager"]
