# DB数据库_v2 优化建议书

## 一、交易日历集成（用户指定，最高优先级）

### 问题
- 24 个入库/计算脚本中，仅 2 个使用了 trading_calendar
- 12 个 daily/weekly 脚本用 datetime.now() 判断新鲜度，周末/假日误报"滞后"
- 维护日志显示 GP 指标"落后1天"，实际可能只是非交易日

### 建议
1. **创建交易日历工具函数** `4_工具/trading_calendar_helper.py`
   - `is_trading_day(date)` — 判断是否交易日
   - `get_last_trading_day()` — 最近交易日
   - `get_trading_window(n)` — 最近N个交易日
   - `get_missing_trading_days(table, date_col)` — 缺失交易日
   
2. **逐步改造 12 个无日历脚本**，按优先级：
   - 高：10_stock_daily_kline, 137_capital_info, 19_stock_daily_turnover, 70_pianpao_daily
   - 中：33_sector_stocks, 34_t_bk5_19, 92_market_sc1_42, 262_stock_block_relation
   - 低：95_stock_signals, 104_stock_financial_data, 35_stock_industry_3level

3. **run.py 改造**
   - `cmd_all()` 开头自动先跑 91_trading_calendar
   - `_freshness()` 用日历代替简单的日期比较
   - 增加 `run.py calendar` 子命令：显示当前/最近/下一交易日

4. **ingest_plan.py 增强**
   - 已有先跑日历的逻辑，增加：非交易日跳过入库（可选 --force 强制）

### 交易日历脚本改造模板

```python
# 在脚本 run() 中替换 datetime.now() 判断
def run(force=False):
    con = duckdb.connect(DB_PATH)
    try:
        # 获取最近交易日（而非今天）
        last_td = con.execute(
            "SELECT MAX(date) FROM trading_calendar WHERE is_trading=1 AND date <= CURRENT_DATE"
        ).fetchone()[0]
        
        if not force and MODE == 'increment':
            max_date = con.execute(f"SELECT MAX(date) FROM {TABLE}").fetchone()[0]
            if max_date and str(max_date) >= str(last_td):
                logger.info(f"○ {TABLE} 已是最新(截至交易日{last_td})，跳过")
                return True
        ...
```

## 二、market_snapshot 空表修复

### 问题
- market_snapshot 0 行数据，标记为"空表"
- schedule=intraday，但实际未运行

### 建议
1. 检查 105_market_snapshot.py 的 API 连接是否正常
2. 确认数据源（盘中快照 API）是否在当前环境可用
3. 如果 API 不可用，考虑：
   - 将 schedule 改为 once + 手动触发
   - 或从 stock_daily_kline + capital_info 聚合生成静态快照
   - 或在 DataOps UI 中标记为"待配置"状态

## 三、GP 指标延迟问题

### 问题
- stock_gp1_46_indicators: 2026-06-25，落后1天
- stock_daily_turnover: 2026-06-25，依赖 GP 指标

### 建议
1. **93 脚本已使用交易日历窗口**（COVER_DAYS=5），问题可能是执行时序
2. 调整执行顺序：先 91 日历 → 93 GP → 19 换手率
3. 配置盘后自动执行（cron/Task Scheduler）：
   ```
   15:30 python 1_入库/91_trading_calendar.py
   15:35 python 1_入库/93_stock_gp1_46_indicators.py
   15:50 python 2_计算/19_stock_daily_turnover.py
   ```

## 四、stock_signals 历史数据

### 问题
- stock_signals_20001_20011: 最后更新 2024-08-16，近2年未更新

### 建议
1. 确认信号策略是否仍需运行
2. 如果停用，将 schedule 改为 once 或 status=deprecated
3. 如果继续使用，检查 95 脚本的 API/数据源

## 五、DataOps UI 增强

### 已完成
- ✅ 交易日历感知的新鲜度判断（本次实施）
- ✅ 非交易日提示信息
- ✅ 交易日/休市徽章
- ✅ 健康度评分日历感知（非交易日降低滞后权重）
- ✅ 编排页执行按钮日历检查 + 非交易日警告
- ✅ 执行历史交易日标记（T/休徽章）

### 建议
1. **调度集成**：UI 一键触发 run.py，实时显示执行日志
2. **WebSocket 实时推送**：run.py 执行时通过 WS 推送进度到 UI
3. **配置管理**：UI 可编辑 tables.json（schedule/mode/depends_on）
4. **补数向导**：选择日期范围 → 自动生成 run.py fix 命令
5. **数据预览**：SQL Playground 结果直接可视化（折线图/柱状图）

## 六、系统可靠性

### 建议
1. **备份策略**：run.py backup 已实现，建议配置每日自动备份
2. **日志轮转**：logs/ 目录按日期切割，保留30天
3. **健康巡检**：DataOps UI 的 15 分钟 cron job 持续监控
4. **GitHub 同步**：代码改动自动推送，数据字典自动更新
