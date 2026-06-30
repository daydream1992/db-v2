// DataOps 实时日志流 WebSocket 服务 (v2)
// 支持 execution:start / execution:cancel / execution:progress / log:line / execution:complete 事件协议
// 前端连接: io('/?XTransformPort=3003')
import { createServer } from 'http'
import { Server } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

// ---- 类型定义 ----
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'

interface LogLine {
  timestamp: string
  level: LogLevel
  message: string
  table?: string
}

interface ExecutionProgress {
  tablesCompleted: number
  tablesTotal: number
  currentTable: string
  percent: number
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
  startedAt?: string
  finishedAt?: string
}

// ---- 18 个 daily 表的模拟剧本 ----
interface TableScript {
  table: string
  cn: string
  steps: { delay: number; level: LogLevel; msg: () => string; progress?: number }[]
}

const DAILY_TABLES: TableScript[] = [
  {
    table: 'trading_calendar', cn: '交易日历',
    steps: [
      { delay: 200, level: 'INFO', msg: () => '▶ 开始 trading_calendar' },
      { delay: 600, level: 'INFO', msg: () => '  调用 tq.get_trading_dates → 730 条', progress: 50 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ trading_calendar 完成，1 条新增', progress: 100 },
    ],
  },
  {
    table: 'stock_daily_kline', cn: '股票日K线',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_daily_kline (增量)' },
      { delay: 800, level: 'INFO', msg: () => '  读取 TDX *.day 4896/4896', progress: 30 },
      { delay: 600, level: 'INFO', msg: () => '  写入 DuckDB upsert 4,960 行', progress: 70 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_daily_kline 完成', progress: 100 },
    ],
  },
  {
    table: 'stock_kline_5m', cn: '5分钟K线',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_5m' },
      { delay: 900, level: 'INFO', msg: () => '  解析 .lc5 → 198,000 条', progress: 40 },
      { delay: 700, level: 'INFO', msg: () => '  分批写入 batch=10000', progress: 80 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_kline_5m 完成', progress: 100 },
    ],
  },
  {
    table: 'stock_kline_1m', cn: '1分钟K线',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_1m' },
      { delay: 1000, level: 'INFO', msg: () => '  解析 .lc1 → 960,000 条', progress: 35 },
      { delay: 800, level: 'INFO', msg: () => '  分批写入 batch=10000', progress: 75 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_kline_1m 完成', progress: 100 },
    ],
  },
  {
    table: 'capital_info', cn: '股本数据',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 capital_info' },
      { delay: 800, level: 'INFO', msg: () => '  全量回补 近1年 4896 股', progress: 10 },
      { delay: 1200, level: 'INFO', msg: () => '  进度 2500/4896', progress: 50 },
      { delay: 1000, level: 'INFO', msg: () => '  进度 4500/4896', progress: 90 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ capital_info 完成: 2,980,000 行', progress: 100 },
    ],
  },
  {
    table: 'stock_financial_data', cn: '股票财务数据',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_financial_data' },
      { delay: 700, level: 'INFO', msg: () => '  API 拉取 2026Q2 报表', progress: 40 },
      { delay: 500, level: 'INFO', msg: () => '  写入 12,400 行', progress: 80 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_financial_data 完成', progress: 100 },
    ],
  },
  {
    table: 'sjb_api_plhqL2kz_88zd', cn: 'L2快照88字段',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 sjb_api_plhqL2kz_88zd' },
      { delay: 900, level: 'INFO', msg: () => '  TQ API 拉取 L2 快照', progress: 30 },
      { delay: 600, level: 'WARNING', msg: () => '  ⚠ 部分字段为 NULL (预期行为)', progress: 60 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ sjb_api_plhqL2kz_88zd 完成', progress: 100 },
    ],
  },
  {
    table: 'stock_block_relation', cn: '股票板块关系',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_block_relation' },
      { delay: 600, level: 'INFO', msg: () => '  TQ API 拉取板块成分', progress: 50 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_block_relation 完成', progress: 100 },
    ],
  },
  {
    table: 'market_sc1_42', cn: '市场SC宏观指标',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 market_sc1_42' },
      { delay: 500, level: 'INFO', msg: () => '  读取二进制 → 42 指标', progress: 50 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ market_sc1_42 完成', progress: 100 },
    ],
  },
  {
    table: 'stock_gp1_46_indicators', cn: '个股GP指标',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_gp1_46_indicators' },
      { delay: 700, level: 'INFO', msg: () => '  读取二进制 46 字段', progress: 40 },
      { delay: 500, level: 'INFO', msg: () => '  写入 89,000 行', progress: 80 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_gp1_46_indicators 完成', progress: 100 },
    ],
  },
  {
    table: 'sector_stocks', cn: '板块成份股',
    steps: [
      { delay: 250, level: 'INFO', msg: () => '▶ 开始 sector_stocks' },
      { delay: 400, level: 'WARNING', msg: () => '  ○ sector_stocks 数据为空，跳过' },
    ],
  },
  {
    table: 't_bk5_19', cn: '板块BK交易数据',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 t_bk5_19' },
      { delay: 500, level: 'WARNING', msg: () => '  ⚠ @meta mode=increment 与代码 MODE="full" 矛盾' },
      { delay: 300, level: 'ERROR', msg: () => '✘ t_bk5_19 失败: DELETE 逻辑错乱，数据未入库' },
    ],
  },
  {
    table: 'dim_security_type', cn: '证券类型维表',
    steps: [
      { delay: 250, level: 'INFO', msg: () => '▶ 开始 dim_security_type' },
      { delay: 400, level: 'INFO', msg: () => '  SELECT DISTINCT → 分类 4896 股', progress: 60 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ dim_security_type 完成 12,400 条', progress: 100 },
    ],
  },
  {
    table: 'stock_daily_turnover', cn: '日换手率涨跌幅',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_daily_turnover' },
      { delay: 500, level: 'INFO', msg: () => '  SQL 计算 换手率 + 涨跌幅', progress: 50 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_daily_turnover 完成', progress: 100 },
    ],
  },
  {
    table: 'stock_kline_15m', cn: '15分钟K线',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_15m' },
      { delay: 600, level: 'INFO', msg: () => '  SQL 聚合 1m→15m', progress: 40 },
      { delay: 500, level: 'INFO', msg: () => '  写入 66,000 行', progress: 80 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_kline_15m 完成', progress: 100 },
    ],
  },
  {
    table: 'pianpao_daily', cn: '骗炮日表',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 pianpao_daily' },
      { delay: 800, level: 'INFO', msg: () => '  JOIN kline + dim_security_type', progress: 30 },
      { delay: 600, level: 'INFO', msg: () => '  扫描 4896 股 → 候选 4960', progress: 60 },
      { delay: 400, level: 'INFO', msg: () => '  评分 A/B/C 级', progress: 90 },
      { delay: 300, level: 'SUCCESS', msg: () => '✔ pianpao_daily 完成', progress: 100 },
    ],
  },
  {
    table: 'market_snapshot', cn: '市场快照',
    steps: [
      { delay: 300, level: 'INFO', msg: () => '▶ 开始 market_snapshot' },
      { delay: 500, level: 'INFO', msg: () => '  TQ API 拉取全市场快照', progress: 50 },
      { delay: 400, level: 'SUCCESS', msg: () => '✔ market_snapshot 完成', progress: 100 },
    ],
  },
]

// ---- 全局状态 ----
interface RunState {
  cancelled: boolean
  timer: ReturnType<typeof setTimeout> | null
  tablesCompleted: number
  startedAt: string
}

let currentRun: RunState | null = null

function formatTs(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function emitProgress(progress: ExecutionProgress) {
  io.emit('execution:progress', progress)
}

function emitLogLine(line: LogLine) {
  io.emit('log:line', line)
}

// 开始 daily 全量执行
function startDailyExecution() {
  if (currentRun) return // 已有运行中任务

  const tablesTotal = DAILY_TABLES.length
  const startedAt = formatTs(new Date())
  let tablesCompleted = 0
  let tableIdx = 0

  currentRun = { cancelled: false, timer: null, tablesCompleted: 0, startedAt }

  // 发送初始进度
  emitProgress({
    tablesCompleted: 0,
    tablesTotal,
    currentTable: DAILY_TABLES[0]?.table ?? '',
    percent: 0,
    status: 'running',
    startedAt,
  })

  function runNextTable() {
    if (!currentRun || currentRun.cancelled) {
      return
    }
    if (tableIdx >= DAILY_TABLES.length) {
      // 全部完成
      const finishedAt = formatTs(new Date())
      emitProgress({
        tablesCompleted,
        tablesTotal,
        currentTable: '',
        percent: 100,
        status: 'completed',
        startedAt,
        finishedAt,
      })
      io.emit('execution:complete', {
        tablesCompleted,
        tablesTotal,
        startedAt,
        finishedAt,
        failedTables: ['t_bk5_19'], // 模拟1个失败
        skippedTables: ['sector_stocks'], // 模拟1个跳过
      })
      currentRun = null
      return
    }

    const script = DAILY_TABLES[tableIdx]
    let stepIdx = 0

    function runNextStep() {
      if (!currentRun || currentRun.cancelled) return
      if (stepIdx >= script.steps.length) {
        // 当前表完成
        tablesCompleted++
        currentRun.tablesCompleted = tablesCompleted
        tableIdx++

        // 更新总进度
        const percent = Math.round((tablesCompleted / tablesTotal) * 100)
        emitProgress({
          tablesCompleted,
          tablesTotal,
          currentTable: DAILY_TABLES[tableIdx]?.table ?? '',
          percent,
          status: 'running',
          startedAt,
        })

        // 300ms 后开始下一个表
        currentRun.timer = setTimeout(runNextTable, 300)
        return
      }

      const step = script.steps[stepIdx]
      const logLine: LogLine = {
        timestamp: formatTs(new Date()),
        level: step.level,
        message: step.msg(),
        table: script.table,
      }
      emitLogLine(logLine)

      stepIdx++
      currentRun.timer = setTimeout(runNextStep, step.delay)
    }

    runNextStep()
  }

  runNextTable()
}

// 取消执行
function cancelExecution() {
  if (!currentRun) return
  currentRun.cancelled = true
  if (currentRun.timer) {
    clearTimeout(currentRun.timer)
  }
  emitProgress({
    tablesCompleted: currentRun.tablesCompleted,
    tablesTotal: DAILY_TABLES.length,
    currentTable: '',
    percent: Math.round((currentRun.tablesCompleted / DAILY_TABLES.length) * 100),
    status: 'cancelled',
    startedAt: currentRun.startedAt,
    finishedAt: formatTs(new Date()),
  })
  currentRun = null
}

// ---- 连接处理 ----
io.on('connection', (socket) => {
  console.log(`[log-streamer] client connected: ${socket.id}`)

  // 推送欢迎信息
  socket.emit('hello', {
    service: 'dataops-log-streamer',
    version: '2.0.0',
    tablesCount: DAILY_TABLES.length,
    isRunning: currentRun !== null,
  })

  // 客户端请求开始执行
  socket.on('execution:start', (data: { action: string; force?: boolean }) => {
    console.log(`[log-streamer] execution:start:`, data)
    if (currentRun) {
      socket.emit('error', { message: `已有运行中任务，请等待完成或取消后再试` })
      return
    }
    if (data.action === 'daily') {
      startDailyExecution()
    } else {
      socket.emit('error', { message: `不支持的操作: ${data.action}` })
    }
  })

  // 客户端请求取消执行
  socket.on('execution:cancel', () => {
    console.log(`[log-streamer] execution:cancel`)
    cancelExecution()
  })

  socket.on('disconnect', () => {
    console.log(`[log-streamer] client disconnected: ${socket.id}`)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[log-streamer] WebSocket server running on port ${PORT}`)
  console.log(`[log-streamer] ${DAILY_TABLES.length} daily tables loaded, ready for connections`)
})

// 全局未捕获异常处理
process.on('uncaughtException', (err) => {
  console.error('[log-streamer] uncaughtException:', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[log-streamer] unhandledRejection:', err)
})
process.on('SIGTERM', () => {
  console.log('[log-streamer] SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('[log-streamer] SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})
