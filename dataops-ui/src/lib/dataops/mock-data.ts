// DataOps 管理台 mock 数据
// 基于真实脚本清单 (26 个 active 表) + 诊断报告里的 8 个 bug + lint issues
// 元数据 Source of Truth: ./real-data.ts

export { REAL_TABLE_CONFIGS, SCRIPT_LINE_COUNTS, DATA_DICTIONARY, DIR_ORDER, SCHEDULE_TIERS } from './real-data'

// ─── Mock 日期生成工具 ─────────────────────────────────────
// 所有 mock 日期使用 "今天" 为基准，避免硬编码过期日期
const _today = new Date()
const _todayStr = `${_today.getFullYear()}-${String(_today.getMonth() + 1).padStart(2, '0')}-${String(_today.getDate()).padStart(2, '0')}`
const _yesterday = new Date(_today.getTime() - 86400000)
const _yesterdayStr = `${_yesterday.getFullYear()}-${String(_yesterday.getMonth() + 1).padStart(2, '0')}-${String(_yesterday.getDate()).padStart(2, '0')}`
/** 生成基于今天的 mock 日期时间字符串，如 "${_todayStr} 17:00:12" */
function mockDT(time: string): string { return `${_todayStr} ${time}` }
function mockDTy(time: string): string { return `${_yesterdayStr} ${time}` }
/** 生成距今 N 天的本地日期字符串 */
function mockDate(offsetDays: number): string {
  const d = new Date(_today.getTime() + offsetDays * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

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

// 34 个真实表清单 (数据来源: db-v2 config JSON + Python脚本行数统计)
export const TABLES: TableMeta[] = [
  {
    table: 'stock_daily_kline', cn: '股票日K线', dir: '1_入库', sort: '010',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 9_840_000, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'yellow',
    script: '10_stock_daily_kline.py', scriptLines: 105, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX vipdoc/lday'],
    downstream: ['stock_daily_turnover', 'stock_kline_weekly', 'stock_kline_monthly', 'pianpao_daily', 'dim_security_type'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true },
      { name: '涨跌幅', type: 'DOUBLE', cn: '涨跌幅', nullable: true },
      { name: '换手率', type: 'INTEGER', cn: '换手率', nullable: true },
      { name: '前复权因子', type: 'INTEGER', cn: '前复权因子', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'sector_stocks', cn: '板块成份股', dir: '1_入库', sort: '033',
    schedule: 'daily', mode: 'full', source: '二进制', type: '事实',
    rows: 180_000, maxDate: null, dateCol: null, freshness: '无日期列', health: 'green',
    script: '33_sector_stocks.py', scriptLines: 61, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX T0002/blocknew'],
    downstream: [],
    columns: [
      { name: 'sector_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['sector_code', 'stock_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 't_bk5_19', cn: '板块BK交易数据', dir: '1_入库', sort: '034',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 180_000, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'yellow',
    script: '34_t_bk5_19_.py', scriptLines: 216, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX T0002/blocknew'],
    downstream: ['t_bk5_19_industry_labeled'],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'bk_name', type: 'VARCHAR', cn: '板块指标名', nullable: true },
      { name: 'pe_ttm', type: 'DOUBLE', cn: '市盈率TTM', nullable: true },
      { name: 'pb_mrq', type: 'DOUBLE', cn: '市净率（MRQ）', nullable: true },
      { name: 'ps_ttm', type: 'DOUBLE', cn: '市销率TTM', nullable: true },
      { name: 'pc_ttm', type: 'DOUBLE', cn: '市现率TTM', nullable: true },
      { name: '涨跌数', type: 'DOUBLE', cn: '涨跌数', nullable: true },
      { name: '总市值', type: 'DOUBLE', cn: '总市值', nullable: true },
      { name: '流通市值', type: 'DOUBLE', cn: '流通市值', nullable: true },
      { name: '涨停数', type: 'DOUBLE', cn: '涨停数', nullable: true },
      { name: '跌停数', type: 'DOUBLE', cn: '跌停数', nullable: true },
      { name: '涨停数据', type: 'DOUBLE', cn: '涨停数据', nullable: true },
      { name: '融资融券', type: 'DOUBLE', cn: '融资融券', nullable: true },
      { name: '陆股通流入', type: 'DOUBLE', cn: '陆股通流入', nullable: true },
      { name: '开盘成交数', type: 'DOUBLE', cn: '开盘成交数', nullable: true },
      { name: '股息率', type: 'DOUBLE', cn: '股息率', nullable: true },
      { name: '自由流通市值', type: 'DOUBLE', cn: '自由流通市值', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_industry_3level', cn: '股票行业三级分类', dir: '1_入库', sort: '035',
    schedule: 'weekly', mode: 'full', source: 'API(TQ)', type: '事实',
    rows: 6_000, maxDate: null, dateCol: null, freshness: '无日期列', health: 'yellow',
    script: '35_stock_industry_3level.py', scriptLines: 200, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['tq.get_stock_list'],
    downstream: ['dim_industry_code'],
    columns: [
      { name: 'stock_code', type: 'VARCHAR', cn: '股票代码', nullable: true },
      { name: '行业一级代码', type: 'VARCHAR', cn: '行业一级代码', nullable: true },
      { name: '行业一级名称', type: 'VARCHAR', cn: '行业一级名称', nullable: true },
      { name: '行业二级代码', type: 'VARCHAR', cn: '行业二级代码', nullable: true },
      { name: '行业二级名称', type: 'VARCHAR', cn: '行业二级名称', nullable: true },
      { name: '行业三级代码', type: 'VARCHAR', cn: '行业三级代码', nullable: true },
      { name: '行业三级名称', type: 'VARCHAR', cn: '行业三级名称', nullable: true },
      { name: 'updated_at', type: 'TIMESTAMP', cn: '本批刷新时间', nullable: true }
    ],
    dedupKey: ['stock_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_1m', cn: '股票分钟K线1m', dir: '1_入库', sort: '080',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 198_000_000, maxDate: _todayStr, dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '80_stock_kline_1m.py', scriptLines: 113, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX vipdoc/minline'],
    downstream: ['pianpao_intraday'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false }
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_5m', cn: '股票分钟K线5m', dir: '1_入库', sort: '081',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 39_600_000, maxDate: _todayStr, dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '81_stock_kline_5m.py', scriptLines: 110, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['TDX vipdoc/minline'],
    downstream: ['stock_kline_15m', 'stock_kline_30m', 'stock_kline_60m'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true }
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'trading_calendar', cn: '交易日历', dir: '1_入库', sort: '091',
    schedule: 'daily', mode: 'increment', source: 'API(TQ)', type: '维度',
    rows: 7_300, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'green',
    script: '91_trading_calendar.py', scriptLines: 136, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_trading_dates'],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'is_trading', type: 'BOOLEAN', cn: '是否交易日', nullable: true },
      { name: 'market', type: 'VARCHAR', cn: '所属市场', nullable: true }
    ],
    dedupKey: ['date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'market_sc1_42', cn: '市场SC宏观指标', dir: '1_入库', sort: '092',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 7_300, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'yellow',
    script: '92_market_sc1_42.py', scriptLines: 172, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['TDX T0002/signals'],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: '融资融券_融资余额', type: 'DOUBLE', cn: '融资融券_融资余额', nullable: true },
      { name: '融资融券_融券余额', type: 'DOUBLE', cn: '融资融券_融券余额', nullable: true },
      { name: '陆股通资金流入_沪股通流入', type: 'DOUBLE', cn: '陆股通资金流入_沪股通流入', nullable: true },
      { name: '陆股通资金流入_深股通流入', type: 'DOUBLE', cn: '陆股通资金流入_深股通流入', nullable: true },
      { name: '沪深京涨停股个数_涨停股个数', type: 'DOUBLE', cn: '沪深京涨停股个数_涨停股个数', nullable: true },
      { name: '沪深京涨停股个数_曾涨停股个数', type: 'DOUBLE', cn: '沪深京涨停股个数_曾涨停股个数', nullable: true },
      { name: '沪深京跌停股个数_跌停股个数', type: 'DOUBLE', cn: '沪深京跌停股个数_跌停股个数', nullable: true },
      { name: '沪深京跌停股个数_曾跌停股个数', type: 'DOUBLE', cn: '沪深京跌停股个数_曾跌停股个数', nullable: true },
      { name: '上证50股指期货_净持仓', type: 'DOUBLE', cn: '上证50股指期货_净持仓', nullable: true },
      { name: '沪深300股指期货_净持仓', type: 'DOUBLE', cn: '沪深300股指期货_净持仓', nullable: true },
      { name: '中证500股指期货_净持仓', type: 'DOUBLE', cn: '中证500股指期货_净持仓', nullable: true },
      { name: 'ETF基金规模份额_ETF规模', type: 'DOUBLE', cn: 'ETF基金规模份额_ETF规模', nullable: true },
      { name: 'ETF基金规模份额_ETF净申赎', type: 'DOUBLE', cn: 'ETF基金规模份额_ETF净申赎', nullable: true },
      { name: '沪月新开A股账户_新开账户', type: 'DOUBLE', cn: '沪月新开A股账户_新开账户', nullable: true },
      { name: '增减持统计_增持额', type: 'DOUBLE', cn: '增减持统计_增持额', nullable: true },
      { name: '增减持统计_减持额', type: 'DOUBLE', cn: '增减持统计_减持额', nullable: true },
      { name: '大宗交易_溢价交易额', type: 'DOUBLE', cn: '大宗交易_溢价交易额', nullable: true },
      { name: '大宗交易_折价交易额', type: 'DOUBLE', cn: '大宗交易_折价交易额', nullable: true },
      { name: '限售解禁_计划额', type: 'DOUBLE', cn: '限售解禁_计划额', nullable: true },
      { name: '限售解禁_实际上市', type: 'DOUBLE', cn: '限售解禁_实际上市', nullable: true },
      { name: '分红_总分红额', type: 'DOUBLE', cn: '分红_总分红额', nullable: true },
      { name: '募资_总募资额', type: 'DOUBLE', cn: '募资_总募资额', nullable: true },
      { name: '打板资金_封板成功', type: 'DOUBLE', cn: '打板资金_封板成功', nullable: true },
      { name: '打板资金_封板失败', type: 'DOUBLE', cn: '打板资金_封板失败', nullable: true },
      { name: '龙虎榜_买入总额', type: 'DOUBLE', cn: '龙虎榜_买入总额', nullable: true },
      { name: '龙虎榜_卖出总额', type: 'DOUBLE', cn: '龙虎榜_卖出总额', nullable: true },
      { name: '龙虎榜机构数据_机构买入', type: 'DOUBLE', cn: '龙虎榜机构数据_机构买入', nullable: true },
      { name: '龙虎榜机构数据_机构卖出', type: 'DOUBLE', cn: '龙虎榜机构数据_机构卖出', nullable: true },
      { name: '龙虎榜营业部数据_营业部买入', type: 'DOUBLE', cn: '龙虎榜营业部数据_营业部买入', nullable: true },
      { name: '龙虎榜营业部数据_营业部卖出', type: 'DOUBLE', cn: '龙虎榜营业部数据_营业部卖出', nullable: true },
      { name: '龙虎榜沪深股通数据_沪深股通买入', type: 'DOUBLE', cn: '龙虎榜沪深股通数据_沪深股通买入', nullable: true },
      { name: '龙虎榜沪深股通数据_沪深股通卖出', type: 'DOUBLE', cn: '龙虎榜沪深股通数据_沪深股通卖出', nullable: true },
      { name: '陆股通净买入_沪股通净买入', type: 'DOUBLE', cn: '陆股通净买入_沪股通净买入', nullable: true },
      { name: '陆股通净买入_深股通净买入', type: 'DOUBLE', cn: '陆股通净买入_深股通净买入', nullable: true },
      { name: '每周无限售质押率_深市质押率', type: 'DOUBLE', cn: '每周无限售质押率_深市质押率', nullable: true },
      { name: '每周无限售质押率_沪市质押率', type: 'DOUBLE', cn: '每周无限售质押率_沪市质押率', nullable: true },
      { name: '每周有限售质押率_深市质押率', type: 'DOUBLE', cn: '每周有限售质押率_深市质押率', nullable: true },
      { name: '每周有限售质押率_沪市质押率', type: 'DOUBLE', cn: '每周有限售质押率_沪市质押率', nullable: true },
      { name: '连板家数_含ST连板数', type: 'DOUBLE', cn: '连板家数_含ST连板数', nullable: true },
      { name: '连板家数_不含ST连板数', type: 'DOUBLE', cn: '连板家数_不含ST连板数', nullable: true },
      { name: '沪深京涨跌停_涨停', type: 'DOUBLE', cn: '沪深京涨跌停_涨停', nullable: true },
      { name: '沪深京涨跌停_跌停', type: 'DOUBLE', cn: '沪深京涨跌停_跌停', nullable: true },
      { name: '融资融券_融资买入额', type: 'DOUBLE', cn: '融资融券_融资买入额', nullable: true },
      { name: '融资融券_融券卖出量', type: 'DOUBLE', cn: '融资融券_融券卖出量', nullable: true },
      { name: '每周市场质押比_质押比例', type: 'DOUBLE', cn: '每周市场质押比_质押比例', nullable: true },
      { name: '央行公开市场净投放_净投放', type: 'DOUBLE', cn: '央行公开市场净投放_净投放', nullable: true },
      { name: '历史A股新高新低_历史新高', type: 'DOUBLE', cn: '历史A股新高新低_历史新高', nullable: true },
      { name: '历史A股新高新低_历史新低', type: 'DOUBLE', cn: '历史A股新高新低_历史新低', nullable: true },
      { name: '120天A股新高新低_120天新高', type: 'DOUBLE', cn: '120天A股新高新低_120天新高', nullable: true },
      { name: '120天A股新高新低_120天新低', type: 'DOUBLE', cn: '120天A股新高新低_120天新低', nullable: true },
      { name: '涨停数据_市场高度', type: 'DOUBLE', cn: '涨停数据_市场高度', nullable: true },
      { name: '涨停数据_2板以上涨停', type: 'DOUBLE', cn: '涨停数据_2板以上涨停', nullable: true },
      { name: '涨跌家数_涨家数', type: 'DOUBLE', cn: '涨跌家数_涨家数', nullable: true },
      { name: '涨跌家数_跌家数', type: 'DOUBLE', cn: '涨跌家数_跌家数', nullable: true },
      { name: '20天A股新高新低_20天新高', type: 'DOUBLE', cn: '20天A股新高新低_20天新高', nullable: true },
      { name: '20天A股新高新低_20天新低', type: 'DOUBLE', cn: '20天A股新高新低_20天新低', nullable: true },
      { name: '市场总封单金额_涨停封单', type: 'DOUBLE', cn: '市场总封单金额_涨停封单', nullable: true },
      { name: '市场总封单金额_跌停封单', type: 'DOUBLE', cn: '市场总封单金额_跌停封单', nullable: true },
      { name: '涨跌股成交量_上涨成交量', type: 'DOUBLE', cn: '涨跌股成交量_上涨成交量', nullable: true },
      { name: '涨跌股成交量_下跌成交量', type: 'DOUBLE', cn: '涨跌股成交量_下跌成交量', nullable: true },
      { name: '涨停数据_换手板家数', type: 'DOUBLE', cn: '涨停数据_换手板家数', nullable: true },
      { name: '涨停数据_回封率', type: 'DOUBLE', cn: '涨停数据_回封率', nullable: true },
      { name: '曾涨跌停股个数_曾涨停', type: 'DOUBLE', cn: '曾涨跌停股个数_曾涨停', nullable: true },
      { name: '曾涨跌停股个数_曾跌停', type: 'DOUBLE', cn: '曾涨跌停股个数_曾跌停', nullable: true },
      { name: '转融券_融出市值', type: 'DOUBLE', cn: '转融券_融出市值', nullable: true },
      { name: '转融券_期末余额', type: 'DOUBLE', cn: '转融券_期末余额', nullable: true },
      { name: 'ETF基金规模金额_ETF规模', type: 'DOUBLE', cn: 'ETF基金规模金额_ETF规模', nullable: true },
      { name: 'ETF基金规模金额_ETF净申赎', type: 'DOUBLE', cn: 'ETF基金规模金额_ETF净申赎', nullable: true },
      { name: '涨跌5%家数_涨超5', type: 'DOUBLE', cn: '涨跌5%家数_涨超5', nullable: true },
      { name: '涨跌5%家数_跌超5', type: 'DOUBLE', cn: '涨跌5%家数_跌超5', nullable: true },
      { name: '陆股通成交_陆股通总额', type: 'DOUBLE', cn: '陆股通成交_陆股通总额', nullable: true },
      { name: '陆股通成交_陆股通总笔', type: 'DOUBLE', cn: '陆股通成交_陆股通总笔', nullable: true },
      { name: '中证1000股指期货_净持仓', type: 'DOUBLE', cn: '中证1000股指期货_净持仓', nullable: true },
      { name: '沪深股通成交金额_沪股通总额', type: 'DOUBLE', cn: '沪深股通成交金额_沪股通总额', nullable: true },
      { name: '沪深股通成交金额_深股通总额', type: 'DOUBLE', cn: '沪深股通成交金额_深股通总额', nullable: true }
    ],
    dedupKey: ['date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_gp1_46_indicators', cn: '个股GP指标', dir: '1_入库', sort: '093',
    schedule: 'daily', mode: 'increment', source: '二进制', type: '事实',
    rows: 28_000_000, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'green',
    script: '93_stock_gp1_46_indicators.py', scriptLines: 153, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['TDX T0002/signals'],
    downstream: ['stock_gp1_46_indicators_labeled'],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'gp_code', type: 'VARCHAR', cn: '指标代码', nullable: true },
      { name: 'gp_name', type: 'VARCHAR', cn: '指标名称', nullable: true },
      { name: 'value_0', type: 'DOUBLE', cn: '指标值1', nullable: true },
      { name: 'value_1', type: 'DOUBLE', cn: '指标值2', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_gp1_46_indicators_labeled', cn: '[VIEW] 个股GP指标 - 带字段含义', dir: '2_计算', sort: '093',
    schedule: 'daily', mode: 'increment', source: '视图(SQL派生)', type: '视图',
    rows: 0, maxDate: null, dateCol: 'date', freshness: '—', health: 'white',
    script: '93_stock_gp1_46_indicators.py', scriptLines: 153, hasLintIssue: false,
    dependsOn: ['stock_gp1_46_indicators'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'code', type: 'VARCHAR', cn: '代码', nullable: false },
      { name: 'gp_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'gp_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_0', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'value_1', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'value_0_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_0_unit', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_1_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_1_unit', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'present', type: 'BOOLEAN', cn: 'TODO', nullable: true },
      { name: 'note', type: 'VARCHAR', cn: '备注', nullable: true }
    ],
    dedupKey: [], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_gp_indicator', cn: 'GP指标映射维度表', dir: '1_入库', sort: '094',
    schedule: 'once', mode: 'full', source: '文档', type: '维度',
    rows: 46, maxDate: null, dateCol: null, freshness: '无日期列', health: 'green',
    script: '', scriptLines: 0, hasLintIssue: false,
    dependsOn: [], sourceDeps: [],
    downstream: ['stock_gp1_46_indicators_labeled'],
    columns: [
      { name: 'gp_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'gp_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_0_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_0_unit', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_1_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'value_1_unit', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'note', type: 'VARCHAR', cn: '备注', nullable: true },
      { name: 'present', type: 'BOOLEAN', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['gp_code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'sjb_api_plhqL2kz_88zd', cn: 'L2快照88字段', dir: '1_入库', sort: '101',
    schedule: 'daily', mode: 'increment', source: 'API(TQ)', type: '事实',
    rows: 6_000_000, maxDate: _todayStr, dateCol: 'HqDate', freshness: '最新', health: 'green',
    script: '101_jb_api_plhqL2kz_88zd.py', scriptLines: 379, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_more_info'],
    downstream: ['dim_88field_indicator'],
    columns: [
      { name: 'MainBusiness', type: 'VARCHAR', cn: '主营构成', nullable: true },
      { name: 'SafeValue', type: 'VARCHAR', cn: '安全值', nullable: true },
      { name: 'ShineValue', type: 'VARCHAR', cn: '发光值', nullable: true },
      { name: 'ShapeValue', type: 'VARCHAR', cn: '形状值', nullable: true },
      { name: 'TPFlag', type: 'VARCHAR', cn: 'T+0标志', nullable: true },
      { name: 'ZTPrice', type: 'VARCHAR', cn: '涨停价', nullable: true },
      { name: 'DTPrice', type: 'VARCHAR', cn: '跌停价', nullable: true },
      { name: 'HqDate', type: 'VARCHAR', cn: '行情日期', nullable: true },
      { name: 'fHSL', type: 'VARCHAR', cn: '换手率%', nullable: true },
      { name: 'fLianB', type: 'VARCHAR', cn: '连板天数', nullable: true },
      { name: 'Wtb', type: 'VARCHAR', cn: '委比', nullable: true },
      { name: 'Zsz', type: 'VARCHAR', cn: '总市值_万', nullable: true },
      { name: 'Ltsz', type: 'VARCHAR', cn: '流通市值_万', nullable: true },
      { name: 'vzangsu', type: 'VARCHAR', cn: '涨速', nullable: true },
      { name: 'Fzhsl', type: 'VARCHAR', cn: '振幅%', nullable: true },
      { name: 'FzAmo', type: 'VARCHAR', cn: '成交金额_万', nullable: true },
      { name: 'VOpenZAF', type: 'VARCHAR', cn: '抢筹涨幅%', nullable: true },
      { name: 'ZAF', type: 'VARCHAR', cn: '日涨跌幅%', nullable: true },
      { name: 'ZAFYesterday', type: 'VARCHAR', cn: '昨日涨跌幅%', nullable: true },
      { name: 'ZAFPre2D', type: 'VARCHAR', cn: '前2日涨跌幅%', nullable: true },
      { name: 'ZAFPre5', type: 'VARCHAR', cn: '近5日涨跌幅%', nullable: true },
      { name: 'ZAFPre10', type: 'VARCHAR', cn: '近10日涨跌幅%', nullable: true },
      { name: 'ZAFPre20', type: 'VARCHAR', cn: '近20日涨跌幅%', nullable: true },
      { name: 'ZAFPre30', type: 'VARCHAR', cn: '近30日涨跌幅%', nullable: true },
      { name: 'ZAFPre60', type: 'VARCHAR', cn: '近60日涨跌幅%', nullable: true },
      { name: 'ZAFYear', type: 'VARCHAR', cn: '近一年涨跌幅%', nullable: true },
      { name: 'ZAFPreMyMonth', type: 'VARCHAR', cn: '近一月涨跌幅%', nullable: true },
      { name: 'ZAFPreOneYear', type: 'VARCHAR', cn: '近一年涨幅2%', nullable: true },
      { name: 'Zjl', type: 'VARCHAR', cn: '主买净额_万', nullable: true },
      { name: 'Zjl_HB', type: 'VARCHAR', cn: '主力净流入_万', nullable: true },
      { name: 'TotalBVol', type: 'VARCHAR', cn: '总买量', nullable: true },
      { name: 'TotalSVol', type: 'VARCHAR', cn: '总卖量', nullable: true },
      { name: 'BCancel', type: 'VARCHAR', cn: '买撤单笔数', nullable: true },
      { name: 'SCancel', type: 'VARCHAR', cn: '卖撤单笔数', nullable: true },
      { name: 'L2TicNum', type: 'VARCHAR', cn: 'L2逐笔成交数', nullable: true },
      { name: 'L2OrderNum', type: 'VARCHAR', cn: 'L2逐笔委托数', nullable: true },
      { name: 'FCAmo', type: 'VARCHAR', cn: '主买成交额_万', nullable: true },
      { name: 'FCb', type: 'VARCHAR', cn: '封单比', nullable: true },
      { name: 'OpenZAF', type: 'VARCHAR', cn: '开盘涨跌幅%', nullable: true },
      { name: 'OpenAmo', type: 'VARCHAR', cn: '开盘金额', nullable: true },
      { name: 'OpenZTBuy', type: 'VARCHAR', cn: '开盘涨停买入', nullable: true },
      { name: 'OpenAmoPre1', type: 'VARCHAR', cn: '昨日开盘金额', nullable: true },
      { name: 'OpenVolPre1', type: 'VARCHAR', cn: '昨日开盘量', nullable: true },
      { name: 'CJJEPre1', type: 'VARCHAR', cn: '昨日成交金额', nullable: true },
      { name: 'CJJEPre3', type: 'VARCHAR', cn: '前3日成交金额', nullable: true },
      { name: 'FDEPre1', type: 'VARCHAR', cn: '昨日封单额', nullable: true },
      { name: 'FDEPre2', type: 'VARCHAR', cn: '前2日封单额', nullable: true },
      { name: 'ZTGPNum', type: 'VARCHAR', cn: '板块内涨停个股数', nullable: true },
      { name: 'LastStartZT', type: 'VARCHAR', cn: '首次涨停时间', nullable: true },
      { name: 'LastZTHzNum', type: 'VARCHAR', cn: '连板数', nullable: true },
      { name: 'EverZTCount', type: 'VARCHAR', cn: '历史涨停次数', nullable: true },
      { name: 'ConZAFDateNum', type: 'VARCHAR', cn: '连涨天数', nullable: true },
      { name: 'YearZTDay', type: 'VARCHAR', cn: '近一年涨停天数', nullable: true },
      { name: 'MA5Value', type: 'VARCHAR', cn: 'MA5均线值', nullable: true },
      { name: 'HisHigh', type: 'VARCHAR', cn: '历史最高价', nullable: true },
      { name: 'HisLow', type: 'VARCHAR', cn: '历史最低价', nullable: true },
      { name: 'IPO_Price', type: 'VARCHAR', cn: 'IPO发行价', nullable: true },
      { name: 'More_YJL', type: 'VARCHAR', cn: '业绩预告', nullable: true },
      { name: 'BetaValue', type: 'VARCHAR', cn: 'Beta系数', nullable: true },
      { name: 'DynaPE', type: 'VARCHAR', cn: '动态市盈率', nullable: true },
      { name: 'MorePE', type: 'VARCHAR', cn: '更多PE', nullable: true },
      { name: 'StaticPE_TTM', type: 'VARCHAR', cn: '静态PE_TTM', nullable: true },
      { name: 'DYRatio', type: 'VARCHAR', cn: '股息率', nullable: true },
      { name: 'PB_MRQ', type: 'VARCHAR', cn: '市净率', nullable: true },
      { name: 'IsT0Fund', type: 'VARCHAR', cn: '是否T+0基金', nullable: true },
      { name: 'IsZCZGP', type: 'VARCHAR', cn: '是否中概股', nullable: true },
      { name: 'IsKzz', type: 'VARCHAR', cn: '是否可转债', nullable: true },
      { name: 'Kzz_HSCode', type: 'VARCHAR', cn: '可转债沪市代码', nullable: true },
      { name: 'QHMainYYMM', type: 'VARCHAR', cn: '期货主力合约月份', nullable: true },
      { name: 'FreeLtgb', type: 'VARCHAR', cn: '自由流通股本', nullable: true },
      { name: 'Yield', type: 'VARCHAR', cn: '收益率', nullable: true },
      { name: 'KfEarnMoney', type: 'VARCHAR', cn: '可赚钱', nullable: true },
      { name: 'RDInputFee', type: 'VARCHAR', cn: '研发投入费用', nullable: true },
      { name: 'CashZJ', type: 'VARCHAR', cn: '现金资金', nullable: true },
      { name: 'PreReceiveZJ', type: 'VARCHAR', cn: '预收资金', nullable: true },
      { name: 'OtherQYJzc', type: 'VARCHAR', cn: '其他权益净资产', nullable: true },
      { name: 'StaffNum', type: 'VARCHAR', cn: '员工人数', nullable: true },
      { name: 'RecentGGJYDate', type: 'VARCHAR', cn: '最近股权激励日期', nullable: true },
      { name: 'RecentHGDate', type: 'VARCHAR', cn: '最近回购日期', nullable: true },
      { name: 'RecentIncentDate', type: 'VARCHAR', cn: '最近激励日期', nullable: true },
      { name: 'NoticeDate_Recent', type: 'VARCHAR', cn: '最近公告日期', nullable: true },
      { name: 'RecentReleaseDate', type: 'VARCHAR', cn: '最近解禁日期', nullable: true },
      { name: 'RecentDZDate', type: 'VARCHAR', cn: '最近大宗交易日期', nullable: true },
      { name: 'ReportDate', type: 'VARCHAR', cn: '报告期', nullable: true },
      { name: 'ZTDate_Recent', type: 'VARCHAR', cn: '最近涨停日期', nullable: true },
      { name: 'DTDate_Recent', type: 'VARCHAR', cn: '最近跌停日期', nullable: true },
      { name: 'TopDate_Recent', type: 'VARCHAR', cn: '最近创新高日期', nullable: true },
      { name: 'StopJYDate_Recent', type: 'VARCHAR', cn: '最近停牌日期', nullable: true },
      { name: 'code', type: 'VARCHAR', cn: '股票代码', nullable: false },
      { name: 'stock_type', type: 'VARCHAR', cn: '标的类型', nullable: true },
      { name: 'fetch_time', type: 'VARCHAR', cn: '查询时间', nullable: true }
    ],
    dedupKey: ['HqDate', 'code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_88field_indicator', cn: '88字段映射维度表', dir: '1_入库', sort: '102',
    schedule: 'once', mode: 'full', source: '文档', type: '维度',
    rows: 88, maxDate: null, dateCol: null, freshness: '无日期列', health: 'green',
    script: '', scriptLines: 0, hasLintIssue: false,
    dependsOn: ['sjb_api_plhqL2kz_88zd'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'field_en', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'field_cn', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'category', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'category_cn', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'unit', type: 'VARCHAR', cn: '单位', nullable: true },
      { name: 'remark', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'source', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'created_at', type: 'TIMESTAMP', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['field_name'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_financial_data', cn: '股票专业财务数据(2026季度)', dir: '1_入库', sort: '104',
    schedule: 'daily', mode: 'increment', source: 'API(TQ)', type: '事实',
    rows: 25_000, maxDate: null, dateCol: null, freshness: '无日期列', health: 'green',
    script: '104_stock_financial_data.py', scriptLines: 328, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_financial_data'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'announce_time', type: 'BIGINT', cn: 'TODO', nullable: true },
      { name: 'tag_time', type: 'BIGINT', cn: 'TODO', nullable: true },
      { name: 'FN1', type: 'DOUBLE', cn: '基本每股收益', nullable: true },
      { name: 'FN2', type: 'DOUBLE', cn: '扣非每股收益', nullable: true },
      { name: 'FN3', type: 'DOUBLE', cn: '每股未分配利润', nullable: true },
      { name: 'FN4', type: 'DOUBLE', cn: '每股净资产', nullable: true },
      { name: 'FN5', type: 'DOUBLE', cn: '每股资本公积金', nullable: true },
      { name: 'FN6', type: 'DOUBLE', cn: '净资产收益率', nullable: true },
      { name: 'FN7', type: 'DOUBLE', cn: '每股经营现金流量', nullable: true },
      { name: 'FN8', type: 'DOUBLE', cn: '货币资金', nullable: true },
      { name: 'FN17', type: 'DOUBLE', cn: '存货', nullable: true },
      { name: 'FN21', type: 'DOUBLE', cn: '流动资产合计', nullable: true },
      { name: 'FN27', type: 'DOUBLE', cn: '固定资产', nullable: true },
      { name: 'FN28', type: 'DOUBLE', cn: '在建工程', nullable: true },
      { name: 'FN33', type: 'DOUBLE', cn: '无形资产', nullable: true },
      { name: 'FN35', type: 'DOUBLE', cn: '商誉', nullable: true },
      { name: 'FN39', type: 'DOUBLE', cn: '非流动资产合计', nullable: true },
      { name: 'FN40', type: 'DOUBLE', cn: '资产总计', nullable: true },
      { name: 'FN41', type: 'DOUBLE', cn: '短期借款', nullable: true },
      { name: 'FN54', type: 'DOUBLE', cn: '流动负债合计', nullable: true },
      { name: 'FN55', type: 'DOUBLE', cn: '长期借款', nullable: true },
      { name: 'FN62', type: 'DOUBLE', cn: '非流动负债合计', nullable: true },
      { name: 'FN63', type: 'DOUBLE', cn: '负债合计', nullable: true },
      { name: 'FN64', type: 'DOUBLE', cn: '实收资本', nullable: true },
      { name: 'FN65', type: 'DOUBLE', cn: '资本公积', nullable: true },
      { name: 'FN66', type: 'DOUBLE', cn: '盈余公积', nullable: true },
      { name: 'FN68', type: 'DOUBLE', cn: '未分配利润', nullable: true },
      { name: 'FN72', type: 'DOUBLE', cn: '所有者权益合计', nullable: true },
      { name: 'FN134', type: 'DOUBLE', cn: '净利润', nullable: true },
      { name: 'FN207', type: 'DOUBLE', cn: '息税前利润EBIT', nullable: true },
      { name: 'FN208', type: 'DOUBLE', cn: '息税折旧摊销前利润EBITDA', nullable: true },
      { name: 'FN230', type: 'DOUBLE', cn: '营业收入', nullable: true },
      { name: 'FN231', type: 'DOUBLE', cn: '营业利润', nullable: true },
      { name: 'FN232', type: 'DOUBLE', cn: '归母净利润', nullable: true },
      { name: 'FN233', type: 'DOUBLE', cn: '扣非净利润', nullable: true },
      { name: 'FN304', type: 'DOUBLE', cn: '研发费用', nullable: true },
      { name: 'FN234', type: 'DOUBLE', cn: '经营活动现金流量净额', nullable: true },
      { name: 'FN235', type: 'DOUBLE', cn: '投资活动现金流量净额', nullable: true },
      { name: 'FN236', type: 'DOUBLE', cn: '筹资活动现金流量净额', nullable: true },
      { name: 'FN133', type: 'DOUBLE', cn: '期末现金及现金等价物余额', nullable: true },
      { name: 'FN219', type: 'DOUBLE', cn: '每股经营性现金流', nullable: true },
      { name: 'FN225', type: 'DOUBLE', cn: '每股现金流量净额', nullable: true },
      { name: 'FN238', type: 'DOUBLE', cn: '总股本', nullable: true },
      { name: 'FN281', type: 'DOUBLE', cn: '加权净资产收益率', nullable: true },
      { name: 'FN311', type: 'DOUBLE', cn: '基本每股收益_单季度', nullable: true },
      { name: 'FN312', type: 'DOUBLE', cn: '营业总收入_单季度', nullable: true },
      { name: 'FN324', type: 'DOUBLE', cn: '净利润_单季度', nullable: true },
      { name: 'fetch_time', type: 'VARCHAR', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'market_snapshot', cn: '市场快照数据', dir: '1_入库', sort: '105',
    schedule: 'daily', mode: 'increment', source: 'API(TQ)', type: '事实',
    rows: 6_000, maxDate: _todayStr, dateCol: 'snapshot_time', freshness: '最新', health: 'green',
    script: '105_market_snapshot.py', scriptLines: 165, hasLintIssue: false,
    dependsOn: [], sourceDeps: ['tq.get_market_snapshot'],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'snapshot_time', type: 'TIMESTAMP', cn: '快照时间', nullable: true },
      { name: 'LastClose', type: 'DOUBLE', cn: '前收盘价', nullable: true },
      { name: 'Open', type: 'DOUBLE', cn: '开盘价', nullable: true },
      { name: 'Max', type: 'DOUBLE', cn: '最高价', nullable: true },
      { name: 'Min', type: 'DOUBLE', cn: '最低价', nullable: true },
      { name: 'Now', type: 'DOUBLE', cn: '现价', nullable: true },
      { name: 'Volume', type: 'INTEGER', cn: '总手', nullable: true },
      { name: 'NowVol', type: 'INTEGER', cn: '现手', nullable: true },
      { name: 'Amount', type: 'DOUBLE', cn: '总成交金额', nullable: true },
      { name: 'Inside', type: 'INTEGER', cn: '内盘', nullable: true },
      { name: 'Outside', type: 'INTEGER', cn: '外盘', nullable: true },
      { name: 'TickDiff', type: 'DOUBLE', cn: '笔涨跌', nullable: true },
      { name: 'InOutFlag', type: 'INTEGER', cn: '内外盘标志', nullable: true },
      { name: 'Jjjz', type: 'DOUBLE', cn: '基金净值', nullable: true },
      { name: 'Buyp1', type: 'DOUBLE', cn: '买一价', nullable: true },
      { name: 'Buyp2', type: 'DOUBLE', cn: '买二价', nullable: true },
      { name: 'Buyp3', type: 'DOUBLE', cn: '买三价', nullable: true },
      { name: 'Buyp4', type: 'DOUBLE', cn: '买四价', nullable: true },
      { name: 'Buyp5', type: 'DOUBLE', cn: '买五价', nullable: true },
      { name: 'Buyv1', type: 'INTEGER', cn: '买一量', nullable: true },
      { name: 'Buyv2', type: 'INTEGER', cn: '买二量', nullable: true },
      { name: 'Buyv3', type: 'INTEGER', cn: '买三量', nullable: true },
      { name: 'Buyv4', type: 'INTEGER', cn: '买四量', nullable: true },
      { name: 'Buyv5', type: 'INTEGER', cn: '买五量', nullable: true },
      { name: 'Sellp1', type: 'DOUBLE', cn: '卖一价', nullable: true },
      { name: 'Sellp2', type: 'DOUBLE', cn: '卖二价', nullable: true },
      { name: 'Sellp3', type: 'DOUBLE', cn: '卖三价', nullable: true },
      { name: 'Sellp4', type: 'DOUBLE', cn: '卖四价', nullable: true },
      { name: 'Sellp5', type: 'DOUBLE', cn: '卖五价', nullable: true },
      { name: 'Sellv1', type: 'INTEGER', cn: '卖一量', nullable: true },
      { name: 'Sellv2', type: 'INTEGER', cn: '卖二量', nullable: true },
      { name: 'Sellv3', type: 'INTEGER', cn: '卖三量', nullable: true },
      { name: 'Sellv4', type: 'INTEGER', cn: '卖四量', nullable: true },
      { name: 'Sellv5', type: 'INTEGER', cn: '卖五量', nullable: true },
      { name: 'UpHome', type: 'INTEGER', cn: '上涨家数', nullable: true },
      { name: 'DownHome', type: 'INTEGER', cn: '下跌家数', nullable: true },
      { name: 'Before5MinNow', type: 'DOUBLE', cn: '5分钟前价格', nullable: true },
      { name: 'Average', type: 'DOUBLE', cn: '均价', nullable: true },
      { name: 'XsFlag', type: 'INTEGER', cn: '小数位数', nullable: true },
      { name: 'Zangsu', type: 'DOUBLE', cn: '涨速', nullable: true },
      { name: 'ZAFPre3', type: 'DOUBLE', cn: '3日涨幅', nullable: true }
    ],
    dedupKey: ['code', 'snapshot_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'capital_info', cn: '股本数据(近1年)', dir: '1_入库', sort: '137',
    schedule: 'daily', mode: 'increment', source: 'tqcenter API', type: '事实',
    rows: 600_000, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'green',
    script: '137_capital_info.py', scriptLines: 230, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['tq.get_gb_info_by_date'],
    downstream: ['stock_daily_turnover'],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码(带交易所后缀)', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'zgb', type: 'DOUBLE', cn: '总股本(股)', nullable: true },
      { name: 'ltgb', type: 'DOUBLE', cn: '流通股本(股)', nullable: true },
      { name: 'updated_at', type: 'TIMESTAMP', cn: '入库时间', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_block_relation', cn: '股票板块关系', dir: '1_入库', sort: '262',
    schedule: 'daily', mode: 'increment', source: 'API(TQ)', type: '事实',
    rows: 110_000, maxDate: _todayStr, dateCol: 'fetch_time', freshness: '最新', health: 'yellow',
    script: '262_stock_block_relation.py', scriptLines: 183, hasLintIssue: true,
    dependsOn: [], sourceDeps: ['tq.get_relation'],
    downstream: ['stock_block_relation_industry_labeled'],
    columns: [
      { name: 'stock_code', type: 'VARCHAR', cn: '股票代码', nullable: true },
      { name: '板块代码', type: 'VARCHAR', cn: '板块代码', nullable: true },
      { name: '板块名称', type: 'VARCHAR', cn: '板块名称', nullable: true },
      { name: '板块类型', type: 'VARCHAR', cn: '板块类型', nullable: true },
      { name: '成分股数', type: 'INTEGER', cn: '成分股数', nullable: true },
      { name: 'fetch_time', type: 'TIMESTAMP', cn: '采集时间', nullable: true }
    ],
    dedupKey: ['stock_code', '板块代码'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_security_type', cn: '证券类型维表', dir: '2_计算', sort: '001',
    schedule: 'daily', mode: 'increment', source: 'SQL派生', type: '维度',
    rows: 6_000, maxDate: null, dateCol: null, freshness: '无日期列', health: 'green',
    script: '001_dim_security_type_sync.py', scriptLines: 115, hasLintIssue: false,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'type', type: 'VARCHAR', cn: '证券类型', nullable: true },
      { name: 'market', type: 'VARCHAR', cn: '所属市场', nullable: true },
      { name: 'prefix', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'is_active', type: 'BOOLEAN', cn: 'TODO', nullable: true },
      { name: 'created_at', type: 'TIMESTAMP', cn: 'TODO', nullable: true },
      { name: 'updated_at', type: 'TIMESTAMP', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_weekly', cn: '股票周K线', dir: '2_计算', sort: '017',
    schedule: 'weekly', mode: 'full', source: 'SQL聚合', type: '事实',
    rows: 1_960_000, maxDate: mockDate(-7), dateCol: 'date', freshness: '最新', health: 'yellow',
    script: '17_stock_kline_weekly.py', scriptLines: 78, hasLintIssue: true,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true },
      { name: '涨跌幅', type: 'DOUBLE', cn: '涨跌幅', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_monthly', cn: '股票月K线', dir: '2_计算', sort: '018',
    schedule: 'monthly', mode: 'full', source: 'SQL聚合', type: '事实',
    rows: 490_000, maxDate: mockDate(-30), dateCol: 'date', freshness: '最新', health: 'yellow',
    script: '18_stock_kline_monthly.py', scriptLines: 78, hasLintIssue: true,
    dependsOn: ['stock_daily_kline'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期（YYYYMMDD）', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true },
      { name: '涨跌幅', type: 'DOUBLE', cn: '涨跌幅', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_daily_turnover', cn: '日换手率涨跌幅', dir: '2_计算', sort: '019',
    schedule: 'daily', mode: 'increment', source: 'SQL派生', type: '事实',
    rows: 9_840_000, maxDate: _todayStr, dateCol: 'date', freshness: '最新', health: 'green',
    script: '19_stock_daily_turnover.py', scriptLines: 135, hasLintIssue: false,
    dependsOn: ['stock_daily_kline', 'capital_info'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '股票代码(带后缀)', nullable: false },
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'turnover', type: 'DOUBLE', cn: '换手率%(成交量/流通股本*100)', nullable: true },
      { name: 'pct_chg', type: 'DOUBLE', cn: '涨跌幅%((close-前日close)/前日close*100)', nullable: true }
    ],
    dedupKey: ['code', 'date'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'dim_industry_code', cn: '研究行业代码维度表', dir: '2_计算', sort: '036',
    schedule: 'weekly', mode: 'full', source: 'SQL派生', type: '维度',
    rows: 2_500, maxDate: null, dateCol: null, freshness: '无日期列', health: 'yellow',
    script: '36_dim_industry_code.py', scriptLines: 117, hasLintIssue: true,
    dependsOn: ['stock_industry_3level'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: '名称', type: 'VARCHAR', cn: '名称', nullable: true },
      { name: '级别', type: 'VARCHAR', cn: '级别', nullable: true },
      { name: '行业一级代码', type: 'VARCHAR', cn: '行业一级代码', nullable: true },
      { name: '行业一级名称', type: 'VARCHAR', cn: '行业一级名称', nullable: true },
      { name: '行业二级代码', type: 'VARCHAR', cn: '行业二级代码', nullable: true },
      { name: '行业二级名称', type: 'VARCHAR', cn: '行业二级名称', nullable: true },
      { name: '行业三级代码', type: 'VARCHAR', cn: '行业三级代码', nullable: true },
      { name: '行业三级名称', type: 'VARCHAR', cn: '行业三级名称', nullable: true }
    ],
    dedupKey: ['code'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 't_bk5_19_industry_labeled', cn: '板块BK交易数据_打行业标签', dir: '2_计算', sort: '036',
    schedule: 'weekly', mode: 'full', source: '视图(SQL派生)', type: '视图',
    rows: 0, maxDate: null, dateCol: 'date', freshness: '—', health: 'white',
    script: '36_dim_industry_code.py', scriptLines: 117, hasLintIssue: true,
    dependsOn: ['t_bk5_19', 'dim_industry_code'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'date', type: 'DATE', cn: '日期', nullable: false },
      { name: 'code', type: 'VARCHAR', cn: '代码', nullable: false },
      { name: 'bk_name', type: 'VARCHAR', cn: '板块指标名', nullable: true },
      { name: 'pe_ttm', type: 'DOUBLE', cn: '市盈率TTM', nullable: true },
      { name: 'pb_mrq', type: 'DOUBLE', cn: '市净率MRQ', nullable: true },
      { name: 'ps_ttm', type: 'DOUBLE', cn: '市销率TTM', nullable: true },
      { name: 'pc_ttm', type: 'DOUBLE', cn: '市现率TTM', nullable: true },
      { name: '涨跌数', type: 'DOUBLE', cn: '涨跌数', nullable: true },
      { name: '总市值', type: 'DOUBLE', cn: '总市值', nullable: true },
      { name: '流通市值', type: 'DOUBLE', cn: '流通市值', nullable: true },
      { name: '涨停数', type: 'DOUBLE', cn: '涨停数', nullable: true },
      { name: '跌停数', type: 'DOUBLE', cn: '跌停数', nullable: true },
      { name: '涨停数据', type: 'DOUBLE', cn: '涨停数据', nullable: true },
      { name: '融资融券', type: 'DOUBLE', cn: '融资融券', nullable: true },
      { name: '陆股通流入', type: 'DOUBLE', cn: '陆股通流入', nullable: true },
      { name: '开盘成交数', type: 'DOUBLE', cn: '开盘成交数', nullable: true },
      { name: '股息率', type: 'DOUBLE', cn: '股息率', nullable: true },
      { name: '自由流通市值', type: 'DOUBLE', cn: '自由流通市值', nullable: true },
      { name: '级别', type: 'VARCHAR', cn: '级别', nullable: true },
      { name: '行业一级代码', type: 'VARCHAR', cn: '行业一级代码', nullable: true },
      { name: '行业一级名称', type: 'VARCHAR', cn: '行业一级名称', nullable: true },
      { name: '行业二级代码', type: 'VARCHAR', cn: '行业二级代码', nullable: true },
      { name: '行业二级名称', type: 'VARCHAR', cn: '行业二级名称', nullable: true },
      { name: '行业三级代码', type: 'VARCHAR', cn: '行业三级代码', nullable: true },
      { name: '行业三级名称', type: 'VARCHAR', cn: '行业三级名称', nullable: true }
    ],
    dedupKey: [], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_block_relation_industry_labeled', cn: '股票板块关系_打行业归属', dir: '2_计算', sort: '036',
    schedule: 'daily', mode: 'increment', source: '视图(SQL派生)', type: '视图',
    rows: 0, maxDate: null, dateCol: 'fetch_time', freshness: '—', health: 'white',
    script: '36_dim_industry_code.py', scriptLines: 117, hasLintIssue: true,
    dependsOn: ['stock_block_relation', 'stock_industry_3level'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: '板块代码', type: 'VARCHAR', cn: '板块代码', nullable: true },
      { name: '板块名称', type: 'VARCHAR', cn: '板块名称', nullable: true },
      { name: '板块类型', type: 'VARCHAR', cn: '板块类型', nullable: true },
      { name: '成分股数', type: 'INTEGER', cn: '成分股数', nullable: true },
      { name: 'fetch_time', type: 'TIMESTAMP', cn: 'TODO', nullable: true },
      { name: '行业一级代码', type: 'VARCHAR', cn: '行业一级代码', nullable: true },
      { name: '行业一级名称', type: 'VARCHAR', cn: '行业一级名称', nullable: true },
      { name: '行业二级代码', type: 'VARCHAR', cn: '行业二级代码', nullable: true },
      { name: '行业二级名称', type: 'VARCHAR', cn: '行业二级名称', nullable: true },
      { name: '行业三级代码', type: 'VARCHAR', cn: '行业三级代码', nullable: true },
      { name: '行业三级名称', type: 'VARCHAR', cn: '行业三级名称', nullable: true }
    ],
    dedupKey: [], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'pianpao_daily', cn: '骗炮日表', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'pianpao_engine', type: '多表',
    rows: 9_840_000, maxDate: _todayStr, dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '70_pianpao_daily.py', scriptLines: 124, hasLintIssue: true,
    dependsOn: ['stock_daily_kline'], sourceDeps: ['pianpao_engine'],
    downstream: ['pianpao_daily_summary'],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日期', nullable: false },
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'stock_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'level', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'severity', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'prev_close', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'open_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'close_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'high_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'low_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'gap_up_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'open_to_close_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'day_change_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'upper_shadow_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'zt_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'zt_distance', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'touched_zt', type: 'BOOLEAN', cn: 'TODO', nullable: true },
      { name: 'prev1_change', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'prev3_trend', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'prev3_total_change', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'scenario', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'sectors', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'trap_direction', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'trap_type', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'lifecycle_stage', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'trap_confirmed', type: 'BOOLEAN', cn: 'TODO', nullable: true },
      { name: 'turnover', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'vol_ratio_5d', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'consecutive_zt', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'break_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'seal_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'ma5', type: 'DOUBLE', cn: '5日均线', nullable: true },
      { name: 'ma10', type: 'DOUBLE', cn: '10日均线', nullable: true },
      { name: 'ma20', type: 'DOUBLE', cn: '20日均线', nullable: true },
      { name: 'ma60', type: 'DOUBLE', cn: '60日均线', nullable: true },
      { name: 'dev_ma20', type: 'DOUBLE', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['trade_date', 'stock_code'], retryConfig: { max: 2, backoff: 30 },
  },
  {
    table: 'pianpao_daily_summary', cn: '骗炮日汇总', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'pianpao_engine', type: '多表',
    rows: 500, maxDate: _todayStr, dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '71_pianpao_batch.py', scriptLines: 171, hasLintIssue: true,
    dependsOn: ['pianpao_daily'], sourceDeps: ['pianpao_engine'],
    downstream: [],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日期', nullable: false },
      { name: 'total_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 's_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'a_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'b_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'c_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'avg_gap_up', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'avg_intraday_drop', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'zt_rejected', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'sector_linked', type: 'INTEGER', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['trade_date'], retryConfig: { max: 2, backoff: 30 },
  },
  {
    table: 'pianpao_intraday', cn: '骗炮分时表', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'pianpao_engine', type: '多表',
    rows: 2_000_000, maxDate: _todayStr, dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '71_pianpao_batch.py', scriptLines: 171, hasLintIssue: true,
    dependsOn: ['stock_kline_1m'], sourceDeps: ['pianpao_engine'],
    downstream: ['pianpao_intraday_events', 'pianpao_intraday_periods'],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日期', nullable: false },
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'total_bars', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'peak_time', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'peak_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'peak_idx', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'rise_bars', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'rise_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'rise_speed', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'fall_bars', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'fall_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'fall_speed', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'surge_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'crash_count', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'surge_vol_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'crash_vol_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'rise_fall_vol_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'surge_vol_label', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'crash_vol_label', type: 'VARCHAR', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['trade_date', 'stock_code'], retryConfig: { max: 2, backoff: 30 },
  },
  {
    table: 'pianpao_intraday_events', cn: '骗炮事件', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'pianpao_engine', type: '多表',
    rows: 150_000, maxDate: _todayStr, dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '71_pianpao_batch.py', scriptLines: 171, hasLintIssue: true,
    dependsOn: ['pianpao_intraday'], sourceDeps: ['pianpao_engine'],
    downstream: [],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日期', nullable: false },
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'seq', type: 'INTEGER', cn: 'TODO', nullable: true },
      { name: 'event_type', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'start_time', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'end_time', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'start_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'end_price', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'speed_label', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true }
    ],
    dedupKey: ['trade_date', 'stock_code'], retryConfig: { max: 2, backoff: 30 },
  },
  {
    table: 'pianpao_intraday_periods', cn: '骗炮分时时段', dir: '2_计算', sort: '070',
    schedule: 'daily', mode: 'increment', source: 'pianpao_engine', type: '多表',
    rows: 500_000, maxDate: _todayStr, dateCol: 'trade_date', freshness: '最新', health: 'green',
    script: '71_pianpao_batch.py', scriptLines: 171, hasLintIssue: true,
    dependsOn: ['pianpao_intraday'], sourceDeps: ['pianpao_engine'],
    downstream: [],
    columns: [
      { name: 'trade_date', type: 'DATE', cn: '交易日期', nullable: false },
      { name: 'stock_code', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'period_name', type: 'VARCHAR', cn: 'TODO', nullable: true },
      { name: 'change_pct', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'max_gain', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'max_loss', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'vol_ratio', type: 'DOUBLE', cn: 'TODO', nullable: true },
      { name: 'bar_count', type: 'INTEGER', cn: 'TODO', nullable: true }
    ],
    dedupKey: ['trade_date', 'stock_code'], retryConfig: { max: 2, backoff: 30 },
  },
  {
    table: 'stock_kline_15m', cn: '股票15分钟K线', dir: '2_计算', sort: '082',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合', type: '事实',
    rows: 13_200_000, maxDate: _todayStr, dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '82_stock_kline_15m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true }
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_30m', cn: '股票30分钟K线', dir: '2_计算', sort: '083',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合', type: '事实',
    rows: 6_600_000, maxDate: _todayStr, dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '83_stock_kline_30m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true }
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
  },
  {
    table: 'stock_kline_60m', cn: '股票60分钟K线', dir: '2_计算', sort: '084',
    schedule: 'daily', mode: 'increment', source: 'SQL聚合', type: '事实',
    rows: 3_300_000, maxDate: _todayStr, dateCol: 'trade_time', freshness: '最新', health: 'green',
    script: '84_stock_kline_60m.py', scriptLines: 119, hasLintIssue: false,
    dependsOn: ['stock_kline_5m'], sourceDeps: [],
    downstream: [],
    columns: [
      { name: 'code', type: 'VARCHAR', cn: '证券代码', nullable: false },
      { name: 'trade_time', type: 'TIMESTAMP', cn: '交易时间', nullable: false },
      { name: 'open', type: 'DOUBLE', cn: '今开', nullable: true },
      { name: 'high', type: 'DOUBLE', cn: '最高', nullable: true },
      { name: 'low', type: 'DOUBLE', cn: '最低', nullable: true },
      { name: 'close', type: 'DOUBLE', cn: '收盘价', nullable: true },
      { name: 'volume', type: 'BIGINT', cn: '成交量', nullable: true },
      { name: 'amount', type: 'DOUBLE', cn: '成交额', nullable: true }
    ],
    dedupKey: ['code', 'trade_time'], retryConfig: { max: 3, backoff: 30 },
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
      { table: 'market_sc1_42', detail: '40+列含中文 (融资融券_融资余额/陆股通资金流入_沪股通流入/...)', fix: '统一英文列名，中文含义放 dim 表' },
      { table: 't_bk5_19', detail: '列 涨跌数/总市值/流通市值/涨停数/跌停数 等11列含中文', fix: '统一英文列名' },
      { table: 'stock_industry_3level', detail: '列 行业一级代码/行业一级名称/... 等6列含中文', fix: 'rename 为 ind1_code/ind1_name/...' },
      { table: 'stock_kline_weekly', detail: '列 涨跌幅 含中文', fix: 'rename 为 change_pct' },
      { table: 'stock_kline_monthly', detail: '列 涨跌幅 含中文', fix: 'rename 为 change_pct' },
      { table: 'dim_industry_code', detail: '列 名称/级别/行业一级代码/... 等8列含中文', fix: 'rename 为 name/level/ind1_code/...' },
    ],
  },
  {
    id: 'R005', name: 'sort编号唯一', level: 'RED',
    description: 'sort 编号全局唯一，禁撞号',
    violations: [
      { table: 'pianpao_daily/pianpao_daily_summary/pianpao_intraday/pianpao_intraday_events/pianpao_intraday_periods', detail: 'sort=070 5表撞号（多表产物共享脚本）', fix: '多表产物可保持，但建议 070/071/072... 子编号' },
      { table: 'dim_industry_code/t_bk5_19_industry_labeled/stock_block_relation_industry_labeled', detail: 'sort=036 3表撞号（视图与源表同脚本）', fix: '视图可标记为派生，不占独立编号' },
    ],
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
  { id: 1, table: 'trading_calendar', runId: `r-${_todayStr.replace(/-/g, '')}1700-001`, trigger: 'schedule', status: 'success', startedAt: mockDT('17:00:12'), finishedAt: mockDT('17:00:18'), durationSec: 6, rowsIn: 1, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 2, table: 'stock_daily_kline', runId: `r-${_todayStr.replace(/-/g, '')}1700-002`, trigger: 'schedule', status: 'success', startedAt: mockDT('17:00:18'), finishedAt: mockDT('17:04:42'), durationSec: 264, rowsIn: 4960, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 3, table: 'stock_kline_5m', runId: `r-${_todayStr.replace(/-/g, '')}1700-003`, trigger: 'schedule', status: 'success', startedAt: mockDT('17:04:42'), finishedAt: mockDT('17:22:15'), durationSec: 1053, rowsIn: 198000, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 4, table: 'stock_kline_1m', runId: `r-${_todayStr.replace(/-/g, '')}1700-004`, trigger: 'schedule', status: 'success', startedAt: mockDT('17:22:15'), finishedAt: mockDT('18:15:33'), durationSec: 3198, rowsIn: 990000, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 5, table: 'capital_info', runId: `r-${_todayStr.replace(/-/g, '')}1700-005`, trigger: 'schedule', status: 'failed', startedAt: mockDT('18:15:33'), finishedAt: mockDT('18:16:01'), durationSec: 28, rowsIn: 0, error: 'tqcenter 连接超时 (get_gb_info_by_date)', force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 6, table: 'capital_info', runId: `r-${_todayStr.replace(/-/g, '')}1720-006`, trigger: 'health-fix', status: 'success', startedAt: mockDT('18:20:00'), finishedAt: mockDT('18:38:44'), durationSec: 1124, rowsIn: 2980000, error: null, force: true, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 7, table: 'stock_financial_data', runId: `r-${_todayStr.replace(/-/g, '')}1700-007`, trigger: 'schedule', status: 'success', startedAt: mockDT('18:38:44'), finishedAt: mockDT('18:42:10'), durationSec: 206, rowsIn: 8600, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 8, table: 't_bk5_19', runId: `r-${_todayStr.replace(/-/g, '')}1700-008`, trigger: 'schedule', status: 'failed', startedAt: mockDT('18:42:10'), finishedAt: mockDT('18:42:12'), durationSec: 2, rowsIn: 0, error: '@meta mode=increment 与 MODE="full" 矛盾，DELETE 逻辑错乱', force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 9, table: 'sector_stocks', runId: `r-${_todayStr.replace(/-/g, '')}1700-009`, trigger: 'schedule', status: 'skipped', startedAt: mockDT('18:42:12'), finishedAt: mockDT('18:42:12'), durationSec: 0, rowsIn: 0, error: 'ensure_table 字面量 "表名" 未实现', force: false, logPath: null },
  { id: 10, table: 'pianpao_daily', runId: `r-${_todayStr.replace(/-/g, '')}1700-010`, trigger: 'schedule', status: 'success', startedAt: mockDT('18:42:12'), finishedAt: mockDT('18:48:55'), durationSec: 403, rowsIn: 4960, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 11, table: 'stock_kline_15m', runId: `r-${_todayStr.replace(/-/g, '')}1700-011`, trigger: 'schedule', status: 'success', startedAt: mockDT('18:48:55'), finishedAt: mockDT('18:55:22'), durationSec: 387, rowsIn: 66000, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 12, table: 'stock_kline_30m', runId: `r-${_todayStr.replace(/-/g, '')}1700-012`, trigger: 'schedule', status: 'success', startedAt: mockDT('18:55:22'), finishedAt: mockDT('18:58:40'), durationSec: 198, rowsIn: 33000, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 13, table: 'stock_kline_60m', runId: `r-${_todayStr.replace(/-/g, '')}1700-013`, trigger: 'schedule', status: 'success', startedAt: mockDT('18:58:40'), finishedAt: mockDT('19:00:15'), durationSec: 95, rowsIn: 16500, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 14, table: 'dim_security_type', runId: `r-${_todayStr.replace(/-/g, '')}1700-014`, trigger: 'schedule', status: 'success', startedAt: mockDT('19:00:15'), finishedAt: mockDT('19:00:22'), durationSec: 7, rowsIn: 12400, error: null, force: false, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
  { id: 15, table: 't_bk5_19', runId: `r-${_todayStr.replace(/-/g, '')}1905-015`, trigger: 'manual', status: 'running', startedAt: mockDT('19:05:00'), finishedAt: null, durationSec: null, rowsIn: null, error: null, force: true, logPath: `logs/run_${_todayStr.replace(/-/g, '')}.log` },
]

// 日志
export interface LogEntry {
  ts: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
  table: string
  message: string
}

export const LOGS: LogEntry[] = [
  { ts: mockDT('17:00:12'), level: 'INFO', table: 'trading_calendar', message: '▶ 开始 trading_calendar' },
  { ts: mockDT('17:00:18'), level: 'INFO', table: 'trading_calendar', message: '✔ trading_calendar 入库完成，共 1 条' },
  { ts: mockDT('17:00:18'), level: 'INFO', table: 'stock_daily_kline', message: '▶ 开始 stock_daily_kline' },
  { ts: mockDT('17:00:19'), level: 'INFO', table: 'stock_daily_kline', message: `  增量模式，最小日期: ${_todayStr.replace(/-/g, '')}` },
  { ts: mockDT('17:04:42'), level: 'INFO', table: 'stock_daily_kline', message: '✔ stock_daily_kline 完成，共 4,960 条' },
  { ts: mockDT('17:04:42'), level: 'INFO', table: 'stock_kline_5m', message: '▶ 开始 stock_kline_5m' },
  { ts: mockDT('17:22:15'), level: 'INFO', table: 'stock_kline_5m', message: '✔ stock_kline_5m 完成，共 198,000 条' },
  { ts: mockDT('18:15:33'), level: 'INFO', table: 'capital_info', message: '▶ 开始 capital_info' },
  { ts: mockDT('18:16:01'), level: 'ERROR', table: 'capital_info', message: '✘ capital_info 失败: tqcenter 连接超时 (get_gb_info_by_date)' },
  { ts: mockDT('18:20:00'), level: 'INFO', table: 'capital_info', message: '▶ 重跑 capital_info (force=True) ...' },
  { ts: mockDT('18:38:44'), level: 'INFO', table: 'capital_info', message: '✔ capital_info 完成: 2,980,000 行, 失败 0 股' },
  { ts: mockDT('18:42:10'), level: 'ERROR', table: 't_bk5_19', message: '✘ t_bk5_19 失败: @meta mode=increment 与 MODE="full" 矛盾，DELETE 逻辑错乱' },
  { ts: mockDT('18:42:12'), level: 'WARNING', table: 'sector_stocks', message: '○ sector_stocks 数据为空，跳过 (ensure_table 字面量 "表名" 未实现)' },
  { ts: mockDT('18:42:12'), level: 'INFO', table: 'pianpao_daily', message: `▶ 骗炮分析 ${_todayStr}` },
  { ts: mockDT('18:48:55'), level: 'INFO', table: 'pianpao_daily', message: '✔ pianpao_daily 完成' },
  { ts: mockDT('19:05:00'), level: 'INFO', table: 't_bk5_19', message: '▶ 手动触发 t_bk5_19 (force=True) ...' },
  { ts: mockDT('19:05:15'), level: 'DEBUG', table: 't_bk5_19', message: '  读取 gpsh*.dat 文件 32/32' },
]

// 调度计划
export interface SchedulePlan {
  name: string
  cron: string
  tier: Schedule | 'all'
  nextRun: string
  lastStatus: RunStatus | null
  tables: number
}

export const SCHEDULES: SchedulePlan[] = [
  { name: 'daily_1700', cron: '0 17 * * 1-5', tier: 'daily', nextRun: `${new Date(Date.now() + 86400000).toISOString().slice(0, 10)} 17:00`, lastStatus: 'success', tables: 18 },
  { name: 'weekly_friday', cron: '0 18 * * 5', tier: 'weekly', nextRun: `${mockDate(2)} 18:00`, lastStatus: 'success', tables: 1 },
  { name: 'monthly_last', cron: '0 19 28-31 * *', tier: 'monthly', nextRun: `${mockDate(5)} 19:00`, lastStatus: 'success', tables: 1 },
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
  { id: 'a1', level: 'red', table: 't_bk5_19', type: 'health', message: `滞后：最新数据 ${_yesterdayStr} < 最后交易日 ${_todayStr}`, ts: mockDT('19:00') },
  { id: 'a2', level: 'red', table: 'sector_stocks', type: 'health', message: '空表（脚本未实现，ensure_table 字面量"表名"）', ts: mockDT('19:00') },
  { id: 'a3', level: 'red', table: 't_bk5_19', type: 'lint', message: 'R002: @meta mode 与代码 MODE 矛盾', ts: mockDT('19:00') },
  { id: 'a4', level: 'red', table: 'capital_info', type: 'lint', message: 'R009: 反向 import run.py（循环依赖）', ts: mockDT('19:00') },
  { id: 'a5', level: 'yellow', table: 'stock_daily_kline', type: 'lint', message: 'R004: 列名含中文 (涨跌幅/换手率/前复权因子)', ts: mockDT('19:00') },
  { id: 'a6', level: 'yellow', table: 'stock_block_relation', type: 'lint', message: 'R004: 列名含中文 (板块代码/板块名称/板块类型/成分股数)', ts: mockDT('19:00') },
  { id: 'a7', level: 'yellow', table: 'capital_info', type: 'run', message: '今日首次失败，已自动 health-fix 重试成功', ts: mockDT('18:16') },
  { id: 'a8', level: 'yellow', table: '(全局)', type: 'lint', message: 'R011: DB_PATH 硬编码 49 处；R012: TQ 初始化重复 9 份', ts: mockDT('19:00') },
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

// 健康度矩阵 (近7天每表每天的状态)
export const HEALTH_MATRIX: { table: string; days: { date: string; status: 'success' | 'failed' | 'skipped' | 'none' }[] }[] = TABLES.map(t => ({
  table: t.table,
  days: ['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25'].map(d => {
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
  { date: '06-21', total: 0, success: 0, failed: 0, skipped: 0, totalRows: 0, durationMin: 0 }, // 周末
  { date: '06-22', total: 0, success: 0, failed: 0, skipped: 0, totalRows: 0, durationMin: 0 }, // 周末
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
  { dir: '1_入库', tables: 18, totalLines: 2734 },
  { dir: '2_计算', tables: 16, totalLines: 1079 },
]

// 样例数据生成器：根据表的列定义生成 mock 前 5 行
export function genSampleData(table: TableMeta): { columns: string[]; rows: (string | number | boolean)[][] } {
  const cols = table.columns.map(c => c.name)
  // 根据表名生成不同风格的样例数据
  if (table.table === 'stock_daily_kline') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', _todayStr, 1685.20, 1702.50, 1678.80, 1698.30, 2456789, 4168000000, 2.35, 0.58, 1.0000],
        ['000858.SZ', _todayStr, 168.50, 171.20, 167.30, 170.45, 15678234, 2670000000, 3.12, 1.85, 1.0000],
        ['300750.SZ', _todayStr, 245.80, 248.60, 244.10, 247.20, 8923456, 2205000000, 1.05, 0.42, 1.0000],
        ['601318.SH', _todayStr, 52.30, 52.85, 51.92, 52.68, 23456789, 1235000000, 0.78, 0.15, 1.0000],
        ['000333.SZ', _todayStr, 78.45, 79.20, 77.80, 78.95, 12345678, 975000000, 1.02, 0.38, 1.0000],
      ],
    }
  }
  if (table.table.includes('kline')) {
    return {
      columns: cols,
      rows: [
        ['600519.SH', mockDT('14:55:00'), 1698.00, 1699.50, 1697.20, 1698.30, 12500, 21200000],
        ['600519.SH', mockDT('14:56:00'), 1698.30, 1700.00, 1697.80, 1699.20, 8900, 15100000],
        ['600519.SH', mockDT('14:57:00'), 1699.20, 1701.50, 1698.50, 1700.80, 15600, 26500000],
        ['600519.SH', mockDT('14:58:00'), 1700.80, 1702.50, 1700.00, 1701.20, 11200, 19000000],
        ['600519.SH', mockDT('14:59:00'), 1701.20, 1702.50, 1700.50, 1702.10, 23400, 39800000],
      ],
    }
  }
  if (table.table === 'trading_calendar') {
    return {
      columns: cols,
      rows: [
        [_todayStr, true, 'A股'],
        [_todayStr, true, 'A股'],
        [`${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}`, false, 'A股'],
        [`${mockDate(2)}`, false, 'A股'],
        [`${mockDate(3)}`, true, 'A股'],
      ],
    }
  }
  if (table.table === 'capital_info') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', _todayStr, 1256.20, 12.56, 12.56, 1256.20],
        ['000858.SZ', _todayStr, 1299.00, 12.99, 12.99, 1299.00],
        ['300750.SZ', _todayStr, 433.40, 4.33, 4.33, 433.40],
        ['601318.SH', _todayStr, 9114.00, 91.14, 91.14, 9114.00],
        ['000333.SZ', _todayStr, 10401.00, 104.01, 104.01, 10401.00],
      ],
    }
  }
  if (table.table === 'pianpao_daily') {
    return {
      columns: cols,
      rows: [
        ['600519.SH', _todayStr, 95.2],
        ['000858.SZ', _todayStr, 91.8],
        ['300750.SZ', _todayStr, 88.5],
        ['601318.SH', _todayStr, 85.1],
        ['000333.SZ', _todayStr, 82.7],
      ],
    }
  }
  if (table.table === 'stock_block_relation') {
    return {
      columns: cols,
      rows: [
        ['人工智能', 'BK0001', '概念板块', 187, mockDT('17:00')],
        ['芯片', 'BK0002', '概念板块', 156, mockDT('17:00')],
        ['新能源车', 'BK0003', '概念板块', 142, mockDT('17:00')],
        ['光伏', 'BK0004', '概念板块', 128, mockDT('17:00')],
        ['医药', 'BK0005', '行业板块', 119, mockDT('17:00')],
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
        [_yesterdayStr, 'BK0001', '人工智能', 35.2, 187],
        [_yesterdayStr, 'BK0002', '芯片', 28.5, 156],
        [_yesterdayStr, 'BK0003', '新能源车', 22.1, 142],
        [_yesterdayStr, 'BK0004', '光伏', 18.7, 128],
        [_yesterdayStr, 'BK0005', '医药', 15.3, 119],
      ],
    }
  }
  // 默认：根据列定义生成通用样例
  return {
    columns: cols,
    rows: Array.from({ length: 5 }, (_, i) => cols.map((c, j) => {
      if (c.toLowerCase().includes('date') || c === 'date' || c.toLowerCase().includes('time')) return `${_todayStr}`
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

// ─── 交易日历 Mock 数据 & 工具函数 ──────────────────────────
export const TRADING_CALENDAR = {
  /** 最近交易日 */
  latestTradingDay: mockDate(0),
  /** 今天是否为交易日 (简化版: 周一~周五) */
  isTradingDay: new Date().getDay() >= 1 && new Date().getDay() <= 5,
  /** 最近 10 个交易日 */
  recentDays: (() => {
    const d = new Date()
    const result: string[] = []
    // If today is not a trading day, start looking from yesterday
    if (d.getDay() === 0 || d.getDay() === 6) {
      d.setDate(d.getDate() - 1)
    }
    while (result.length < 10) {
      const day = d.getDay()
      if (day >= 1 && day <= 5) {
        result.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
      }
      d.setDate(d.getDate() - 1)
    }
    return result
  })(),
  /** 下一交易日 */
  nextTradingDay: (() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })(),
}

/** 判断指定日期是否为交易日 (简化版: 周一~周五, 真实环境应查 trading_calendar 表) */
export function isTradingDay(date?: Date): boolean {
  const d = date || new Date()
  const day = d.getDay()
  return day >= 1 && day <= 5 // Mon-Fri (simplified, real: check calendar)
}

/** 获取最近交易日 (YYYY-MM-DD) */
export function getLastTradingDay(): string {
  const d = new Date()
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 获取下一交易日 (YYYY-MM-DD) */
export function getNextTradingDay(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 新鲜度分布（用于 Analytics 视图）
export const FRESHNESS_DISTRIBUTION: { freshness: string; count: number; color: string }[] = [
  { freshness: '最新', count: 24, color: 'emerald' },
  { freshness: '无日期列', count: 7, color: 'amber' },
  { freshness: '—', count: 3, color: 'zinc' },
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
