# DB数据库_v2 运行方法论

> 基于 K:\tqcenter数据库\DB数据库 源码实践，2026-06-07

## 1. 数据源

| 管道 | 数据源 | 覆盖表 |
|------|--------|--------|
| TQ API | TDXQuant API | 交易/财务/扩展数据 |
| TDX 二进制 | 本地 vipdoc/ | K线/指数/ETF/板块 |

### 1.1 TQ API 连接初始化

```python
import sys, os

# 1. 注入 tqcenter 路径（通达信安装目录下的 PYPlugins/user）
sys.path.insert(0, r"<通达信安装路径>\PYPlugins\user")

# 2. 导入并初始化
from tqcenter import tq
tq.initialize(__file__)           # 必须调用，传入脚本路径

# 3. 可选：刷新缓存
tq.refresh_cache()

# 4. 调用 API
result = tq.get_more_info('300308.SZ')

# 5. 结束时关闭
tq.close()
```

> **注意**: `tqcenter` 不是 pip 包，来自通达信安装目录。必须在 `sys.path` 中注入
> `PYPlugins/user` 路径后才能 `import`。当前安装路径: `i:\txdlianghua`

## 2. 初始化顺序

```
1. trading_calendar（交易日历）← 必须最先
2. stock_basic_info / sector_list（基础信息）
3. stock_sector_relation / sector_stocks（板块关系）
```

## 3. 批量调用规范

### 3.1 batch_size 参数（来自 pipeline.py）

| API | batch_size | 并发 |
|-----|-----------|------|
| get_market_data (K线) | 50 | - |
| get_gpjy_value (交易数据) | 20 | - |
| get_more_info (扩展行情) | 100 | 10 线程 |
| get_stock_info (基本面) | 100 | 10 线程 |
| get_sector_list (板块成分) | 20 | - |
| formula_process_mul_zb (技术指标) | 100 | - |
| 板块数据（板块数据入库维护方法.md） | 10 | 避免 API 超时 |
| 龙虎榜 | 20 | - |

### 3.2 线程池配置

```python
# 扩展信息：10 线程并发
EXTENDED_INFO_THREAD_COUNT = 10

# K线/财务：5 线程并发
with ThreadPoolExecutor(max_workers=5) as pool:
    futures = {pool.submit(_fetch_one, code): code for code in codes}
```

### 3.3 进度日志与写入时机

```python
# 每 500 条写入一次
if (i + batch_size) % 500 == 0 and all_rows:
    self.mgr.write_xxx(all_rows)
    logger.info("进度: %d/%d, 已写入 %d 条", i + batch_size, total, len(all_rows))
    all_rows = []
```

### 3.4 防爆内存策略

```python
# 分批写入，避免内存溢出
for i in range(0, total, batch_size):
    batch = codes[i: i + batch_size]
    df = fetch(batch)
    all_rows.append(df)
    if len(all_rows) >= 500:
        write_and_clear()  # 500 条阈值写入
```

### 3.5 API 节流

```python
# 每 500 股 sleep 0.3s（避免被限流）
if (i + batch_size) % 500 == 0:
    time.sleep(0.3)

# 技术指标每 batch sleep 2s
time.sleep(2)
```

## 4. 写入规范

### 4.1 Upsert（去重写入）

```python
# db/manager.py write_df()
tmp_name = f"_temp_{table_name}"
conn.register(tmp_name, df)
pk_sel = ", ".join(pk_columns)
conn.execute(f"DELETE FROM {table_name} WHERE ({pk_sel}) IN (SELECT {pk_sel} FROM {tmp_name})")
conn.execute(f"INSERT INTO {table_name} SELECT * FROM {tmp_name}")
```

### 4.2 增量写入

```python
# write_df_incremental() - 只写比最新日期新的行
def write_df_incremental(self, df, table_name, pk_columns, date_column=None):
    # 1. 查表中最新的日期
    # 2. 过滤 df 只保留比最新日期新的行
    # 3. 调用 write_df 写入
```

### 4.3 批量快速写入

```python
# write_rows_fast() - 直接 INSERT，不校验
conn.executemany(f"INSERT INTO {table} ({cols}) VALUES ({placeholders})", rows)
```

## 5. 重试策略

### 5.1 RetryConfig（来自 retry_handler.py）

```python
@dataclass
class RetryConfig:
    max_retries: int = 3           # 最大重试次数
    base_delay: float = 1.0         # 基础延迟(秒)
    max_delay: float = 60.0          # 最大延迟(秒)
    strategy: RetryStrategy = RetryStrategy.EXPONENTIAL_WITH_JITTER
```

### 5.2 可重试异常

```python
default_retry_exceptions = (
    ConnectionError,
    TimeoutError,
    ConnectionResetError,
    ConnectionRefusedError,
)
```

## 6. 质量校验

### 6.1 交易日历过滤

```python
# 只保留交易日数据
trading_dates = set(mgr.query("trading_calendar")["date"].unique())
df = df[df["date"].isin(trading_dates)]
```

### 6.2 字段范围检查

```python
# data_validator.py 6层验证
- 字段级别范围检查 (FIELD_SPEC)
- 主键唯一性约束
- 跨表一致性检查
- 异常值统计
```

## 7. 常用命令

| 操作 | 命令 |
|------|------|
| 全量入库 | `python run.py all` |
| 单表入库 | `python run.py <table>` |
| 健康扫描 | `python run.py scan` |
| 强制重跑 | `python run.py fix <table>` |
| 导出数据 | `python run.py get <table>` |

## 8. 已知限制

| 限制 | 影响表 | 说明 |
|------|--------|------|
| get_more_info 无 IOPV 字段 | etf_iopv_daily | iopv / premium_rate 字段填 NULL |
| GP11/12/13 不覆盖 ETF | etf_capital_flow | 全表无数据 |
| API 不返回 ETF 持仓 | etf_holding_stock | 全表无数据 |
| API 不返回 PCF 清单 | etf_pcf_list | 全表无数据 |
| TNF 名称截断 | etf_product | 部分 SZ ETF 名称在 GBK 多字节边界截断 |
| API 不返回基金公司/管理费 | etf_product | fund_company / management_fee / custody_fee 填空 |
| 无映射 ETF 无跟踪指标 | etf_derived_indicator | track_index 为空的 ETF 跟踪误差为 NULL |

---

> 源码扫描时间: 2026-06-07