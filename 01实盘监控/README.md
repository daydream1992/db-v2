# 01实盘监控 (订阅式盘中异动监控)

> 盘中 9:30–11:30 / 13:00–15:00 每 15 秒轮询订阅池, 检测异动, 推送飞书。

---

## ⚠️ 治理说明

本目录是**工具模块**, 与 `竞价监控/`、`4_工具/` 平级, **不参与** run.py / data_dictionary / check_integrity 治理。
- 不写 DuckDB(避免与项目 SSOT 脱钩)
- 异动事件落 `output/events_YYYYMMDD.parquet`(本目录, 被 .gitignore)
- 日报落 `reports/intraday_YYYYMMDD.md`

---

## 快速开始

```bash
cd "K:\DB数据库_v2\01实盘监控"

# 1. mock 全链路(任何时间, 无 tqcenter 依赖, 用飞书建议先 --dry-run)
python main.py --mock --dry-run
python main.py --mock            # 真推飞书(验证推送)

# 2. 字段探测(盘中跑一次, 确认关键字段)
python probe.py

# 3. 连通性单测(盘中跑一轮就退出)
python main.py --once

# 4. 实盘长驻(盘中 9:30 后跑, Ctrl+C 退出+写日报)
python main.py
python main.py --interval 30     # 改轮询间隔
python main.py --dry-run         # 检测+落盘, 不推飞书
```

---

## 文件结构

```
01实盘监控/
├── pool.txt            ← 订阅池(默认3只: 大族激光/圣阳股份/中国长城)
├── config.py           ← THRESHOLDS/SCHEDULE/CONFIG/LABELS(冻结 dataclass)
├── data.py             ← 快照轮询(单股 get_market_snapshot → 标准化)
├── capital.py          ← 主力净额 ZLJE 差额(formula_process_mul_zb)
├── engine.py           ← 8 类异动检测(纯函数 + MonitorState)
├── notify.py           ← 飞书推送 + Deduper(3分钟去重)
├── main.py             ← 长驻轮询编排(价格15s + 资金3min, mock/once/dry-run)
├── probe.py            ← 快照字段探测
├── feishu_webhook.txt  ← webhook(.gitignore)
├── output/             ← events_YYYYMMDD.parquet(.gitignore)
└── reports/            ← intraday_YYYYMMDD.md(.gitignore)
```

---

## 异动检测规则

| 类型 | 触发条件 | 严重度 | 受3分钟去重 |
|------|----------|--------|-------------|
| 涨速冲高/下挫 | \|5分钟涨跌幅\| ≥ 2%(用 Before5MinNow) | warn | 是 |
| 涨跌幅触及 | pct 穿越 ±3/±5/±7 关键位 | warn | 是 |
| 涨停封板 | 现价≈涨停价 且 卖一量骤减 | warn | 否(豁免) |
| 炸板 | 封板后现价跌离涨停价 | critical | 否(豁免) |
| 量能放大 | 本轮15秒成交 > 窗口均量×5 | info | 是 |
| 超买 | 日内位置>85% + 正涨速 + 外盘>内盘 | warn | 是 |
| 超卖 | 日内位置<15% + 负涨速 + 内盘>外盘 | warn | 是 |
| 趋势反转 | 窗口短长均线交叉 + "有势可反" | warn | 是 |
| 主力流入/流出 | 3分钟 ZLJE 差额 ≥ ±2000万 | warn | 是 |

> 阈值全集中在 `config.THRESHOLDS`, 改阈值不改业务代码。
> 超买超卖用启发式量价(日内位置+涨速+内外盘), 非标准 RSI; `use_rsi` 留扩展点。
> 主力资金(ZLJE)差额独立 3 分钟轮询(与价格 15s 解耦), 仅交易时段有效; `--no-capital` 禁用。
> ZLJE 公式须先在通达信建好(见 `tes/ZLJE公式安装说明.md`)。

---

## 飞书推送

- webhook 读 `feishu_webhook.txt`(复制自竞价监控, 同一群); 空→只本地输出。
- 消息类型 `text`; critical(炸板)立即单推, 其余合并一条。
- 频控: 同股同类型 180 秒内不重复推; 封板/炸板豁免。
- 若机器人开了"加签", 需在 `notify.push_feishu` 补 timestamp+sign(见 TODO)。

---

## 数据源

`tq.get_market_snapshot(stock_code)` 盘中返回字段(实测):
`Now/Open/Max/Min/LastClose/Volume/Amount/NowVol/Inside/Outside/
Before5MinNow(5分钟前价)/Zangsu(涨速)/TickDiff/Buyp/Buyv/Sellp/Sellv(五档)`。

- 路径: `K:\txdlianghua\PYPlugins\sys\tqcenter.py`
- 单股调用, 3 只票一轮 < 1 秒。
- 盘前/停牌 Now=0 的票自动跳过。

---

## 接入 Windows 任务计划程序(可选, 盘中自动唤醒)

```xml
<Task>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T09:30:00</StartBoundary>
      <Repetition><Interval>1 day</Interval></Repetition>
    </CalendarTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>pythonw</Command>
      <Arguments>"K:\DB数据库_v2\01实盘监控\main.py"</Arguments>
      <WorkingDirectory>K:\DB数据库_v2\01实盘监控</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
```
程序内部判断时段, 非交易时段会等待。

---

## 依赖

- python 3.11+
- pandas, loguru, rich, pyarrow(parquet, 缺失自动跳过)
- tqcenter(`K:\txdlianghua\PYPlugins\sys\tqcenter.py`)

---

## 故障排查

| 症状 | 排查 |
|---|---|
| `tqcenter 加载失败` | 确认 `K:\txdlianghua\PYPlugins\sys\tqcenter.py` 存在, 通达信客户端运行中 |
| `快照全空` | 非交易时段 → 用 `--mock`; 盘中则查 tqcenter 连接 |
| `飞书推送未启用` | 填 `feishu_webhook.txt`; dry-run 模式本就不推 |
| `parquet 未生成` | `pip install pyarrow` |
| 关键字段缺失 | 盘中跑 `python probe.py` 看实际返回字段 |
