// DataOps 管理台 mock 数据
// 基于真实脚本清单 (26 个 active 表) + 诊断报告里的 8 个 bug + lint issues

export type TableType = '事实' | '维度' | '视图' | '多表' | '孤儿' | '测试'
export type Dir = '1_入库' | '2_计算' | '3_策略' | '4_工具'
export type Schedule = 'daily' | 'weekly' | 'monthly' | 'once'
export type Mode = 'increment' | 'full'
export type Freshness = '最新' | '滞后' | '无日期列' | '空表' | '—'
export type HealthColor = 'green' | 'yellow' | 'red' | 'white'
export type LintLevel = 'RED' | 'YELLOW' | 'BLUE'
export type RunStatus = 'success' | 'failed' | 'skipped' | 'running' | 'pending'
export type Trigger = 'schedule' | 'manual' | 'health-fix' | 'backfill'

export interface ColumnDef {
  name: string
  type: string
  cn: string
  nullable: boolean
}

export interface TableMeta {
  table: string
  cn: string
  dir: Dir
  sort: string
  schedule: Schedule
  mode: Mode
  source: string
  type: TableType
  rows: number
  maxDate: string | null
  dateCol: string | null
  freshness: Freshness
  health: HealthColor
  script: string
  scriptLines: number
  hasLintIssue: boolean
  dependsOn: string[]      // 上游库内表
  sourceDeps: string[]     // 外部源 (tq.xxx / TDX文件)
  downstream: string[]     // 下游表
  columns: ColumnDef[]
  dedupKey: string[]
  retryConfig: { max: number; backoff: number }
}

// 26 个真实表清单
export const TABLES: TableMeta[] = [
  {
    table: 'stock_daily_kline', cn: '股票日K线', dir: '1_入库', sort: '010',
    schedule: 'daily', mode: 'increment', source: '二进制(.day)', type: '事实',
    rows: 9_840_000, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '10_stock_daily_kline.py', scriptLines: 105, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX vipdoc/lday'],
    downstream: ['stock_kline_weekly', 'stock_kline_monthly', 'dim_security_type', 'pianpao_daily', 'stock_daily_turnover'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
      { name: '涨跌幅', type: 'DOUBLE', cn: '涨跌幅%', nullable: true },
      { name: '换手率', type: 'DOUBLE', cn: '换手率%', nullable: true },
      { name: '前复权因子', type: 'DOUBLE', cn: '前复权因子', nullable: true },
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'trading_calendar', cn: '交易日历', dir: '1_入库', sort: '091',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_trading_dates)', type: '维度',
    rows: 7_300, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '91_trading_calendar.py', scriptLines: 136, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['tq.get_trading_dates'],
    downstream: ['stock_daily_kline', 'capital_info', 'pianpao_daily'],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'is_trading', type: 'BOOLEAN', cn: '是否交易日', nullable: false },
      { name: 'market', type: 'VARCHAR', cn: '市场', nullable: false },
    ],
    dedupKey: ['date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_1m', cn: '股票分钟K线1m', dir: '1_入库', sort: '080',
    schedule: 'daily', mode: 'increment', source: '二进制(.lc1)', type: '事实',
    rows: 198_000_000, maxDate: '2026-06-25', dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '080_stock_kline_1m.py', scriptLines: 113, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX vipdoc/minline'],
    downstream: ['pianpao_daily', 'pianpao_intraday'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_5m', cn: '股票分钟K线5m', dir: '1_入库', sort: '081',
    schedule: 'daily', mode: 'increment', source: '二进制(.lc5)', type: '事实',
    rows: 39_600_000, maxDate: '2026-06-25', dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '081_stock_kline_5m.py', scriptLines: 110, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['TDX vipdoc/minline'],
    downstream: ['stock_kline_15m', 'stock_kline_30m', 'stock_kline_60m'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_15m', cn: '股票15分钟K线', dir: '2_计算', sort: '082',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合(stock_kline_5m)', type: '事实',
    rows: 13_200_000, maxDate: '2026-06-25', dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '82_stock_kline_15m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_30m', cn: '股票30分钟K线', dir: '2_计算', sort: '083',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合(stock_kline_5m)', type: '事实',
    rows: 6_600_000, maxDate: '2026-06-25', dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '83_stock_kline_30m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_60m', cn: '股票60分钟K线', dir: '2_计算', sort: '084',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合(stock_kline_5m)', type: '事实',
    rows: 3_300_000, maxDate: '2026-06-25', dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '84_stock_kline_60m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_weekly', cn: '股票周K线', dir: '2_计算', sort: '017',
    schedule: 'weekly', mode: 'full', source: 'SQL聚合(stock_daily_kline)', type: '事实',
    rows: 1_960_000, maxDate: '2026-06-20', dateCol: 'date', freshness: '最新', health: 'green',
    script: '17_stock_kline_weekly.py', scriptLines: 78, hasLintIssue: false,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '周日期', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_monthly', cn: '股票月K线', dir: '2_计算', sort: '018',
    schedule: 'monthly', mode: 'full', source: 'SQL聚合(stock_daily_kline)', type: '事实',
    rows: 490_000, maxDate: '2026-05-31', dateCol: 'date', freshness: '最新', health: 'green',
    script: '18_stock_kline_monthly.py', scriptLines: 78, hasLintIssue: false,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '月日期', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '开盘价', nullable: false },
      { name: 'high', type: 'DOUBLE', cn: '最高价', nullable: false },
      { name: 'low', type: 'DOUBLE', cn: '最低价', nullable: false },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: false },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: false },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: false },
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_daily_turnover', cn: '日换手率', dir: '2_计算', sort: '019',
    schedule: 'daily', mode: 'increment', source: 'SQL派生(stock_daily_kline)', type: '事实',
    rows: 9_840_000, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '19_stock_daily_turnover.py', scriptLines: 135, hasLintIssue: false,
    dependsOn: ['stock_daily_kline', 'capital_info'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'turnover', type: 'DOUBLE', cn: '换手率%', nullable: false },
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_security_type', cn: '证券类型维表', dir: '2_计算', sort: '001',
    schedule: 'daily', mode: 'increment', source: 'SQL派生(stock_daily_kline)', type: '维度',
    rows: 12_400, maxDate: '2026-06-25', dateCol: 'updated_at', freshness: '最新', health: 'green',
    script: '001_dim_security_type_sync.py', scriptLines: 115, hasLintIssue: false,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: ['pianpao_daily'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'type', type: 'VARCHAR', cn: '类型', nullable: false },
      { name: 'market', type: 'VARCHAR', cn: '市场', nullable: false },
      { name: 'prefix', type: 'VARCHAR', cn: '前缀', nullable: false },
      { name: 'is_active', type: 'BOOLEAN', cn: '是否活跃', nullable: false },
      { name: 'created_at', type: 'TIMESTAMP', cn: '创建时间', nullable: false },
      { name: 'updated_at', type: 'TIMESTAMP', cn: '更新时间', nullable: false },
    ],
    dedupKey: ['code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_industry_code', cn: '行业代码维表', dir: '2_计算', sort: '036',
    schedule: 'once', mode: 'full', source: 'SQL派生(stock_industry_3level)', type: '维度',
    rows: 320, maxDate: '2026-06-20', dateCol: null, freshness: '—', health: 'white',
    script: '36_dim_industry_code.py', scriptLines: 117, hasLintIssue: false,
    dependsOn: ['stock_industry_3level'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'industry_code', type: 'VARCHAR', cn: '行业代码', nullable: false },
      { name: 'level1', type: 'VARCHAR', cn: '一级行业', nullable: false },
      { name: 'level2', type: 'VARCHAR', cn: '二级行业', nullable: false },
      { name: 'level3', type: 'VARCHAR', cn: '三级行业', nullable: false },
    ],
    dedupKey: ['industry_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'capital_info', cn: '股本数据(近1年)', dir: '1_入库', sort: '137',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_gb_info_by_date)', type: '事实',
    rows: 2_980_000, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '137_capital_info.py', scriptLines: 230, hasLintIssue: true,
    dependsOn: ['stock_daily_kline', 'trading_calendar'], sourceDeps: ['tq.get_gb_info_by_date'],
    downstream: ['stock_daily_turnover'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码(带后缀)', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'zgb', type: 'DOUBLE', cn: '总股本(股)', nullable: false },
      { name: 'ltgb', type: 'DOUBLE', cn: '流通股本(股)', nullable: false },
      { name: 'updated_at', type: 'TIMESTAMP', cn: '入库时间', nullable: false },
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_financial_data', cn: '股票专业财务数据(2026)', dir: '1_入库', sort: '104',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_financial_data)', type: '事实',
    rows: 8_600, maxDate: '2026-06-25', dateCol: 'tag_time', freshness: '最新', health: 'green',
    script: '104_stock_financial_data.py', scriptLines: 328, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_financial_data'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'announce_time', type: 'BIGINT', cn: '公告日期', nullable: false },
      { name: 'tag_time', type: 'BIGINT', cn: '报告期', nullable: false },
      { name: 'FN1', type: 'DOUBLE', cn: '基本每股收益', nullable: true },
      { name: 'FN134', type: 'DOUBLE', cn: '净利润', nullable: true },
      { name: 'fetch_time', type: 'VARCHAR', cn: '采集时间', nullable: false },
    ],
    dedupKey: ['code', 'tag_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'sjb_api_plhqL2kz_88zd', cn: 'L2快照88字段', dir: '1_入库', sort: '101',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_more_info)', type: '事实',
    rows: 5_400, maxDate: '2026-06-25', dateCol: 'HqDate', freshness: '最新', health: 'green',
    script: '101_jb_api_plhqL2kz_88zd.py', scriptLines: 379, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_more_info'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'HqDate', type: 'VARCHAR', cn: '行情日期', nullable: false },
      { name: 'ZAF', type: 'DOUBLE', cn: '日涨跌幅%', nullable: true },
      { name: 'Ltsz', type: 'DOUBLE', cn: '流通市值_万', nullable: true },
      { name: 'fetch_time', type: 'VARCHAR', cn: '查询时间', nullable: false },
    ],
    dedupKey: ['HqDate', 'code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_block_relation', cn: '股票板块关系', dir: '1_入库', sort: '262',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_relation)', type: '事实',
    rows: 142_000, maxDate: '2026-06-25', dateCol: 'fetch_time', freshness: '最新', health: 'green',
    script: '262_stock_block_relation.py', scriptLines: 183, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['tq.get_relation'],
    downstream: [],
    columns: [
      { name: 'stock_code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: '板块代码', type: 'VARCHAR', cn: '板块代码', nullable: false },
      { name: '板块名称', type: 'VARCHAR', cn: '板块名称', nullable: false },
      { name: '板块类型', type: 'VARCHAR', cn: '板块类型', nullable: false },
      { name: '成分股数', type: 'INTEGER', cn: '成分股数', nullable: true },
      { name: 'fetch_time', type: 'TIMESTAMP', cn: '采集时间', nullable: false },
    ],
    dedupKey: ['stock_code', '板块代码', 'fetch_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'market_sc1_42', cn: '市场SC宏观指标', dir: '1_入库', sort: '092',
    schedule: 'daily', mode: 'increment', source: '二进制(gpsh999999.dat)', type: '事实',
    rows: 7_300, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '92_market_sc1_42.py', scriptLines: 172, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX gpsh999999.dat'],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: '涨跌数', type: 'DOUBLE', cn: '涨跌数', nullable: true },
      { name: '总市值', type: 'DOUBLE', cn: '总市值(亿)', nullable: true },
    ],
    dedupKey: ['date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_gp1_46_indicators', cn: '个股GP1-46指标', dir: '1_入库', sort: '093',
    schedule: 'daily', mode: 'increment', source: '二进制(gpsz*.dat)', type: '事实',
    rows: 28_600_000, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '93_stock_gp1_46_indicators.py', scriptLines: 153, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['TDX gpsz/gpsh/gpbj'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'gp_code', type: 'VARCHAR', cn: 'GP指标编号', nullable: false },
      { name: 'value', type: 'DOUBLE', cn: '指标值', nullable: true },
    ],
    dedupKey: ['code', 'date', 'gp_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_signals_20001_20011', cn: '股票信号数据', dir: '1_入库', sort: '095',
    schedule: 'daily', mode: 'increment', source: '文本(T0002/signals)', type: '事实',
    rows: 860_000, maxDate: '2026-06-25', dateCol: 'date', freshness: '最新', health: 'green',
    script: '95_stock_signals_20001_20011.py', scriptLines: 87, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['TDX T0002/signals'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'signal_code', type: 'VARCHAR', cn: '信号代码', nullable: false },
      { name: 'signal_name', type: 'VARCHAR', cn: '信号名称', nullable: false },
      { name: 'value', type: 'DOUBLE', cn: '信号值', nullable: true },
    ],
    dedupKey: ['code', 'date', 'signal_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_industry_3level', cn: '三级行业分类', dir: '1_入库', sort: '035',
    schedule: 'once', mode: 'full', source: 'API(TQ)', type: '维度',
    rows: 320, maxDate: null, dateCol: null, freshness: '—', health: 'white',
    script: '35_stock_industry_3level.py', scriptLines: 200, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_industry'],
    downstream: ['dim_industry_code'],
    columns: [
      { name: 'industry_code', type: 'VARCHAR', cn: '行业代码', nullable: false },
      { name: 'level1_name', type: 'VARCHAR', cn: '一级行业', nullable: false },
      { name: 'level2_name', type: 'VARCHAR', cn: '二级行业', nullable: false },
      { name: 'level3_name', type: 'VARCHAR', cn: '三级行业', nullable: false },
    ],
    dedupKey: ['industry_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'pianpao_daily', cn: '骗炮每日明细', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'SQL派生(多表)', type: '多表',
    rows: 4_960, maxDate: '2026-06-25', dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '70_pianpao_daily.py', scriptLines: 124, hasLintIssue: false,
    dependsOn: ['stock_daily_kline', 'stock_kline_1m', 'dim_security_type'], sourceDeps: [],
    downstream: ['pianpao_daily_summary', 'pianpao_intraday', 'pianpao_intraday_events', 'pianpao_intraday_periods'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'trade_date', type: 'DATE', cn: '交易日', nullable: false },
      { name: 'score', type: 'DOUBLE', cn: '骗炮评分', nullable: false },
    ],
    dedupKey: ['code', 'trade_date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'pianpao_daily_summary', cn: '骗炮每日汇总', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'SQL派生(pianpao_daily)', type: '事实',
    rows: 24, maxDate: '2026-06-25', dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '70_pianpao_daily.py', scriptLines: 124, hasLintIssue: false,
    dependsOn: ['pianpao_daily'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日', nullable: false },
      { name: 'total_count', type: 'INTEGER', cn: '候选总数', nullable: false },
      { name: 'a_count', type: 'INTEGER', cn: 'A级数', nullable: false },
    ],
    dedupKey: ['trade_date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'sector_stocks', cn: '板块成份股', dir: '1_入库', sort: '033',
    schedule: 'daily', mode: 'full', source: '二进制', type: '孤儿',
    rows: 0, maxDate: null, dateCol: null, freshness: '空表', health: 'red',
    script: '33_sector_stocks.py', scriptLines: 61, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX (未实现)'],
    downstream: [],
    columns: [
      { name: 'sector_code', type: 'VARCHAR', cn: '板块代码', nullable: false },
      { name: 'stock_code', type: 'VARCHAR', cn: '股票代码', nullable: false },
    ],
    dedupKey: [], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 't_bk5_19', cn: '板块BK交易数据', dir: '1_入库', sort: '034',
    schedule: 'daily', mode: 'full', source: '二进制(gpsh*.dat)', type: '事实',
    rows: 86_000, maxDate: '2026-06-24', dateCol: 'date', freshness: '滞后', health: 'red',
    script: '34_t_bk5_19_.py', scriptLines: 216, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX gpsh*.dat'],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'code', type: 'VARCHAR', cn: '板块代码', nullable: false },
      { name: 'bk_name', type: 'VARCHAR', cn: '板块名称', nullable: false },
      { name: 'pe_ttm', type: 'DOUBLE', cn: '市盈率TTM', nullable: true },
      { name: '涨跌数', type: 'DOUBLE', cn: '涨跌数', nullable: true },
    ],
    dedupKey: ['date', 'code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'market_snapshot', cn: '市场快照', dir: '1_入库', sort: '105',
    schedule: 'daily', mode: 'increment', source: 'API(TQ:get_market_snapshot)', type: '事实',
    rows: 5_400, maxDate: '2026-06-25', dateCol: 'snapshot_date', freshness: '最新', health: 'green',
    script: '105_market_snapshot.py', scriptLines: 165, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_market_snapshot'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'snapshot_date', type: 'DATE', cn: '快照日期', nullable: false },
      { name: 'price', type: 'DOUBLE', cn: '现价', nullable: false },
    ],
    dedupKey: ['code', 'snapshot_date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_gp_indicator', cn: 'GP指标维度表', dir: '1_入库', sort: '094',
    schedule: 'once', mode: 'full', source: '文档', type: '维度',
    rows: 48, maxDate: null, dateCol: null, freshness: '—', health: 'white',
    script: '(内置文档表)', scriptLines: 135, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['通达信说明书'],
    downstream: ['stock_gp1_46_indicators'],
    columns: [
      { name: 'gp_code', type: 'VARCHAR', cn: 'GP编号', nullable: false },
      { name: 'gp_name', type: 'VARCHAR', cn: '指标名称', nullable: false },
      { name: 'unit', type: 'VARCHAR', cn: '单位', nullable: true },
    ],
    dedupKey: ['gp_code'], retryConfig: { max: 3, backoff: 30 },
  },
]

// Lint 规则与违规
export interface LintRule {
  id: string
  name: string
  level: LintLevel
  description: string
  violations: { table: string; detail: string; fix: string }[]
}

export const LINT_RULES: LintRule[] = [
  {
    id: 'R001', name: '表名格式', level: 'RED',
    description: '表名必须纯小写下划线，禁数字开头',
    violations: [],
  },
  {
    id: 'R002', name: '@meta与代码常量一致', level: 'RED',
    description: 'YAML 的 mode/schedule 必须与脚本常量 MODE/SCHEDULE 一致',
    violations: [
      { table: 't_bk5_19', detail: '@meta mode=increment 但代码 MODE="full"', fix: '统一为 full（全量重灌语义）' },
    ],
  },
  {
    id: 'R003', name: '契约签名规范', level: 'RED',
    description: '入库脚本必须实现 BaseIngest 子类或标准 fetch_data/save_data 签名',
    violations: [
      { table: 'stock_daily_kline', detail: 'fetch_data(con) 但属 1_入库（应为无参）', fix: '改为 fetch_data() 或迁 BaseIngest' },
      { table: 'stock_kline_1m', detail: 'fetch_data(min_date) 生成器签名', fix: '迁 BaseIngest 流式模式' },
      { table: 'capital_info', detail: 'fetch_and_save(con,force) 无 fetch_data/save_data', fix: '拆分为 fetch+save 或迁 BaseIngest' },
      { table: 'pianpao_daily', detail: 'run(target_date,force,report_only) 签名异常', fix: '统一 run(force) 入口' },
    ],
  },
  {
    id: 'R004', name: '列名禁中文禁空格', level: 'RED',
    description: '列名必须全小写下划线，中文含义放 FIELD_MAP / dim 表',
    violations: [
      { table: 'stock_daily_kline', detail: '列 涨跌幅/换手率/前复权因子 含中文', fix: 'rename 为 change_pct/turnover/adj_factor' },
      { table: 'stock_block_relation', detail: '列 板块代码/板块名称/板块类型/成分股数 含中文', fix: 'rename 为 block_code/block_name/block_type/constituent_count' },
      { table: 'market_sc1_42', detail: '列 涨跌数/总市值 含中文', fix: 'rename 为 up_down_count/total_mv' },
      { table: 't_bk5_19', detail: '列 涨跌数/总市值 中英混用', fix: '统一英文列名' },
    ],
  },
  {
    id: 'R005', name: 'sort编号唯一', level: 'RED',
    description: 'sort 编号全局唯一，禁撞号',
    violations: [],
  },
  {
    id: 'R006', name: 'increment必须声明dedup_key', level: 'YELLOW',
    description: '增量模式的表必须声明去重键，避免重复行',
    violations: [
      { table: 'sector_stocks', detail: 'mode=full 但 sort=033 与废弃脚本冲突风险', fix: '确认编号' },
    ],
  },
  {
    id: 'R007', name: '必须声明date_col', level: 'YELLOW',
    description: '每表需声明 date_col 用于健康度/新鲜度判定',
    violations: [],
  },
  {
    id: 'R008', name: '血缘无环', level: 'RED',
    description: 'depends_on 构成的 DAG 不得有环',
    violations: [],
  },
  {
    id: 'R009', name: '禁止循环import', level: 'RED',
    description: '入库脚本禁止 import run.py（反依赖方向）',
    violations: [
      { table: 'capital_info', detail: 'from run import _last_trading_day', fix: '抽到 common/trading.py' },
    ],
  },
  {
    id: 'R010', name: '占位@meta清理', level: 'YELLOW',
    description: '工具/策略脚本不得带 @meta table=（会被误收录为数据表）',
    violations: [
      { table: '(check_health.py)', detail: '@meta table=- 占位符', fix: '删除 @meta 行' },
      { table: '(gen_skeleton.py)', detail: '@meta table=skeleton 误标', fix: '删除 @meta 行' },
      { table: '(ingest_plan.py)', detail: '@meta table=kline_ingest_plan 误标', fix: '删除 @meta 行' },
    ],
  },
  {
    id: 'R011', name: 'DB_PATH统一来源', level: 'BLUE',
    description: 'DB_PATH 应来自 common/config，禁散落硬编码（当前 49 处）',
    violations: [
      { table: '(全局)', detail: '49 个文件硬编码 DB_PATH', fix: '迁 common/config.DB_PATH' },
    ],
  },
  {
    id: 'R012', name: 'TQ初始化不重复', level: 'BLUE',
    description: 'TQ 初始化样板应抽 common/tq_client（当前 9 份重复）',
    violations: [
      { table: '(全局)', detail: '9 个脚本重复 TQ_PATHS+initialize 样板', fix: '迁 common/tq_client.init_tq()' },
    ],
  },
]

// 执行历史
export interface PipelineRun {
  id: number
  table: string
  runId: string
  trigger: Trigger
  status: RunStatus
  startedAt: string
  finishedAt: string | null
  durationSec: number | null
  rowsIn: number | null
  error: string | null
  force: boolean
  logPath: string | null
}

export const PIPELINE_RUNS: PipelineRun[] = [
  { id: 1, table: 'trading_calendar', runId: 'r-202606251700-001', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 17:00:12', finishedAt: '2026-06-25 17:00:18', durationSec: 6, rowsIn: 1, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 2, table: 'stock_daily_kline', runId: 'r-202606251700-002', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 17:00:18', finishedAt: '2026-06-25 17:04:42', durationSec: 264, rowsIn: 4960, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 3, table: 'stock_kline_5m', runId: 'r-202606251700-003', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 17:04:42', finishedAt: '2026-06-25 17:22:15', durationSec: 1053, rowsIn: 198000, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 4, table: 'stock_kline_1m', runId: 'r-202606251700-004', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 17:22:15', finishedAt: '2026-06-25 18:15:33', durationSec: 3198, rowsIn: 990000, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 5, table: 'capital_info', runId: 'r-202606251700-005', trigger: 'schedule', status: 'failed', startedAt: '2026-06-25 18:15:33', finishedAt: '2026-06-25 18:16:01', durationSec: 28, rowsIn: 0, error: 'tqcenter 连接超时 (get_gb_info_by_date)', force: false, logPath: 'logs/run_20260625.log' },
  { id: 6, table: 'capital_info', runId: 'r-202606251720-006', trigger: 'health-fix', status: 'success', startedAt: '2026-06-25 18:20:00', finishedAt: '2026-06-25 18:38:44', durationSec: 1124, rowsIn: 2980000, error: null, force: true, logPath: 'logs/run_20260625.log' },
  { id: 7, table: 'stock_financial_data', runId: 'r-202606251700-007', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 18:38:44', finishedAt: '2026-06-25 18:42:10', durationSec: 206, rowsIn: 8600, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 8, table: 't_bk5_19', runId: 'r-202606251700-008', trigger: 'schedule', status: 'failed', startedAt: '2026-06-25 18:42:10', finishedAt: '2026-06-25 18:42:12', durationSec: 2, rowsIn: 0, error: '@meta mode=increment 与 MODE="full" 矛盾，DELETE 逻辑错乱', force: false, logPath: 'logs/run_20260625.log' },
  { id: 9, table: 'sector_stocks', runId: 'r-202606251700-009', trigger: 'schedule', status: 'skipped', startedAt: '2026-06-25 18:42:12', finishedAt: '2026-06-25 18:42:12', durationSec: 0, rowsIn: 0, error: 'ensure_table 字面量 "表名" 未实现', force: false, logPath: null },
  { id: 10, table: 'pianpao_daily', runId: 'r-202606251700-010', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 18:42:12', finishedAt: '2026-06-25 18:48:55', durationSec: 403, rowsIn: 4960, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 11, table: 'stock_kline_15m', runId: 'r-202606251700-011', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 18:48:55', finishedAt: '2026-06-25 18:55:22', durationSec: 387, rowsIn: 66000, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 12, table: 'stock_kline_30m', runId: 'r-202606251700-012', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 18:55:22', finishedAt: '2026-06-25 18:58:40', durationSec: 198, rowsIn: 33000, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 13, table: 'stock_kline_60m', runId: 'r-202606251700-013', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 18:58:40', finishedAt: '2026-06-25 19:00:15', durationSec: 95, rowsIn: 16500, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 14, table: 'dim_security_type', runId: 'r-202606251700-014', trigger: 'schedule', status: 'success', startedAt: '2026-06-25 19:00:15', finishedAt: '2026-06-25 19:00:22', durationSec: 7, rowsIn: 12400, error: null, force: false, logPath: 'logs/run_20260625.log' },
  { id: 15, table: 't_bk5_19', runId: 'r-202606251905-015', trigger: 'manual', status: 'running', startedAt: '2026-06-25 19:05:00', finishedAt: null, durationSec: null, rowsIn: null, error: null, force: true, logPath: 'logs/run_20260625.log' },
]

// 日志
export interface LogEntry {
  ts: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
  table: string
  message: string
}

export const LOGS: LogEntry[] = [
  { ts: '2026-06-25 17:00:12', level: 'INFO', table: 'trading_calendar', message: '▶ 开始 trading_calendar' },
  { ts: '2026-06-25 17:00:18', level: 'INFO', table: 'trading_calendar', message: '✔ trading_calendar 入库完成，共 1 条' },
  { ts: '2026-06-25 17:00:18', level: 'INFO', table: 'stock_daily_kline', message: '▶ 开始 stock_daily_kline' },
  { ts: '2026-06-25 17:00:19', level: 'INFO', table: 'stock_daily_kline', message: '  增量模式，最小日期: 20260626' },
  { ts: '2026-06-25 17:04:42', level: 'INFO', table: 'stock_daily_kline', message: '✔ stock_daily_kline 完成，共 4,960 条' },
  { ts: '2026-06-25 17:04:42', level: 'INFO', table: 'stock_kline_5m', message: '▶ 开始 stock_kline_5m' },
  { ts: '2026-06-25 17:22:15', level: 'INFO', table: 'stock_kline_5m', message: '✔ stock_kline_5m 完成，共 198,000 条' },
  { ts: '2026-06-25 18:15:33', level: 'INFO', table: 'capital_info', message: '▶ 开始 capital_info' },
  { ts: '2026-06-25 18:16:01', level: 'ERROR', table: 'capital_info', message: '✘ capital_info 失败: tqcenter 连接超时 (get_gb_info_by_date)' },
  { ts: '2026-06-25 18:20:00', level: 'INFO', table: 'capital_info', message: '▶ 重跑 capital_info (force=True) ...' },
  { ts: '2026-06-25 18:38:44', level: 'INFO', table: 'capital_info', message: '✔ capital_info 完成: 2,980,000 行, 失败 0 股' },
  { ts: '2026-06-25 18:42:10', level: 'ERROR', table: 't_bk5_19', message: '✘ t_bk5_19 失败: @meta mode=increment 与 MODE="full" 矛盾，DELETE 逻辑错乱' },
  { ts: '2026-06-25 18:42:12', level: 'WARNING', table: 'sector_stocks', message: '○ sector_stocks 数据为空，跳过 (ensure_table 字面量 "表名" 未实现)' },
  { ts: '2026-06-25 18:42:12', level: 'INFO', table: 'pianpao_daily', message: '▶ 骗炮分析 2026-06-25' },
  { ts: '2026-06-25 18:48:55', level: 'INFO', table: 'pianpao_daily', message: '✔ pianpao_daily 完成' },
  { ts: '2026-06-25 19:05:00', level: 'INFO', table: 't_bk5_19', message: '▶ 手动触发 t_bk5_19 (force=True) ...' },
  { ts: '2026-06-25 19:05:15', level: 'DEBUG', table: 't_bk5_19', message: '  读取 gpsh*.dat 文件 32/32' },
]

// 调度计划
export interface Schedule {
  name: string
  cron: string
  tier: Schedule | 'all'
  nextRun: string
  lastStatus: RunStatus | null
  tables: number
}

export const SCHEDULES: Schedule[] = [
  { name: 'daily_1700', cron: '0 17 * * 1-5', tier: 'daily', nextRun: '2026-06-26 17:00', lastStatus: 'success', tables: 18 },
  { name: 'weekly_friday', cron: '0 18 * * 5', tier: 'weekly', nextRun: '2026-06-27 18:00', lastStatus: 'success', tables: 1 },
  { name: 'monthly_last', cron: '0 19 28-31 * *', tier: 'monthly', nextRun: '2026-06-30 19:00', lastStatus: 'success', tables: 1 },
  { name: 'once_init', cron: '手动', tier: 'once', nextRun: '—', lastStatus: null, tables: 3 },
]

// 告警
export interface Alert {
  id: string
  level: 'red' | 'yellow'
  table: string
  type: 'health' | 'lint' | 'run'
  message: string
  ts: string
}

export const ALERTS: Alert[] = [
  { id: 'a1', level: 'red', table: 't_bk5_19', type: 'health', message: '滞后：最新数据 2026-06-24 < 最后交易日 2026-06-25（交易日历校验）', ts: '2026-06-25 19:00' },
  { id: 'a2', level: 'red', table: 'sector_stocks', type: 'health', message: '空表（脚本未实现，ensure_table 字面量"表名"）', ts: '2026-06-25 19:00' },
  { id: 'a3', level: 'red', table: 't_bk5_19', type: 'lint', message: 'R002: @meta mode 与代码 MODE 矛盾', ts: '2026-06-25 19:00' },
  { id: 'a4', level: 'red', table: 'capital_info', type: 'lint', message: 'R009: 反向 import run.py（循环依赖）', ts: '2026-06-25 19:00' },
  { id: 'a5', level: 'yellow', table: 'stock_daily_kline', type: 'lint', message: 'R004: 列名含中文 (涨跌幅/换手率/前复权因子)', ts: '2026-06-25 19:00' },
  { id: 'a6', level: 'yellow', table: 'stock_block_relation', type: 'lint', message: 'R004: 列名含中文 (板块代码/板块名称/板块类型/成分股数)', ts: '2026-06-25 19:00' },
  { id: 'a7', level: 'yellow', table: 'capital_info', type: 'run', message: '今日首次失败，已自动 health-fix 重试成功', ts: '2026-06-25 18:16' },
  { id: 'a8', level: 'yellow', table: '(全局)', type: 'lint', message: 'R011: DB_PATH 硬编码 49 处；R012: TQ 初始化重复 9 份', ts: '2026-06-25 19:00' },
]

// 行数趋势 (近7天，用于 Dashboard mini chart)
export const ROW_TREND: { table: string; days: { date: string; rows: number }[] }[] = [
  { table: 'stock_kline_1m', days: [
    { date: '06-19', rows: 197_400_000 }, { date: '06-20', rows: 197_900_000 }, { date: '06-21', rows: 198_000_000 },
    { date: '06-22', rows: 198_000_000 }, { date: '06-23', rows: 198_400_000 }, { date: '06-24', rows: 198_900_000 },
    { date: '06-25', rows: 198_900_000 },
  ]},
  { table: 'stock_daily_kline', days: [
    { date: '06-19', rows: 9_825_000 }, { date: '06-20', rows: 9_830_000 }, { date: '06-21', rows: 9_835_000 },
    { date: '06-22', rows: 9_835_000 }, { date: '06-23', rows: 9_840_000 }, { date: '06-24', rows: 9_840_000 },
    { date: '06-25', rows: 9_840_000 },
  ]},
]

// 交易日历 — 基于 trading_calendar 表 is_trading=true 的日期
// 06-21(周日) / 06-22(周六) 为非交易日，其余为交易日
export const TRADING_CALENDAR: { date: string; isTrading: boolean }[] = [
  { date: '06-19', isTrading: true },   // 周五
  { date: '06-20', isTrading: true },   // 周六（补班交易日，A股特例）
  { date: '06-21', isTrading: false },  // 周日
  { date: '06-22', isTrading: false },  // 周六
  { date: '06-23', isTrading: true },   // 周一
  { date: '06-24', isTrading: true },   // 周二
  { date: '06-25', isTrading: true },   // 周三
]

/** 最后一个交易日 */
export const LAST_TRADING_DATE = TRADING_CALENDAR.filter(d => d.isTrading).slice(-1)[0].date

/** 判断某日期是否为交易日 */
export function isTradingDay(date: string): boolean {
  return TRADING_CALENDAR.find(d => d.date === date)?.isTrading ?? false
}

// 健康度矩阵 (近7天每表每天的状态，非交易日自动标记为 skipped)
export const HEALTH_MATRIX: { table: string; days: { date: string; status: 'success' | 'failed' | 'skipped' | 'none' }[] }[] = TABLES.map(t => ({
  table: t.table,
  days: ['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25'].map(d => {
    // 非交易日：所有表标记 skipped（无需执行）
    if (!isTradingDay(d)) return { date: d, status: 'skipped' as const }
    if (t.health === 'red' && t.rows === 0) return { date: d, status: 'skipped' as const }
    if (t.table === 't_bk5_19' && d === '06-25') return { date: d, status: 'failed' as const }
    if (t.health === 'white') return { date: d, status: 'none' as const }
    return { date: d, status: 'success' as const }
  }),
}))

// 近 7 天执行汇总（用于 Dashboard 成功率环形图）
export interface DailyRunStat {
  date: string
  total: number
  success: number
  failed: number
  skipped: number
  totalRows: number
  durationMin: number
}
export const DAILY_STATS: DailyRunStat[] = [
  { date: '06-19', total: 24, success: 24, failed: 0, skipped: 0, totalRows: 215_400_000, durationMin: 22 },
  { date: '06-20', total: 24, success: 23, failed: 1, skipped: 0, totalRows: 215_500_000, durationMin: 25 },
  { date: '06-21', total: 0, success: 0, failed: 0, skipped: 0, totalRows: 0, durationMin: 0 }, // 非交易日(周日)
  { date: '06-22', total: 0, success: 0, failed: 0, skipped: 0, totalRows: 0, durationMin: 0 }, // 非交易日(周六)
  { date: '06-23', total: 24, success: 22, failed: 2, skipped: 0, totalRows: 215_900_000, durationMin: 28 },
  { date: '06-24', total: 24, success: 23, failed: 1, skipped: 0, totalRows: 216_400_000, durationMin: 23 },
  { date: '06-25', total: 26, success: 22, failed: 2, skipped: 1, totalRows: 216_900_000, durationMin: 65 },
]

// 每日入座行数 (用于 Dashboard 行数趋势区域图)
export const INGEST_TREND: { date: string; rows: number }[] = [
  { date: '06-19', rows: 1_850_000 },
  { date: '06-20', rows: 1_920_000 },
  { date: '06-21', rows: 0 },
  { date: '06-22', rows: 0 },
  { date: '06-23', rows: 2_010_000 },
  { date: '06-24', rows: 1_870_000 },
  { date: '06-25', rows: 3_240_000 },
]

// 脚本规模分布（按目录）
export const SCRIPT_DISTRIBUTION: { dir: string; tables: number; totalLines: number }[] = [
  { dir: '1_入库', tables: 17, totalLines: 1842 },
  { dir: '2_计算', tables: 7, totalLines: 687 },
  { dir: '3_策略', tables: 1, totalLines: 124 },
  { dir: '4_工具', tables: 1, totalLines: 136 },
]

// 样例数据生成器：根据表的列定义生成 mock 前 5 行
export function genSampleData(table: TableMeta): { columns: string[]; rows: (string | number)[][] } {
  const cols = table.columns.map(c => c.name)
  // 根据表名生成不同风格的样例数据
  if (table.table === 'stock_daily_kline') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', '2026-06-25', 1685.20, 1702.50, 1678.80, 1698.30, 2456789, 4168000000, 2.35, 0.58, 1.0000],
        ['000858.SZ', '2026-06-25', 168.50, 171.20, 167.30, 170.45, 15678234, 2670000000, 3.12, 1.85, 1.0000],
        ['300750.SZ', '2026-06-25', 245.80, 248.60, 244.10, 247.20, 8923456, 2205000000, 1.05, 0.42, 1.0000],
        ['601318.SH', '2026-06-25', 52.30, 52.85, 51.92, 52.68, 23456789, 1235000000, 0.78, 0.15, 1.0000],
        ['000333.SZ', '2026-06-25', 78.45, 79.20, 77.80, 78.95, 12345678, 975000000, 1.02, 0.38, 1.0000],
      ],
    }
  }
  if (table.table.includes('kline')) {
    return {
      columns: cols,
      rows: [
        ['600519.SH', '2026-06-25 14:55:00', 1698.00, 1699.50, 1697.20, 1698.30, 12500, 21200000],
        ['600519.SH', '2026-06-25 14:56:00', 1698.30, 1700.00, 1697.80, 1699.20, 8900, 15100000],
        ['600519.SH', '2026-06-25 14:57:00', 1699.20, 1701.50, 1698.50, 1700.80, 15600, 26500000],
        ['600519.SH', '2026-06-25 14:58:00', 1700.80, 1702.50, 1700.00, 1701.20, 11200, 19000000],
        ['600519.SH', '2026-06-25 14:59:00', 1701.20, 1702.50, 1700.50, 1702.10, 23400, 39800000],
      ],
    }
  }
  if (table.table === 'trading_calendar') {
    return {
      columns: cols,
      rows: [
        ['2026-06-25', true, 'A股'],
        ['2026-06-26', true, 'A股'],
        ['2026-06-27', false, 'A股'],
        ['2026-06-28', false, 'A股'],
        ['2026-06-29', true, 'A股'],
      ],
    }
  }
  if (table.table === 'capital_info') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', '2026-06-25', 1256.20, 12.56, 12.56, 1256.20],
        ['000858.SZ', '2026-06-25', 1299.00, 12.99, 12.99, 1299.00],
        ['300750.SZ', '2026-06-25', 433.40, 4.33, 4.33, 433.40],
        ['601318.SH', '2026-06-25', 9114.00, 91.14, 91.14, 9114.00],
        ['000333.SZ', '2026-06-25', 10401.00, 104.01, 104.01, 10401.00],
      ],
    }
  }
  if (table.table === 'pianpao_daily') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', '2026-06-25', 95.2],
        ['000858.SZ', '2026-06-25', 91.8],
        ['300750.SZ', '2026-06-25', 88.5],
        ['601318.SH', '2026-06-25', 85.1],
        ['000333.SZ', '2026-06-25', 82.7],
      ],
    }
  }
  if (table.table === 'stock_block_relation') {
    return {
      columns: cols,
      rows: [
        ['人工智能', 'BK0001', '概念板块', 187, '2026-06-25 17:00'],
        ['芯片', 'BK0002', '概念板块', 156, '2026-06-25 17:00'],
        ['新能源车', 'BK0003', '概念板块', 142, '2026-06-25 17:00'],
        ['光伏', 'BK0004', '概念板块', 128, '2026-06-25 17:00'],
        ['医药', 'BK0005', '行业板块', 119, '2026-06-25 17:00'],
      ],
    }
  }
  if (table.table === 'dim_security_type') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', '股票', '主板', 'SH'],
        ['000858.SZ', '股票', '主板', 'SZ'],
        ['300750.SZ', '股票', '创业板', 'SZ'],
        ['510050.SH', 'ETF', '上证ETF', 'SH'],
        ['159915.SZ', 'ETF', '深证ETF', 'SZ'],
      ],
    }
  }
  if (table.table === 'stock_industry_3level') {
    return {
      columns: cols,
      rows: [
        ['IT001', '信息技术', '半导体', '集成电路设计'],
        ['IT002', '信息技术', '半导体', '集成电路制造'],
        ['IT003', '信息技术', '软件', '工业软件'],
        ['MD001', '医药生物', '化学制药', '创新药'],
        ['MD002', '医药生物', '医疗器械', '体外诊断'],
      ],
    }
  }
  if (table.table === 't_bk5_19') {
    return {
      columns: cols,
      rows: [
        ['2026-06-24', 'BK0001', '人工智能', 35.2, 187],
        ['2026-06-24', 'BK0002', '芯片', 28.5, 156],
        ['2026-06-24', 'BK0003', '新能源车', 22.1, 142],
        ['2026-06-24', 'BK0004', '光伏', 18.7, 128],
        ['2026-06-24', 'BK0005', '医药', 15.3, 119],
      ],
    }
  }
  // 默认：根据列定义生成通用样例
  return {
    columns: cols,
    rows: Array.from({ length: 5 }, (_, i) => cols.map((c, j) => {
      if (c.toLowerCase().includes('date') || c === 'date' || c.toLowerCase().includes('time')) return `2026-06-25`
      if (c.toLowerCase().includes('code') || c === 'code') return `60000${i + 1}.SH`
      if (j === 0) return `row_${i + 1}`
      return typeof table.columns[j]?.type === 'string' && table.columns[j]?.type.includes('INT') ? (i + 1) * 100 : `value_${i + 1}`
    })),
  }
}

// 字段级 lint 违规（按表聚合）
export function getColumnLintIssues(table: TableMeta): { column: string; rule: string; severity: 'RED' | 'YELLOW'; fix: string }[] {
  const issues: { column: string; rule: string; severity: 'RED' | 'YELLOW'; fix: string }[] = []
  table.columns.forEach(col => {
    if (/[^\x00-\x7F]/.test(col.name)) {
      issues.push({
        column: col.name,
        rule: 'R004',
        severity: 'RED',
        fix: `rename 为英文（如 change_pct/turnover/adj_factor）`,
      })
    }
  })
  return issues
}

// 新鲜度分布（用于 Analytics 视图）
export const FRESHNESS_DISTRIBUTION: { freshness: string; count: number; color: string }[] = [
  { freshness: '最新', count: 20, color: 'emerald' },
  { freshness: '滞后', count: 2, color: 'rose' },
  { freshness: '无日期列', count: 1, color: 'amber' },
  { freshness: '空表', count: 1, color: 'rose' },
  { freshness: '—', count: 2, color: 'zinc' },
]

// 调度耗时分布（近 7 天每表平均耗时，秒）
export const DURATION_DISTRIBUTION: { table: string; avgSec: number; maxSec: number; runs: number }[] = [
  { table: 'stock_kline_1m', avgSec: 1820, maxSec: 2100, runs: 5 },
  { table: 'stock_kline_5m', avgSec: 980, maxSec: 1200, runs: 5 },
  { table: 'capital_info', avgSec: 1280, maxSec: 1980, runs: 5 },
  { table: 'stock_daily_kline', avgSec: 280, maxSec: 320, runs: 5 },
  { table: 'pianpao_daily', avgSec: 420, maxSec: 480, runs: 5 },
  { table: 'stock_kline_15m', avgSec: 387, maxSec: 420, runs: 5 },
  { table: 'stock_kline_30m', avgSec: 198, maxSec: 220, runs: 5 },
  { table: 'stock_kline_60m', avgSec: 95, maxSec: 110, runs: 5 },
  { table: 'dim_security_type', avgSec: 7, maxSec: 12, runs: 5 },
  { table: 'trading_calendar', avgSec: 6, maxSec: 8, runs: 5 },
]

// 7 日健康度趋势（每天的红/黄/绿表数）
export const HEALTH_TREND_7D: { date: string; green: number; yellow: number; red: number }[] = [
  { date: '06-19', green: 24, yellow: 0, red: 0 },
  { date: '06-20', green: 23, yellow: 1, red: 0 },
  { date: '06-21', green: 24, yellow: 0, red: 0 },
  { date: '06-22', green: 24, yellow: 0, red: 0 },
  { date: '06-23', green: 22, yellow: 1, red: 1 },
  { date: '06-24', green: 23, yellow: 0, red: 1 },
  { date: '06-25', green: 21, yellow: 1, red: 2 },
]
