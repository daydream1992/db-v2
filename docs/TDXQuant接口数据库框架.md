# TDXQuant 接口文档 3.0 — 数据库框架梳理

> **整理日期**: 2026-06-09
> **文档来源**: `docs/TDXQuant 完整接口文档3.0.json`

---

## 一、整体概览

| 指标 | 数值 |
|------|------|
| 版本 | 3.0 |
| 最后更新 | 2026-05-15 |
| 总接口数 | 85 |
| 实测验证数据 | 26 项 |

---

## 二、接口分类

### 1️⃣ 盘中接口（intraday）- 13 个
| 接口名 | 功能 | 状态 |
|--------|------|------|
| `get_market_snapshot` | 实时行情快照 | ✅ 已验证 |
| `subscribe_hq` | 订阅实时行情推送 | 实时监控 |
| `unsubscribe_hq` | 取消订阅 | - |
| `get_report_data` | 盘口逐笔数据 | 逐笔成交 |
| `get_realtime_data` | 实时分时数据 | 分时图 |
| `formula_process_mul_xg` | 实时选股 | - |
| `send_order` | 下单交易 | 模拟交易 |
| `order_stock` | 股票下单(TdxQuant) | - |
| `cancel_order` | 撤单 | - |
| `cancel_order_stock` | 撤销委托(TdxQuant) | - |
| `query_position` | 查询持仓 | - |
| `query_order` | 查询委托 | - |
| `start_simulation` | 启动模拟交易 | - |

### 2️⃣ 盘后接口（after_hours）- 8 个
| 接口名 | 功能 | 用途 |
|--------|------|------|
| `get_market_data` | 历史K线数据 | 日K/分钟K |
| `get_history_data` | 历史K线(TdxQuant) | - |
| `get_history_data_multi` | 批量历史K线 | - |
| `refresh_cache` | 刷新行情缓存 | - |
| `refresh_kline` | 预缓存K线 | 盘中加速 |
| `download_file` | 下载数据文件 | 综合信息/舆情/十大股东 |
| `set_backtest_params` | 设置回测参数 | - |
| `run_backtest` | 运行回测 | - |

### 3️⃣ 全天通用接口（all_day）- 64 个

#### 3.1 股票基础信息
| 接口名 | 功能 |
|--------|------|
| `get_stock_list` | 股票列表 |
| `get_market_info` | 市场信息 |
| `get_more_info` | 扩展信息（市值/PE/PB等27项） |
| `get_divid_factors` | 分红配送 |
| `get_ipo_info` | 新股申购 |
| `get_gb_info` | 股本数据 ✅ |

#### 3.2 估值数据
| 接口名 | 功能 | 验证 |
|--------|------|------|
| `get_gp_pe` | 个股市盈率 | 仅TdxQuant |
| `get_gp_pb` | 个股市净率 | 仅TdxQuant |
| `get_block_pe` | 板块市盈率 | ✅ |
| `get_market_pe` | 市场市盈率 | ✅ |

#### 3.3 交易数据（GPJY）
| 字段 | 含义 | 单位 | 验证 |
|------|------|------|------|
| GP1 | 股东人数 | 户 | ✅ 季末 |
| GP3 | 融资融券 | Value[0]=融资, Value[1]=融券 | 万元 |
| GP4 | 融资明细 | Value[0]=买入额, Value[1]=偿还额 | 万元 |
| GP11 | 主力净流入 | Value[0]=主力, Value[1]=散户 | 万元 |
| GP12 | 大单/小单 | Value[0]=大单, Value[1]=小单 | 万元 |
| GP13 | 中单/超大单 | Value[0]=中单, Value[1]=超大单 | 万元 |
| GP16 | 总市值 | 万元 | ✅ |
| GP19 | 市盈率 | - | ✅ |
| GP20 | 市净率 | - | ✅ |
| GP21 | 股息率 | % | ✅ |
| GP25 | 5日涨幅 | % | - |
| GP27 | 涨停统计 | 天数/标志 | - |
| GP28 | 量价指标 | Value[0]=量比, Value[1]=换手率 | ✅ |
| GP44 | 综合评分 | - | ✅ |
| GP45 | 机构评级 | - | ✅ |
| GP47 | 主力净额 | 万元 | - |

#### 3.4 板块数据（BKJY）
| 字段 | 含义 | 验证 |
|------|------|------|
| BK5 | 板块PE TTM | ✅ |
| BK6 | 板块PB MRQ | ✅ |
| BK9 | 板块涨跌幅 | - |
| BK10 | 板块总市值 | 亿元 |
| BK12 | 涨停家数 | - |
| BK13 | 跌停家数 | - |
| BK15 | 上涨家数 | - |
| BK16 | 下跌家数 | - |

#### 3.5 市场数据（SCJY）
| 字段 | 含义 | 验证 |
|------|------|------|
| SC1 | 融资融券余额 | ✅ 沪深 |
| SC2 | 陆股通资金 | - |
| SC3 | 涨跌停股数 | - |
| SC4 | 涨跌家数 | - |
| SC5 | 融资净买入 | 万元 |
| SC6 | 融券净卖出 | 万元 |
| SC7 | 融资融券净额 | 万元 |
| SC8 | 北向资金 | 万元 |
| SC10 | 市场均价/振幅 | - |
| SC31 | 涨停/跌停统计 | - |
| SC34 | 融资融券余额 | 万元 |

#### 3.6 板块关系
| 接口名 | 功能 |
|--------|------|
| `get_relation` | 股票板块归属 ✅ |
| `get_sector_list` | 板块列表 |
| `get_stock_list_in_sector` | 板块成份股 |
| `get_industry_list` | 行业板块 |
| `get_concept_list` | 概念板块 |
| `get_block_stocks` | 板块成份股 |
| `get_user_sector` | 自定义板块 |
| `send_user_block` | 添加到自定义 |
| `create_sector` | 创建板块 |
| `delete_sector` | 删除板块 |
| `rename_sector` | 重命名 |
| `clear_sector` | 清空 |

#### 3.7 ETF/可转债/期货
| 接口名 | 功能 |
|--------|------|
| `get_etf_data` | ETF数据 |
| `get_trackzs_etf_info` | 跟踪指数ETF信息 |
| `get_convertible_bond_data` | 可转债数据 |
| `get_kzz_info` | 可转债信息 |
| `get_futures_data` | 期货数据 |

#### 3.8 技术指标公式
| 接口名 | 功能 | 验证 |
|--------|------|------|
| `formula_zb` | 单只股票公式 | ✅ MACD/KDJ/RSI/BOLL/MA |
| `formula_process_mul_zb` | 批量计算 | ✅ MACD |
| `formula_process_mul` | 批量执行公式 | - |
| `formula_get_data` | 获取公式数据 | - |
| `formula_set_data` | 设置公式数据 | - |
| `formula_set_data_info` | 设置数据信息 | - |
| `formula_exp` | 表达式选股 | - |
| `formula_zb_xg` | 指标选股 | - |
| `formula_zb_xg_exp` | 表达式选股 | - |

#### 3.9 资金流向公式（L2_AMO）
| 公式 | 含义 | 单位 |
|------|------|------|
| L2_AMO(0,0) | 超大单买入 | 元 |
| L2_AMO(0,1) | 超大单卖出 | 元 |
| L2_AMO(1,0) | 大单买入 | 元 |
| L2_AMO(1,1) | 大单卖出 | 元 |
| L2_AMO(2,0) | 中单买入 | 元 |
| L2_AMO(2,1) | 中单卖出 | 元 |
| L2_AMO(3,0) | 小单买入 | 元 |
| L2_AMO(3,1) | 小单卖出 | 元 |

#### 3.10 账户/交易
| 接口名 | 功能 |
|--------|------|
| `stock_account` | 账户句柄 |
| `query_stock_assets` | 账户资产 |
| `query_stock_positions` | 持仓 |
| `query_stock_orders` | 委托 |
| `query_stock_deals` | 成交 |
| `query_new_purchase_limit` | 申购额度 |
| `send_message` | 发送消息 |
| `send_warn` | 发送预警 |

---

## 三、实测验证数据（26项）

| 数据项 | 接口 | 状态 |
|--------|------|------|
| 融资余额(个股) | GP3[0] | ✅ |
| 融券余额(个股) | GP3[1] | ✅ |
| 融资余额(沪深) | SC1[0] | ✅ |
| 融券余额(沪深) | SC1[1] | ✅ |
| 融资换手率 | Fzhsl | ✅ |
| 融资买入金额 | FzAmo | ✅ |
| 市盈率(动态) | DynaPE | ✅ |
| 市盈率(TTM) | StaticPE_TTM | ✅ |
| 市净率(MRQ) | PB_MRQ | ✅ |
| 股息率 | DYRatio | ✅ |
| 市盈率(个股) | GP19 | ✅ |
| 市净率(个股) | GP20 | ✅ |
| 股东人数 | GP1 | ✅ 季末 |
| 主力净流入 | GP11 | ✅ |
| 大单/小单净额 | GP12 | ✅ |
| 中单/超大单净额 | GP13 | ✅ |
| 券商评级 | GP45 | ✅ |
| 综合评分 | GP44 | ✅ |
| 总市值 | GP16 | ✅ |
| 股息率 | GP21 | ✅ |
| 量价指标 | GP28 | ✅ |
| MACD | formula_zb | ✅ |
| KDJ | formula_zb | ✅ |
| RSI | formula_zb | ✅ |
| MA均线 | formula_zb | ✅ |
| 批量MACD | formula_process_mul_zb | ✅ |
| 实时快照 | get_market_snapshot | ✅ |
| 板块PE | BK5 | ✅ |
| 板块PB | BK6 | ✅ |
| 股本数据 | get_gb_info | ✅ |
| 所属板块 | get_relation | ✅ |

---

## 四、问题接口

| 接口 | 问题 | 建议 |
|------|------|------|
| `get_financial_data` | TypeError Bug | 暂时不用 |
| `get_financial_data_by_date` | TypeError Bug | 暂时不用 |
| `get_gp_one_data` | 返回null | 暂时不用 |
| `get_gp_pe` / `get_gp_pb` | 仅TdxQuant | 用GP19/GP20替代 |

---

## 五、部分支持数据

| 数据类别 | 覆盖情况 | 替代方案 |
|----------|----------|----------|
| 龙虎榜 | 部分 | 东方财富网爬虫 |
| 营业部买卖 | 不支持 | 东方财富网爬虫 |
| 大宗交易 | 部分 | 综合信息文件 |
| 股东增减持 | 部分 | GP1对比多期 |
| 机构调研 | 不支持 | Choice/iFinD |
| 公告 | 部分 | 综合信息文件 |
| 异动监控 | 需自研 | subscribe_hq+逻辑判断 |

---

## 六、数据库表映射

| 数据库表 | 数据来源 | 对应接口 |
|----------|----------|----------|
| `stock_daily_kline` | TDX二进制 | - |
| `stock_trading_data` | TQ API | `get_gpjy_value` |
| `stock_basic_info` | TDX二进制 | code2name.ini |
| `stock_capital_data` | TDX二进制 | base.dbf |
| `stock_sector_relation` | TQ API | `get_relation` |
| `technical_indicators` | TQ API | `formula_zb` |
| `sector_*` | TQ API | `get_bkjy_value` |
| `index_*` | TDX二进制 | - |
| `etf_*` | TDX二进制 | - |
| `cb_*` | TDX二进制 | - |
| `kline_*` | TDX二进制 | - |
| `market_trading_data` | TQ API | `get_scjy_value` |
| `trading_calendar` | TQ API | `get_trading_dates` |
| `lhb_*` | 待确认 | ❌ 无直接API |
| `fact_finance_report` | TDX二进制 | gpcw*.dat |
| `financial_data` | - | `get_financial_data` ❌ |

---

## 七、总结

| 类别 | 数量 | 二进制替代 | TQ API | 需爬虫 |
|------|------|-----------|--------|--------|
| K线数据 | 15个表 | ✅ 已有 | - | - |
| 股票基础 | 4个表 | 🆕 可实现 | - | - |
| 板块数据 | 5个表 | 🆕 部分可 | ✅ | - |
| 财务数据 | 2个表 | ✅ 已有(Bug) | ❌ Bug | - |
| 交易数据 | 6个表 | ❌ 无本地 | ✅ | - |
| 龙虎榜 | 9个表 | ❌ 无本地 | ❌ | ✅ |
| **合计** | **70个表** | **~20个** | **~10个** | **~9个** |

---

*整理自 `docs/TDXQuant 完整接口文档3.0.json`*
