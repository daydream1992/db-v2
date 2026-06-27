# 竞价监控雷达 (Call-Auction Monitor)

> A 股集合竞价 09:15 / 09:20 / 09:25 三时刻实时采样 → 双模式自动评分 → TOP20 候选输出。

---

## ⚠️ 项目治理说明

本目录是 **工具模块**,不参与项目 run.py / data_dictionary / check_integrity 治理。
- `K:\DB数据库_v2\竞价监控\` 是用户授权的顶级目录(与 4_工具/ 平级)
- 不写 DuckDB(避免与项目 SSOT 脱钩)
- 落盘到 `竞价监控/output/auction_monitor_YYYYMMDD.parquet`(同目录,被 .gitignore)
- 报告写到项目级 `reports/auction_monitor_YYYYMMDD_HHMMSS.md`

---

## 快速开始

```bash
# 1. mock 模式(任何时间可跑,无 tqcenter 依赖)
cd "K:\DB数据库_v2\竞价监控"
python main.py --mock

# 2. 实盘(等 09:15/09:20/09:25 三时刻跑完)
python main.py

# 3. 不等时刻立即采(测试连通性,非交易时段)
python main.py --no-wait

# 4. 自定义池
python main.py --pool mypool.txt --top 10
```

---

## 文件结构

```
竞价监控/
├── pool.txt          ← 监控池(30 只预置,可编辑)
├── config.py         ← THRESHOLDS / SAMPLING / CONFIG 冻结 dataclass
├── data.py           ← L1 安全快照 + L2 特征
├── engine.py         ← L3 双模式评分(纯函数)
├── notify.py         ← L4 飞书推送(桩,NotImplementedError)
├── main.py           ← 编排
├── output/           ← parquet 落盘(被 .gitignore)
└── README.md         ← 本文件
```

---

## 三时刻采样时序

| 时刻 | 标签 | 用途 |
|---|---|---|
| **09:15:00** | s1 | 集合竞价开盘(接受订单) |
| **09:20:05** | s2 | 撮合阶段早盘指示 |
| **09:25:05** | s3 | 撮合完成后 5 秒(Open 已确定) |

---

## 评分规则

**双模式自动分流**:
- `pct > 1.0%` → **趋势追高**(trend)
- `pct < -1.0%` → **反核低吸**(dip)
- `|pct| ≤ 1.0%` → **弱信号**(weak,40 分)
- 数据异常 → **熔断**(anomaly,0 分)

**`pct` 公式**:`(s3.now - last_close) / last_close * 100`(与昨收比)
**`trap_ratio` 公式**:`s3.now / s2.now`
- `< 0.95` → 开盘诱多(trend 扣 15 分)
- `> 1.05` → 低吸成功(dip 加 20 分)

**score 计算**(以 trend 为例):
```
score = 60
      + 20 * min(1, pct/5)              # 涨幅
      + 10 * min(1, amount/5千万)       # 资金
      + 10 * min(1, vol/1万手)          # 成交量
      - 15 * (trap_ratio < 0.95)        # 诱多扣分
clamp to [0, 100]
```

阈值在 `config.py` 改,无需改业务代码。

---

## 已知修正

**用户伪代码的 3 处修正**:

1. `tq.get_full_tick(codes)` **不存在** → 改用 `tq.get_market_snapshot(stock_code)` 单股循环
2. 原 `p1=09:19:55` 时机 → 改为 `s1=09:15:00`(开盘信号)
3. 原 `trap_ratio = p3/p1` 公式 → 改为 `trap_ratio = s3/s2`(开盘指示 → 撮合完成的演变)

---

## 已知限制

- 单 DLL 串行调用,30 只 × 3 时刻 ≈ 0.6s/股 × 90 = 54s
- 不做回测/历史扫描
- 飞书推送为桩函数,需用户实现 webhook
- 跨日重跑不保留历史(parquet 同日覆盖)
- 数据字典不会自动同步

---

## 接入 Windows 任务计划程序

每天 09:25:00 自动触发:
```xml
<Task>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T09:25:00</StartBoundary>
      <Repetition>
        <Interval>1 day</Interval>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>python</Command>
      <Arguments>"K:\DB数据库_v2\竞价监控\main.py"</Arguments>
      <WorkingDirectory>K:\DB数据库_v2\竞价监控</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
```

---

## 依赖

- python 3.11+
- pandas, loguru, rich
- pyarrow(parquet 落盘,缺失时自动跳过)
- tqcenter(`K:\txdlianghua\PYPlugins\user\tqcenter.py`)

---

## 故障排查

| 症状 | 排查 |
|---|---|
| `tqcenter 加载失败` | 确认 `K:\txdlianghua\PYPlugins\sys\tqcenter.py` 存在 |
| `监控池为空` | 检查 pool.txt 格式(代码带 .SH/.SZ 后缀) |
| `快照全空` | 09:15 前/15:00 后跑 → 改用 `--mock` 或加 `--no-wait` |
| `parquet 未生成` | pip install pyarrow |
| `飞书推送未启用` | 在 `config.py` 填 `feishu_webhook`,并实现 `notify.push_feishu` |
