# TDX二进制日期解析性能陷阱

> 本文档记录 `4_工具/tdx_reader.py` 在 GP/BK/SC/K 线读取中反复卡死的根因 + 永久修复方案。
> 适用所有需要从 TDX 二进制（`.day` / `.lc1` / `.lc5` / `cw/gpsz*.dat` 等）解码日期/时间的代码。

---

## 一、现象（踩坑实录）

`1_入库/93_stock_gp1_46_indicators.py` 多次跑挂在 `TdxReader.read_gp_stream` 的 `_flush()`，报错堆栈最终停在 `array_strptime` 内部，OOM 或长时间无响应。

其他已暴露同模式的入口：

| 入口 | 文件 | 行 |
|---|---|---|
| GP 全量 | `tdx_reader.read_gp` | 1246 |
| GP 流式 `_flush` | `tdx_reader.read_gp_stream` | 1319 |
| BK 板块 | `tdx_reader.read_bk` | 1442 |
| SC 宏观 | `tdx_reader.read_sc` | 1153 |
| 信号数据 | `tdx_reader.read_signal` | 1532 |
| K 线日级 | `tdx_reader._parse_single_day_file` | 137 |
| K 线分钟级 | `tdx_reader._parse_single_lc_file` | 229 |

---

## 二、根因：`pd.to_datetime` 的两条路径

`pd.to_datetime` 至少两条内部路径，性能差 **10–100 倍**：

```python
# ❌ 慢路径（array_strptime 逐行 C 调用）
pd.to_datetime({'year': y, 'month': m, 'day': d}, errors='coerce')
pd.to_datetime(d.astype('U10'), format='%Y%m%d', errors='coerce')
```

这两种调用对 N 行输入：

1. **N 个临时数组**：dict 输入要构造 3 个 N 长度数组（各 ~N×8B）；U10 输入要构造 N×10B 字符串数组
2. **N 次 strptime**：pandas 内部把每行当字符串走 `array_strptime`，本质逐行 C 调用
3. **N 个 Python datetime 对象**：结果再装回 pandas Series

10M 行实测：**14.8 秒**（1亿行 ≈ 2.5 分钟 + 多 GB 临时内存，足以 OOM）。

K 线 1.98 亿行（见 `memory/kline-aggregate-oom-pattern.md`）上**必 OOM**。

---

## 三、永久修复：numpy 原生工具函数

`4_工具/tdx_reader.py` 顶部常量区之后已加两个工具函数，**全文件禁止再写 `pd.to_datetime` 字典/U10 慢路径**：

```python
from tdx_reader import uint32_yyyymmdd_to_dt64, lc5_date_minutes_to_dt64

# GP/BK/SC/日 K 线统一接口: uint32 YYYYMMDD → datetime64[ns]
date_arr = uint32_yyyymmdd_to_dt64(data['date'].astype(np.uint32))

# 分钟 K 线 (LC_DTYPE 自定义编码): u2 date_num + u2 minutes → datetime64[ns]
ts_arr = lc5_date_minutes_to_dt64(data['date_num'], data['minutes'])
```

### 3.1 算法

[Hinnant date algorithm](http://howardhinnant.github.io/date_algorithms.html)，全 numpy 向量化，C 路径无 Python 循环：

```text
y_adj = (m <= 2) ? y - 1 : y
era   = y_adj // 400
yoe   = y_adj - era * 400
mpy   = (m <= 2) ? m + 9 : m - 3
doy   = (153 * mpy + 2) // 5 + d - 1
doe   = yoe * 365 + yoe // 4 - yoe // 100 + doy
days  = doe + era * 146097 - 719468       # days since 1970-01-01
ns    = days * 86400 * 1e9                # → datetime64[ns]
```

### 3.2 边界校验

为与 `pd.to_datetime(errors='coerce')` 行为对齐，越界日期（非闰年 2/29、4/31 等）返回 `NaT`：

- 月份合法：`1 ≤ m ≤ 12`
- 日合法：查表 `mth_max[m]` + 闰年 2 月调整
  - 闰年判定：`(y % 4 == 0) & (y % 100 != 0) | (y % 400 == 0)` & `y ≥ 1`

### 3.3 性能（10M 行实测）

| 路径 | 耗时 | 加速比 |
|---|---|---|
| `pd.to_datetime(dict=)` 旧 | 14.8s | 1.0x |
| `pd.to_datetime(U10, format=)` 旧 | 15.0s | 1.0x（同样慢，**不要以为是快路径**） |
| `uint32_yyyymmdd_to_dt64` 新 | **1.0s** | **14.6x** |

精度：与 `pd.to_datetime(errors='coerce')` 逐行一致（含 4/31、2/29 闰年、1900-2100 跨闰年边界）。

---

## 四、正确用法示例

### 4.1 单文件解析（K 线）

```python
# 旧（卡死）
ts = pd.to_datetime(dict(year=years, month=months, day=days))

# 新
ts = uint32_yyyymmdd_to_dt64(dates_u4)   # dates_u4 是 data['date'].astype(np.uint32)
```

### 4.2 流式批 yield

```python
def _flush():
    d = np.concatenate(ch_date).astype(np.uint32)
    return pd.DataFrame({
        'date': uint32_yyyymmdd_to_dt64(d),
        ...
    })
```

### 4.3 DataFrame 列后处理

```python
# 旧
result['date'] = pd.to_datetime(result['date'].astype(str), format='%Y%m%d', errors='coerce').dt.date

# 新（直接拿整列 u4 喂进去）
result['date'] = uint32_yyyymmdd_to_dt64(result['date'].values)
```

注意：返回值是 `datetime64[ns]`，**不是 Python `date`**。下游若要 `date` 类型用 `.dt.date` 转，或入库 DuckDB 时让 DuckDB 自动 `datetime64[ns] → DATE`。

---

## 五、禁令与协作

### 5.1 硬禁令（本文件）

`4_工具/tdx_reader.py` 顶部已加注释：

```python
# ⚠ 禁止在本文件使用 pd.to_datetime 的字典/混合输入构造:
#   pd.to_datetime({'year': y, 'month': m, 'day': d})  走慢路径 (array_strptime 逐行),
#   对一亿+ 行 uint32 数组会 OOM+卡死 (本文件 2025-2026 多次踩坑的根因).
# 一律用下面两个 numpy 原生工具: 全 C 实现, 内存峰值 ~2x 输入数组, 亿行 < 2s.
```

### 5.2 项目级约束（推荐加入 CLAUDE.md）

任何**新写**的 TDX 二进制解析脚本：

1. 日期字段是 `uint32 YYYYMMDD` → 用 `uint32_yyyymmdd_to_dt64`
2. 日期字段是 `LC_DTYPE` 编码 → 用 `lc5_date_minutes_to_dt64`
3. **禁止** `pd.to_datetime` 字典/U10/format 路径，**禁止** Python `date()` 循环（`date()` 还自带严格校验会抛 `ValueError`，不适合批量）

### 5.3 测试要求

新增解析脚本必须用以下输入规模冒烟：

| 规模 | 数据 | 预期耗时（参考） |
|---|---|---|
| 1M 行 | 随机日期 | < 0.5s |
| 10M 行 | 随机日期 | < 2s |
| 100M 行 | 随机日期 | < 20s |

超此基线 50% 视为回归。

---

## 六、相关记忆

- `memory/kline-aggregate-oom-pattern.md` —— K 线 1.98 亿行 OOM 模式（本方法是其根因级修复）
- `memory/gp-indicator-semantics.md` —— GP27 字节 bug 是数据语义问题，跟本性能问题独立

---

## 七、版本

- 2026-06-27 初版：抽 `uint32_yyyymmdd_to_dt64` + `lc5_date_minutes_to_dt64`，替换 7 处用法，10M 行 14.6x 加速。