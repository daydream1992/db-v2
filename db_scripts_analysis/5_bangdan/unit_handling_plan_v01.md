# 字段单位梳理 — 入门指南（不入库，不查数据）

> 状态：方案梳理 v0.1
> 原则：**不查 TQ 接口文档，不查 tdx_reader 源码**，避免引入新的认知偏差。
> 目标：列出"哪些字段在什么场景下被读"，让人类判断"哪个环节最需要 unit 标注"。

---

## 一、运作流程（5 张核心表）

```
┌──────────────────────────────┐
│ 外部数据源 (SSOT of units) │
│  - TQ 接口 (tqcenter) │  - TDX 二进制 (vipdoc) │
│   单位: 见 TQ 接口文档 │   单位: 见 TDX 协议 │
└──────────────┬─────────────────┘
               │  (直接入库 / 不做单位转换)
               ▼
┌──────────────────────────────┐
│ 1_入库/ 原始层 │
│  - 101 sjb_api_plhqL2kz_88zd (TQ L2 快照) │
│  - 137 capital_info (股本) │
│  - 34  t_bk5_19 (板块 BK05-19) │
│  - 10  stock_daily_kline (日K线) │
└──────────────┬─────────────────┘
               │  (SQL 派生，可能产生新字段)
               ▼
┌──────────────────────────────┐
│ 2_计算/ 派生层 │
│  - 19 stock_daily_turnover (换手率 + 涨跌幅) │
│    派生自: 10 (kline) + 137 (capital) ASOF/LOCF │
│  - 17/18 weekly/monthly K 线 │
│  - 70/71 pianpao_* (骗炮系列) │
└──────────────┬─────────────────┘
               │  (业务消费)
               ▼
┌──────────────────────────────┐
│ 消费层 │
│  - 3_策略/check_health.py (健康检查) │
│  - 4_工具/ingest_plan.py (K线入库计划) │
│  - 4_工具/pianpao_engine.py (骗炮引擎) │
│  - 人工 SQL 查询 / Excel 报表 │
└──────────────────────────────┘
```

## 二、单位来源（仅凭 @meta 元数据，不查实现）

| 来源类型 | 单位规则 | 由谁定 | 信任度 |
|---|---|---|---|
| `source=tqcenter API` | **元** | TQ 官方文档 | 高（API 文档为准）|
| `source=二进制` (TDX) | 看字段：计数=个，市值=亿，价=元，比率=% | TDX 协议 | 中（要靠字段名猜）|
| `source=SQL派生` | 看公式 | 派生脚本里的 SQL | 高（自己写自己负责）|

**关键洞察**：**入库层不动单位**（101/137/34/10 都直接落地原始值），单位混乱是从**跨表 JOIN** 和 **派生计算** 开始的。

## 三、单位最可能出错的 3 个场景

### 场景 A：跨源 JOIN（最常见）
```
例：t_bk5_19.总市值 (亿) ←JOIN→ stock_daily_kline.成交额 (元)
     差 10000 倍
```

### 场景 B：派生计算新字段
```
例：stock_daily_turnover.turnover (派生公式)
     turnover = 成交量 / 流通股本
     公式里的量纲决定输出是 % 还是 小数
     派生层最容易出现"我以为是 %，其实是 0.79"
```

### 场景 C：跨源查相同概念
```
例：dwd_stock_capital_flow.封单金额 (已删表)
    vs
    sjb_api_plhqL2kz_88zd.FzAmo
    同概念不同源，差单位风险最高
```

## 四、按"风险 × 频率"排序的标注优先级

| 优先级 | 字段 | 理由 |
|---|---|---|
| 🔴 P0 | `t_bk5_19.{总市值,流通市值,自由流通市值}` | 亿 vs 元差 1 万倍，板块对比最常用 |
| 🔴 P0 | `sjb_api_plhqL2kz_88zd.{Zjl, Zsz, Ltsz, FzAmo, fHSL}` | TQ 原始字段，每次 JOIN 都得查单位 |
| 🟡 P1 | `stock_daily_turnover.{turnover, pct_chg}` | 派生字段，公式决定单位 |
| 🟡 P1 | `stock_daily_kline.{涨跌幅, 换手率}` | kline 自带涨跌幅；换手率列 100% NULL 别用 |
| 🟢 P2 | `capital_info.{zgb, ltgb}` | 单纯股本，不参与金额运算，但单字段单位要明 |
| ⚪ P3 | `t_bk5_19.{涨跌数, 涨停数, 跌停数, 开盘成交数}` | 计数字段，单位固定"个"，不必标 |

## 五、3 个备选方案（待你拍板）

### 方案 A：只写 docs/UNITS.md（最轻）
- 不动 schema、不动脚本、不动 sync-dict
- **新建** `docs/UNITS.md`，列 12-15 个关键字段的"来源 × 单位 × 样例 × 来源文档位置"
- 维护成本：0（人手维护）
- 防错能力：🟡 中（依赖人查文档）

### 方案 B：用 DuckDB `COMMENT ON COLUMN` + sync-dict（中等）
- 给关键字段加 SQL 注释：`COMMENT ON COLUMN sjb_api_plhqL2kz_88zd.Zjl IS '主力净流入(单位:元)'`
- 改造 `config/gen_data_dict.py` 让 sync-dict 把 COMMENT 读进 `data_dictionary.json`
- `config/data_dictionary.json` 的 `unit` 字段自动填充
- 维护成本：🟡 中（改 DDL + 改生成器）
- 防错能力：🟢 高（结构化、可查询）

### 方案 C：在 1_入库 脚本里加 unit 常量 + 注释（重）
- 在每个 1_入库 脚本顶部加 `FIELD_UNITS = {'Zjl': '元', ...}`
- 加 unit 断言：`assert value_reasonable(Zjl, expected_unit='元')`
- 维护成本：🔴 高（每个入库脚本都改）
- 防错能力：🟢 很高（运行时校验）

## 六、我的推荐

**方案 A 先做，方案 B 待观察**：

1. **第一步**（方案 A，0 风险）：你手工写 `docs/UNITS.md`，列 15 个关键字段的"来源 + 单位 + 样例"。我可以先把骨架写好，你来填单位（你比我准）。
2. **第二步**（观察期）：用一周看人工查文档够不够用。如果频繁出错，再升级到方案 B。
3. **方案 C 不做**：runtime 断言风险高，万一断言错就破坏入库。

**绝对不做**：
- 不改 101/137/34/10 任何一个入库脚本（按 CLAUDE.md "禁止实现业务逻辑"，入库侧只透传）
- 不做单位转换（"入库统一转万元"会丢精度 + 改历史数据 + 改下游所有计算）
- 不查 TQ 接口文档（避免新的认知偏差）

## 七、待你定的事

1. 方案 A 还是 B 还是 C？
2. 如果选 A：你要我写骨架，还是你自己写？（我自己写会有"凭印象填单位"的风险，**建议你自己填**）
3. 是否同意"先不查任何文档、不读任何实现代码"的约束？

---

## 附录：相关文件清单（未读取，仅路径）

- 入库层：`1_入库/101_jb_api_plhqL2kz_88zd.py`, `137_capital_info.py`, `34_t_bk5_19_.py`, `10_stock_daily_kline.py`
- 派生层：`2_计算/19_stock_daily_turnover.py`, `17_stock_kline_weekly.py`, `18_stock_kline_monthly.py`, `70_pianpao_daily.py`, `71_pianpao_batch.py`, `36_dim_industry_code.py`, `001_dim_security_type_sync.py`
- 消费层：`3_策略/check_health.py`, `4_工具/ingest_plan.py`, `4_工具/pianpao_engine.py`
- SSOT 配置：`config/data_dictionary.json`, `docs/data_dict.md`, `config/tables.json`
- 文档源（**不读**）：`docs/TDXQuant 完整接口文档3.0.json`, `4_工具/tdx_reader.py` (BK_MAPPING)