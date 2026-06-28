# 数据库维护日志 - 2026年6月28日

## 时间线

### 14:00 - 数据扫描与健康检查
执行 `python run.py scan` 获取全库表状态

**扫描结果统计**：
- 总表数：23张
- 健康状态：22张OK / 1张空表
- 总数据量：约7.5亿行

### 14:01 - 关键表最新日期检查
执行 `python run.py check` 验证核心数据新鲜度

**数据新鲜度**：
- 交易日历：2026-06-26 ✅ 最新
- 日K线：2026-06-26 ✅ 最新  
- GP指标：2026-06-25 ⚠️ 落后1天
- 换手率：2026-06-25 ⚠️ 落后1天
- 股本数据：2026-06-26 ✅ 最新

### 13:29 - DataOps UI v8 更新拉取
从 GitHub 拉取最新UI版本

**验收结果**：
- Commit: 3d8e8da
- 文件变更：11个文件，+2548 -731行
- 功能增强：视觉重设计 + 交互增强
- 状态：✅ 完全同步

## 数据库健康状态详情

### 🟢 正常运行的表 (22张)

| 表名 | 行数 | 最新日期 | 状态 |
|------|------|----------|------|
| stock_daily_kline | 28,931,000+ | 2026-06-26 | OK |
| stock_kline_1m | 291,630,000+ | 2026-06-26 | OK |
| stock_kline_5m | 201,790,000+ | 2026-06-26 | OK |
| stock_kline_15m | 67,265,000+ | 2026-06-26 | OK |
| stock_kline_30m | 33,633,000+ | 2026-06-26 | OK |
| stock_kline_60m | 16,817,000+ | 2026-06-26 | OK |
| stock_kline_weekly | 6,135,000+ | 2026-06-26 | OK |
| stock_kline_monthly | 1,461,000+ | 2026-06-26 | OK |
| stock_gp1_46_indicators | 118,722,855 | 2026-06-25 | OK |
| stock_daily_turnover | 1,336,955 | 2026-06-25 | OK |
| capital_info | 2,176,571 | 2026-06-26 | OK |
| trading_calendar | 6,415 | 2026-06-26 | OK |
| t_bk5_19 | 2,171,000+ | 2026-06-26 | OK |
| sector_stocks | 91,564 | - | OK |
| stock_industry_3level | 5,534 | - | OK |
| market_sc1_42 | 5,644 | 2026-06-25 | OK |
| stock_signals_20001_20011 | 7,091,000+ | 2024-08-16 | OK |
| sjb_api_plhqL2kz_88zd | 66,951 | - | OK |
| stock_financial_data | 5,522 | - | OK |
| stock_block_relation | 440,671 | - | OK |
| dim_security_type | 12,091 | - | OK |
| dim_industry_code | 466 | - | OK |
| pianpao_daily | 134,026 | 2026-06-25 | OK |

### 🔴 需要关注的表 (1张)

| 表名 | 行数 | 最新日期 | 状态 |
|------|------|----------|------|
| market_snapshot | 0 | - | 空表 |

## 待处理事项

### 🔴 高优先级
1. **market_snapshot 空表** - 需要重新入库快照数据

### 🟡 中优先级  
1. **GP指标落后1天** - 建议盘后自动运行93脚本
2. **换手率落后1天** - 依赖于GP指标，同步更新

### 🟢 低优先级
1. **stock_signals_20001_20011** - 历史信号表，2024-08-16后未更新

## DataOps UI v8 功能验收

### ✅ 视觉重设计
- Dashboard: 渐变背景、KPI卡片动画、趋势箭头
- Health: 环形健康评分SVG动画、7日趋势网格线
- Lineage: 3种布局模式(层次/力导向/环形)
- 全局: Badge徽章、搜索高亮、状态pill

### ✅ 交互增强  
- 可折叠面板、hover效果
- 自动适配视图、自动滚动到顶部
- loading指示器、进度动画

### ✅ 文件更新清单
1. catalog-view.tsx - 快速筛选pill、搜索高亮
2. dashboard-view.tsx - KPI卡片增强、告警卡片化
3. health-view.tsx - 环形评分、趋势网格线
4. lineage-view.tsx - 3种布局模式、搜索面板
5. lint-view.tsx - 严重度徽章、违规展开
6. dictionary-view.tsx - 字段类型环形图
7. logs-view.tsx - 日志级别彩色边框、行号
8. orchestration-view.tsx - Gantt时间线、状态pill
9. settings-view.tsx - 版本信息、快捷键表
10. sql-playground-view.tsx - 边框增强、清空按钮
11. page.tsx - 视图切换优化

## 系统配置

### 定时任务状态
- 骗炮进度监控：已清除 ✅
- GP指标自动更新：需配置 ⚠️

### 数据库连接
- 路径：K:\DB数据库_v2\db\profit_radar.duckdb
- 状态：正常读写 ✅

### Git仓库
- 远程：https://github.com/daydream1992/db-v2
- 同步状态：完全一致 ✅
- 最新Commit：3d8e8da (DataOps UI v8)

## 下次维护计划

### 每日任务
- [ ] 盘后运行93脚本(GP指标)
- [ ] 盘后运行19脚本(换手率)
- [ ] 检查数据新鲜度

### 每周任务  
- [ ] 周末全量健康检查
- [ ] 清理过期日志文件

### 每月任务
- [ ] 数据库备份验证
- [ ] 性能优化评估
- [ ] 文档更新

---
**维护人员**: Claude Code Agent  
**记录时间**: 2026-06-28 14:01  
**下次检查**: 2026-06-29 19:00 (盘后)
