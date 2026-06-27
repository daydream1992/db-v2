// real-data.ts — 从 db-v2 仓库真实元数据生成的数据源 (Source of Truth)
// 数据来源: /tmp/db-v2-clone/config/tables.json + data_dictionary.json + Python脚本行数统计
// 生成时间: 2026-06-27
//
// 此文件是元数据的 Source of Truth，mock-data.ts 中的 TABLES 数组基于此生成。
// 当真实元数据更新时，应先更新此文件，再同步到 mock-data.ts。

// ─── 常量 (源自 run.py) ──────────────────────────────────────────────
export const DIR_ORDER = ['1_入库', '2_计算'] as const
export const SCHEDULE_TIERS = {
  daily: ['daily'],
  weekly: ['daily', 'weekly'],
  full: ['daily', 'weekly', 'monthly', 'once'],
} as const
// DB_PATH 已移至 config.ts APP_CONFIG.dbPath，请从那里导入

// ─── 表级元数据 (源自 tables.json, 33 tables + 1 extra view from dict) ───
export interface RealTableConfig {
  table: string
  cn: string
  source: string
  sourceDetail: string
  schedule: string
  mode: string
  dir: string
  sort: number
  dependsOn: string[]
  isView: boolean
  derivedFrom: string | null
  note: string
}

export const REAL_TABLE_CONFIGS: Record<string, RealTableConfig> = {
  capital_info: { table: 'capital_info', cn: '股本数据(近1年)', source: 'tqcenter API', sourceDetail: 'get_gb_info_by_date', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 137, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_daily_kline: { table: 'stock_daily_kline', cn: '股票日K线', source: '二进制', sourceDetail: 'tdx_reader.read_daily()', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 10, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_daily_turnover: { table: 'stock_daily_turnover', cn: '日换手率涨跌幅', source: 'SQL派生', sourceDetail: 'stock_daily_kline+capital_info', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 19, dependsOn: ['stock_daily_kline', 'capital_info'], isView: false, derivedFrom: null, note: '' },
  stock_kline_weekly: { table: 'stock_kline_weekly', cn: '股票周K线', source: 'SQL聚合', sourceDetail: 'stock_daily_kline', schedule: 'weekly', mode: 'full', dir: '2_计算', sort: 17, dependsOn: ['stock_daily_kline'], isView: false, derivedFrom: null, note: '' },
  stock_kline_monthly: { table: 'stock_kline_monthly', cn: '股票月K线', source: 'SQL聚合', sourceDetail: 'stock_daily_kline', schedule: 'monthly', mode: 'full', dir: '2_计算', sort: 18, dependsOn: ['stock_daily_kline'], isView: false, derivedFrom: null, note: '' },
  sector_stocks: { table: 'sector_stocks', cn: '板块成份股', source: '二进制', sourceDetail: 'tdx_reader.read_csi_block() + read_blocknew()', schedule: 'daily', mode: 'full', dir: '1_入库', sort: 33, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_kline_1m: { table: 'stock_kline_1m', cn: '股票分钟K线1m', source: '二进制', sourceDetail: 'tdx_reader.read_1min_parallel() + COPY', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 80, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_kline_5m: { table: 'stock_kline_5m', cn: '股票分钟K线5m', source: '二进制', sourceDetail: 'tdx_reader.read_5min_parallel() + COPY', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 81, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_kline_15m: { table: 'stock_kline_15m', cn: '股票15分钟K线', source: 'SQL聚合', sourceDetail: 'stock_kline_5m', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 82, dependsOn: ['stock_kline_5m'], isView: false, derivedFrom: null, note: '' },
  stock_kline_30m: { table: 'stock_kline_30m', cn: '股票30分钟K线', source: 'SQL聚合', sourceDetail: 'stock_kline_5m', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 83, dependsOn: ['stock_kline_5m'], isView: false, derivedFrom: null, note: '' },
  stock_kline_60m: { table: 'stock_kline_60m', cn: '股票60分钟K线', source: 'SQL聚合', sourceDetail: 'stock_kline_5m', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 84, dependsOn: ['stock_kline_5m'], isView: false, derivedFrom: null, note: '' },
  trading_calendar: { table: 'trading_calendar', cn: '交易日历', source: 'API(TQ)', sourceDetail: 'get_trading_dates', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 91, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  market_sc1_42: { table: 'market_sc1_42', cn: '市场SC宏观指标', source: '二进制', sourceDetail: 'tdx_reader.read_sc()', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 92, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  stock_gp1_46_indicators: { table: 'stock_gp1_46_indicators', cn: '个股GP指标', source: '二进制', sourceDetail: 'tdx_reader.read_gp()', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 93, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  dim_gp_indicator: { table: 'dim_gp_indicator', cn: 'GP指标映射维度表', source: '文档', sourceDetail: '通达信量化平台说明书 get_gpjy_value', schedule: 'once', mode: 'full', dir: '1_入库', sort: 94, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  pianpao_daily: { table: 'pianpao_daily', cn: '骗炮日表', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['stock_daily_kline'], isView: false, derivedFrom: null, note: '' },
  pianpao_daily_summary: { table: 'pianpao_daily_summary', cn: '骗炮日汇总', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['pianpao_daily'], isView: false, derivedFrom: null, note: '' },
  pianpao_intraday: { table: 'pianpao_intraday', cn: '骗炮分时表', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['stock_kline_1m'], isView: false, derivedFrom: null, note: '' },
  pianpao_intraday_events: { table: 'pianpao_intraday_events', cn: '骗炮事件', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['pianpao_intraday'], isView: false, derivedFrom: null, note: '' },
  pianpao_intraday_periods: { table: 'pianpao_intraday_periods', cn: '骗炮分时时段', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['pianpao_intraday'], isView: false, derivedFrom: null, note: '' },
  pianpao_trap_stats: { table: 'pianpao_trap_stats', cn: '骗炮陷阱统计', source: 'pianpao_engine', sourceDetail: '', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 70, dependsOn: ['pianpao_daily'], isView: false, derivedFrom: null, note: '' },
  dim_security_type: { table: 'dim_security_type', cn: '证券类型维表', source: 'SQL派生', sourceDetail: 'stock_daily_kline', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 1, dependsOn: ['stock_daily_kline'], isView: false, derivedFrom: null, note: '' },
  stock_signals_20001_20011: { table: 'stock_signals_20001_20011', cn: '股票信号数据', source: '文本(T0002)', sourceDetail: 'T0002/signals/signals_sys_*.dat', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 95, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  sjb_api_plhqL2kz_88zd: { table: 'sjb_api_plhqL2kz_88zd', cn: 'L2快照88字段', source: 'API(TQ)', sourceDetail: 'get_more_info', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 101, dependsOn: [], isView: false, derivedFrom: null, note: '去重键: HqDate+code' },
  dim_88field_indicator: { table: 'dim_88field_indicator', cn: '88字段映射维度表', source: '文档', sourceDetail: 'TQ get_more_info 字段说明', schedule: 'once', mode: 'full', dir: '1_入库', sort: 102, dependsOn: ['sjb_api_plhqL2kz_88zd'], isView: false, derivedFrom: null, note: '' },
  t_bk5_19: { table: 't_bk5_19', cn: '板块BK交易数据', source: '二进制', sourceDetail: 'tdx_reader.read_bk()', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 34, dependsOn: [], isView: false, derivedFrom: null, note: 'BK05-BK19 宽表，15个指标列' },
  stock_financial_data: { table: 'stock_financial_data', cn: '股票专业财务数据(2026季度)', source: 'API(TQ)', sourceDetail: 'get_financial_data', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 104, dependsOn: [], isView: false, derivedFrom: null, note: '去重键 code+tag_time' },
  market_snapshot: { table: 'market_snapshot', cn: '市场快照数据', source: 'API(TQ)', sourceDetail: 'get_market_snapshot', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 105, dependsOn: [], isView: false, derivedFrom: null, note: '全量证券快照，含五档买卖价' },
  stock_industry_3level: { table: 'stock_industry_3level', cn: '股票行业三级分类', source: 'API(TQ)', sourceDetail: 'get_stock_list(16/17/18) + get_stock_list_in_sector', schedule: 'weekly', mode: 'full', dir: '1_入库', sort: 35, dependsOn: [], isView: false, derivedFrom: null, note: '' },
  dim_industry_code: { table: 'dim_industry_code', cn: '研究行业代码维度表', source: 'SQL派生', sourceDetail: 'stock_industry_3level', schedule: 'weekly', mode: 'full', dir: '2_计算', sort: 36, dependsOn: ['stock_industry_3level'], isView: false, derivedFrom: null, note: '' },
  t_bk5_19_industry_labeled: { table: 't_bk5_19_industry_labeled', cn: '板块BK交易数据_打行业标签', source: '视图(SQL派生)', sourceDetail: 't_bk5_19 LEFT JOIN dim_industry_code', schedule: 'weekly', mode: 'full', dir: '2_计算', sort: 36, dependsOn: ['t_bk5_19'], isView: true, derivedFrom: 't_bk5_19', note: '由 dim_industry_code 脚本同时建视图' },
  stock_block_relation_industry_labeled: { table: 'stock_block_relation_industry_labeled', cn: '股票板块关系_打行业归属', source: '视图(SQL派生)', sourceDetail: 'stock_block_relation LEFT JOIN stock_industry_3level', schedule: 'daily', mode: 'increment', dir: '2_计算', sort: 36, dependsOn: ['stock_block_relation'], isView: true, derivedFrom: 'stock_block_relation', note: '由 dim_industry_code 脚本同时建视图' },
  stock_block_relation: { table: 'stock_block_relation', cn: '股票板块关系', source: 'API(TQ)', sourceDetail: 'get_relation', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 262, dependsOn: [], isView: false, derivedFrom: null, note: '去重键 stock_code+板块代码+fetch_time' },
  stock_gp1_46_indicators_labeled: { table: 'stock_gp1_46_indicators_labeled', cn: '[VIEW] 个股GP指标 - 带字段含义', source: '视图(SQL派生)', sourceDetail: 'stock_gp1_46_indicators LEFT JOIN dim_gp_indicator', schedule: 'daily', mode: 'increment', dir: '1_入库', sort: 93, dependsOn: ['stock_gp1_46_indicators'], isView: true, derivedFrom: 'stock_gp1_46_indicators', note: '' },
}

// ─── 脚本行数统计 (源自 wc -l) ──────────────────────────────────────
export const SCRIPT_LINE_COUNTS: Record<string, number> = {
  '10_stock_daily_kline.py': 105,
  '33_sector_stocks.py': 61,
  '34_t_bk5_19_.py': 216,
  '35_stock_industry_3level.py': 200,
  '080_stock_kline_1m.py': 113,
  '081_stock_kline_5m.py': 110,
  '91_trading_calendar.py': 136,
  '92_market_sc1_42.py': 172,
  '93_stock_gp1_46_indicators.py': 153,
  '95_stock_signals_20001_20011.py': 87,
  '101_jb_api_plhqL2kz_88zd.py': 379,
  '104_stock_financial_data.py': 328,
  '105_market_snapshot.py': 165,
  '137_capital_info.py': 230,
  '262_stock_block_relation.py': 183,
  '001_dim_security_type_sync.py': 115,
  '17_stock_kline_weekly.py': 78,
  '18_stock_kline_monthly.py': 78,
  '19_stock_daily_turnover.py': 135,
  '36_dim_industry_code.py': 117,
  '70_pianpao_daily.py': 124,
  '71_pianpao_batch.py': 171,
  '82_stock_kline_15m.py': 119,
  '83_stock_kline_30m.py': 119,
  '84_stock_kline_60m.py': 119,
}

// ─── 列定义 (源自 data_dictionary.json) ─────────────────────────────
export interface DictColumn {
  name: string
  type: string
  cn: string
}

export const DATA_DICTIONARY: Record<string, { cn: string; columns: DictColumn[] }> = {
  stock_kline_1m: { cn: '股票分钟K线1m', columns: [
    { name: 'code', type: 'VARCHAR', cn: '证券代码' }, { name: 'open', type: 'DOUBLE', cn: '今开' },
    { name: 'high', type: 'DOUBLE', cn: '最高' }, { name: 'low', type: 'DOUBLE', cn: '最低' },
    { name: 'close', type: 'DOUBLE', cn: '收盘价' }, { name: 'volume', type: 'BIGINT', cn: '成交量' },
    { name: 'amount', type: 'DOUBLE', cn: '成交额' }, { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间' },
  ]},
  stock_kline_5m: { cn: '股票分钟K线5m', columns: [
    { name: 'code', type: 'VARCHAR', cn: '证券代码' }, { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间' },
    { name: 'open', type: 'DOUBLE', cn: '今开' }, { name: 'high', type: 'DOUBLE', cn: '最高' },
    { name: 'low', type: 'DOUBLE', cn: '最低' }, { name: 'close', type: 'DOUBLE', cn: '收盘价' },
    { name: 'volume', type: 'BIGINT', cn: '成交量' }, { name: 'amount', type: 'DOUBLE', cn: '成交额' },
  ]},
  stock_daily_kline: { cn: '股票日K线', columns: [
    { name: 'code', type: 'VARCHAR', cn: '证券代码' }, { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）' },
    { name: 'open', type: 'DOUBLE', cn: '今开' }, { name: 'high', type: 'DOUBLE', cn: '最高' },
    { name: 'low', type: 'DOUBLE', cn: '最低' }, { name: 'close', type: 'DOUBLE', cn: '收盘价' },
    { name: 'volume', type: 'BIGINT', cn: '成交量' }, { name: 'amount', type: 'DOUBLE', cn: '成交额' },
    { name: '涨跌幅', type: 'DOUBLE', cn: '涨跌幅' }, { name: '换手率', type: 'INTEGER', cn: '换手率' },
    { name: '前复权因子', type: 'INTEGER', cn: '前复权因子' },
  ]},
  capital_info: { cn: '股本数据(近1年)', columns: [
    { name: 'code', type: 'VARCHAR', cn: '股票代码(带交易所后缀)' }, { name: 'date', type: 'DATE', cn: '日期' },
    { name: 'zgb', type: 'DOUBLE', cn: '总股本(股)' }, { name: 'ltgb', type: 'DOUBLE', cn: '流通股本(股)' },
    { name: 'updated_at', type: 'TIMESTAMP', cn: '入库时间' },
  ]},
  trading_calendar: { cn: '交易日历', columns: [
    { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）' }, { name: 'is_trading', type: 'BOOLEAN', cn: '是否交易日' },
    { name: 'market', type: 'VARCHAR', cn: '所属市场' },
  ]},
  stock_daily_turnover: { cn: '日换手率涨跌幅', columns: [
    { name: 'code', type: 'VARCHAR', cn: '股票代码(带后缀)' }, { name: 'date', type: 'DATE', cn: '日期' },
    { name: 'turnover', type: 'DOUBLE', cn: '换手率%(成交量/流通股本*100)' },
    { name: 'pct_chg', type: 'DOUBLE', cn: '涨跌幅%((close-前日close)/前日close*100)' },
  ]},
  // Full data dictionary available in /tmp/db-v2-clone/config/data_dictionary.json
  // Key tables listed above; all 34 tables have column data in the generated TABLES export
}
