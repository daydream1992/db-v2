# K线数据入库方法论

## 一、发现问题

```bash
# 查所有K线表最新日期
duckdb "K:/DB数据库_v2/db/profit_radar.duckdb" -c "
SELECT
  'stock_kline_1m' as tbl, MAX(date) as latest FROM stock_kline_1m
UNION ALL SELECT 'stock_kline_5m', MAX(trade_time) FROM stock_kline_5m
UNION ALL SELECT 'stock_kline_15m', MAX(trade_time) FROM stock_kline_15m
UNION ALL SELECT 'stock_kline_30m', MAX(trade_time) FROM stock_kline_30m
UNION ALL SELECT 'stock_kline_60m', MAX(trade_time) FROM stock_kline_60m
"
```

## 二、校验trading_calendar

```bash
# 查需要补充的交易日
duckdb "K:/DB数据库_v2/db/profit_radar.duckdb" -c "
SELECT date FROM trading_calendar
WHERE date > '2026-05-29' AND is_trading=true
ORDER BY date"
```

## 三、场景判断

| 场景 | 特征 | 方案 |
|------|------|------|
| 盘后补全 | 今天已收盘 | 全量跑L1→L2→L3 |
| 追数 | 补充历史N天 | 增量跑对应脚本 |
| 补数 | 漏了某天 | 指定日期跑 |
| 增量更新 | 日常每天 | 自动增量跑 |
| 全量重跑 | 数据异常 | force=True |

## 四、数据依赖链

```
TDX文件
  → stock_kline_1m (L1)
  → stock_kline_5m (L1)
      → stock_kline_15m (L2)
      → stock_kline_30m (L2)
      → stock_kline_60m (L2)
          → stock_daily_kline
              → stock_kline_weekly (L3)
              → stock_kline_monthly (L3)
```

## 五、执行顺序（优先级）

| 层级 | 数据流 | 脚本 |
|------|--------|------|
| L1 | TDX→1m/5m | 1_入库/080_stock_kline_1m.py, 1_入库/081_stock_kline_5m.py |
| L2 | 5m→15m/30m/60m | 2_计算/82_stock_kline_15m.py, 2_计算/83_stock_kline_30m.py, 2_计算/84_stock_kline_60m.py |
| L3 | 日线→周/月 | 2_计算/17_stock_kline_weekly.py, 2_计算/18_stock_kline_monthly.py |

## 六、通用执行模板

### 盘后补全（全量）

```bash
# L1: 源头入库
python 1_入库/081_stock_kline_5m.py
python 1_入库/080_stock_kline_1m.py

# L2: 分钟聚合
python 2_计算/82_stock_kline_15m.py
python 2_计算/83_stock_kline_30m.py
python 2_计算/84_stock_kline_60m.py

# L3: 周期聚合（按需）
python 2_计算/17_stock_kline_weekly.py   # 周五
python 2_计算/18_stock_kline_monthly.py # 月末
```

### 增量更新

```bash
# 脚本会自动从最新日期开始增量
python 1_入库/081_stock_kline_5m.py
python 2_计算/82_stock_kline_15m.py
```

### 特定日期补数

```bash
# 修改脚本中 start_date = '2026-06-01'
python 2_计算/82_stock_kline_15m.py
```

### 强制重跑

```bash
python 1_入库/081_stock_kline_5m.py --force
```

## 七、验证

```bash
# 确认最新日期已更新
duckdb "K:/DB数据库_v2/db/profit_radar.duckdb" -c "SELECT MAX(trade_time) FROM stock_kline_5m"
duckdb "K:/DB数据库_v2/db/profit_radar.duckdb" -c "SELECT MAX(trade_time) FROM stock_kline_15m"
```

## 八、DuckDB CLI 常用指令

```bash
# 查询
duckdb file.duckdb -c "SELECT * FROM table LIMIT 10"

# 导出CSV
duckdb file.duckdb -c "SELECT * FROM table" > output.csv

# 交互模式
duckdb file.duckdb
  > SELECT COUNT(*) FROM table;
  > .tables
  > .schema table_name
  > .quit

# 元命令
.tables          # 列出所有表
.schema name     # 查看表结构
.mode csv         # 输出格式CSV
.headers on       # 显示列名
```

---

**核心**: 先源头后下游，按L1→L2→L3顺序执行。
