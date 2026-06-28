---
name: kline-coverage-investigation
description: K线数据覆盖率探测方法论：通过对比日K/分钟K文件数和日期范围，判断缺失是退市还是本地下载不全
metadata:
  type: pattern
---

# K线数据覆盖率探测方法论

## 核心问题
日K有数据但分钟K没有，原因是退市/到期还是本地下载不全？

## 探测步骤

### 1. 文件数对比
```python
from pathlib import Path

vipdoc = Path(r'K:\txdlianghua\vipdoc')

day_dir = vipdoc / 'sh' / 'lday'
min_dir = vipdoc / 'sh' / 'minline'

day_stems = set(f.stem for f in day_dir.glob('*.day'))
min_stems = set(f.stem for f in min_dir.glob('*.lc1'))

missing = day_stems - min_stems
print(f'日K: {len(day_stems)}, 1m: {len(min_stems)}, 缺失: {len(missing)}')
```

### 2. 按前缀分组判断缺失类型
- **部分有**：本地下载不全，大部分是活跃证券
- **全没有**：可能是通达信本身不提供（如板块指数 sh887/sh888）

### 3. 日期范围对比（关键）
解析日K文件获取首尾日期：
```python
import struct

def get_date_range(filepath):
    data = filepath.read_bytes()
    n = len(data) // 32
    if n == 0:
        return None, None
    first = struct.unpack('<I', data[:4])[0]
    last = struct.unpack('<I', data[(n-1)*32:(n-1)*32+4])[0]
    return first, last
```

**判断规则：**
- 有1m的：最新日期 = 今天（20260612）
- 没有1m的：最新日期远早于今天 → **已退市/到期**
- 文件大小只有96字节（3条记录）→ 通达信本身不生成分钟数据

### 4. 快速分类（按前缀）
| 前缀 | 类型 | 有1m? | 原因 |
|------|------|-------|------|
| sh000/0xx | 上证指数 | 部分有 | 停更的已剔除 |
| sz399 | 深证指数 | 部分有 | 停更的已剔除 |
| sh600/sz000/sz002/sz300 | 个股 | 大部分有 | 活跃品种 |
| sh113/sz123/sz127 | 可转债 | 部分有 | 已到期的无1m |
| sh510/sz159 | ETF | 大部分有 | 活跃品种 |
| sh887/sh888 | 板块指数 | 全没有 | 通达信本身不提供 |

## 结论判断
1. **缺失证券的日K最新日期远早于今天** → 已退市/到期，缺失合理
2. **日K文件只有3条记录（96字节）** → 通达信本身不生成分钟数据，不是本地问题
3. **日K有完整数据但无1m文件，且日期较新** → 本地下载不全，可补下载

**Why:** 避免误判为"数据缺失"，实际上大多数缺失是证券退市后通达信停止更新分钟数据，属正常现象。
**How to apply:** 遇到K线覆盖率问题，先用此方法论探测，避免无意义的"补数据"尝试。