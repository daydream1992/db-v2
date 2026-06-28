// DataOps 实时日志流 WebSocket 服务
// 模拟 pipeline 执行过程中的日志实时推送
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
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'
interface LiveLog {
  id: string
  ts: string
  level: LogLevel
  table: string
  message: string
  runId: string
  progress?: number // 0-100
}

// ---- 模拟数据：每个表的执行日志剧本 ----
interface LogScript {
  table: string
  cn: string
  steps: { delay: number; level: LogLevel; msg: (ctx: ScriptCtx) => string; progress?: number }[]
}
interface ScriptCtx {
  runId: string
  startTime: number
}

// 8 个典型表的执行剧本（覆盖成功/失败/跳过/运行中）
const SCRIPTS: LogScript[] = [
  {
    table: 'trading_calendar', cn: '交易日历',
    steps: [
      { delay: 300, level: 'INFO', msg: c => `▶ 开始 trading_calendar (run_id=${c.runId})` },
      { delay: 800, level: 'DEBUG', msg: () => '  调用 tq.get_trading_dates(2025-01-01, 2026-12-31)' },
      { delay: 600, level: 'INFO', msg: () => '  API 返回 730 条交易日', progress: 50 },
      { delay: 400, level: 'DEBUG', msg: () => '  去重 + upsert (date, market) → 1 条新增' },
      { delay: 300, level: 'INFO', msg: () => '✔ trading_calendar 完成，共 1 条', progress: 100 },
    ],
  },
  {
    table: 'stock_daily_kline', cn: '股票日K线',
    steps: [
      { delay: 400, level: 'INFO', msg: c => `▶ 开始 stock_daily_kline (run_id=${c.runId})` },
      { delay: 700, level: 'DEBUG', msg: () => '  增量模式，最小日期: 20260626' },
      { delay: 1200, level: 'INFO', msg: () => '  读取 TDX vipdoc/lday/*.day 文件 4896/4896', progress: 30 },
      { delay: 900, level: 'DEBUG', msg: () => '  解析二进制 → DataFrame (4,960 行)' },
      { delay: 800, level: 'INFO', msg: () => '  写入 DuckDB (upsert code+date)', progress: 70 },
      { delay: 400, level: 'INFO', msg: () => '✔ stock_daily_kline 完成，共 4,960 条', progress: 100 },
    ],
  },
  {
    table: 'stock_kline_5m', cn: '5分钟K线',
    steps: [
      { delay: 500, level: 'INFO', msg: c => `▶ 开始 stock_kline_5m (run_id=${c.runId})` },
      { delay: 1000, level: 'DEBUG', msg: () => '  读取 .lc5 文件 4896/4896' },
      { delay: 2000, level: 'INFO', msg: () => '  解析 5min K线 → 198,000 条', progress: 40 },
      { delay: 1500, level: 'INFO', msg: () => '  分批写入 (batch=10000)', progress: 80 },
      { delay: 800, level: 'INFO', msg: () => '✔ stock_kline_5m 完成，共 198,000 条', progress: 100 },
    ],
  },
  {
    table: 'capital_info', cn: '股本数据',
    steps: [
      { delay: 400, level: 'INFO', msg: c => `▶ 开始 capital_info (run_id=${c.runId})` },
      { delay: 1000, level: 'INFO', msg: () => '  全量回补 start=20250626(近1年), 已清空', progress: 10 },
      { delay: 1500, level: 'INFO', msg: () => '  区间 20250626~至今, 待拉 4896 股' },
      { delay: 2500, level: 'INFO', msg: () => '  进度 500/4896 (8.2股/秒, 已入 320,000 行)', progress: 25 },
      { delay: 2500, level: 'DEBUG', msg: () => '  进度 2500/4896 (8.5股/秒, 已入 1,600,000 行)', progress: 60 },
      { delay: 2000, level: 'INFO', msg: () => '  进度 4500/4896 (8.5股/秒, 已入 2,890,000 行)', progress: 92 },
      { delay: 800, level: 'INFO', msg: () => '✔ capital_info 完成: 2,980,000 行, 失败 0 股', progress: 100 },
    ],
  },
  {
    table: 't_bk5_19', cn: '板块BK交易数据',
    steps: [
      { delay: 400, level: 'INFO', msg: c => `▶ 开始 t_bk5_19 (run_id=${c.runId})` },
      { delay: 800, level: 'DEBUG', msg: () => '  读取 gpsh*.dat 文件 32/32' },
      { delay: 600, level: 'WARNING', msg: () => '  ⚠ @meta mode=increment 与代码 MODE="full" 矛盾' },
      { delay: 400, level: 'ERROR', msg: () => '✘ t_bk5_19 失败: DELETE 逻辑错乱，数据未入库', progress: 0 },
    ],
  },
  {
    table: 'sector_stocks', cn: '板块成份股',
    steps: [
      { delay: 300, level: 'INFO', msg: c => `▶ 开始 sector_stocks (run_id=${c.runId})` },
      { delay: 500, level: 'WARNING', msg: () => '○ sector_stocks 数据为空，跳过' },
      { delay: 200, level: 'DEBUG', msg: () => '  原因: ensure_table 字面量 "表名" 未实现' },
    ],
  },
  {
    table: 'pianpao_daily', cn: '骗炮每日明细',
    steps: [
      { delay: 500, level: 'INFO', msg: c => `▶ 开始 pianpao_daily (run_id=${c.runId})` },
      { delay: 800, level: 'INFO', msg: () => '  骗炮分析 2026-06-25' },
      { delay: 1200, level: 'DEBUG', msg: () => '  JOIN stock_daily_kline + stock_kline_1m + dim_security_type' },
      { delay: 1500, level: 'INFO', msg: () => '  扫描 4,896 股 × 240 分钟 → 候选 4,960', progress: 60 },
      { delay: 800, level: 'INFO', msg: () => '  评分 (A级/B级/C级)', progress: 90 },
      { delay: 400, level: 'INFO', msg: () => '✔ pianpao_daily 完成', progress: 100 },
    ],
  },
  {
    table: 'dim_security_type', cn: '证券类型维表',
    steps: [
      { delay: 300, level: 'INFO', msg: c => `▶ 开始 dim_security_type (run_id=${c.runId})` },
      { delay: 500, level: 'DEBUG', msg: () => '  SELECT DISTINCT code FROM stock_daily_kline' },
      { delay: 400, level: 'INFO', msg: () => '  分类 4896 股 → ETF/股票/指数/可转债', progress: 70 },
      { delay: 300, level: 'INFO', msg: () => '✔ dim_security_type 完成，共 12,400 条', progress: 100 },
    ],
  },
]

// ---- 全局状态：当前运行 + 客户端订阅 ----
let currentRun: { runId: string; scriptIdx: number; stepIdx: number; timer: any; status: 'running' | 'idle' } | null = null
const connectedClients = new Set<any>()

function formatTs(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function genRunId(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}`
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')
  return `r-${ts}-${seq}`
}

function emitLog(socket: any, log: LiveLog) {
  socket.emit('log', log)
}

function broadcastLog(log: LiveLog) {
  io.emit('log', log)
}

function broadcastStatus(status: any) {
  io.emit('status', status)
}

// 开始一个新 run
function startRun(scriptIdx: number, runId?: string) {
  const script = SCRIPTS[scriptIdx]
  if (!script) return
  const rid = runId || genRunId()
  const ctx: ScriptCtx = { runId: rid, startTime: Date.now() }

  currentRun = { runId: rid, scriptIdx, stepIdx: 0, timer: null, status: 'running' }

  broadcastStatus({
    type: 'run-start',
    runId: rid,
    table: script.table,
    cn: script.cn,
    startTime: formatTs(new Date()),
  })

  let stepIdx = 0
  const runNextStep = () => {
    if (!currentRun || stepIdx >= script.steps.length) {
      // run 完成
      const lastStep = script.steps[script.steps.length - 1]
      const failed = lastStep?.level === 'ERROR'
      broadcastStatus({
        type: 'run-end',
        runId: rid,
        table: script.table,
        status: failed ? 'failed' : 'success',
        endTime: formatTs(new Date()),
        durationSec: Math.floor((Date.now() - ctx.startTime) / 1000),
      })
      currentRun = null
      return
    }
    const step = script.steps[stepIdx]
    const log: LiveLog = {
      id: `${rid}-${stepIdx}`,
      ts: formatTs(new Date()),
      level: step.level,
      table: script.table,
      message: step.msg(ctx),
      runId: rid,
      progress: step.progress,
    }
    broadcastLog(log)
    if (step.progress !== undefined) {
      broadcastStatus({ type: 'progress', runId: rid, table: script.table, progress: step.progress })
    }
    stepIdx++
    currentRun.stepIdx = stepIdx
    currentRun.timer = setTimeout(runNextStep, step.delay)
  }
  runNextStep()
}

// 连接处理
io.on('connection', (socket) => {
  console.log(`[log-streamer] client connected: ${socket.id}`)
  connectedClients.add(socket)

  // 推送当前状态
  socket.emit('hello', {
    service: 'dataops-log-streamer',
    version: '1.0.0',
    currentTime: formatTs(new Date()),
    scripts: SCRIPTS.map((s, i) => ({ idx: i, table: s.table, cn: s.cn, steps: s.steps.length })),
    currentRun: currentRun ? {
      runId: currentRun.runId,
      table: SCRIPTS[currentRun.scriptIdx]?.table,
      stepIdx: currentRun.stepIdx,
    } : null,
  })

  // 客户端请求触发某个表的执行
  socket.on('trigger', (data: { scriptIdx?: number; table?: string }) => {
    let idx = data.scriptIdx
    if (idx === undefined && data.table) {
      idx = SCRIPTS.findIndex(s => s.table === data.table)
    }
    if (idx === undefined || idx < 0 || idx >= SCRIPTS.length) {
      socket.emit('error', { message: `无效的表: ${data.table ?? data.scriptIdx}` })
      return
    }
    if (currentRun) {
      socket.emit('error', { message: `已有运行中任务: ${currentRun.runId} (${SCRIPTS[currentRun.scriptIdx]?.table})，请等待完成` })
      return
    }
    startRun(idx)
  })

  // 客户端请求触发 daily 全量
  socket.on('trigger-daily', () => {
    if (currentRun) {
      socket.emit('error', { message: `已有运行中任务: ${currentRun.runId}` })
      return
    }
    // 按顺序执行所有 daily 脚本
    const dailyIdxs = SCRIPTS.map((s, i) => i).filter(i => SCRIPTS[i].table !== 'sector_stocks')
    let queueIdx = 0
    const runNext = () => {
      if (queueIdx >= dailyIdxs.length) {
        broadcastStatus({ type: 'daily-complete', message: 'daily 全量执行完成' })
        return
      }
      const idx = dailyIdxs[queueIdx]
      queueIdx++
      startRun(idx)
      // 等当前 run 结束后再跑下一个
      const checkInterval = setInterval(() => {
        if (!currentRun) {
          clearInterval(checkInterval)
          setTimeout(runNext, 500)
        }
      }, 500)
    }
    broadcastStatus({ type: 'daily-start', total: dailyIdxs.length })
    runNext()
  })

  // 取消当前 run
  socket.on('cancel', () => {
    if (currentRun?.timer) {
      clearTimeout(currentRun.timer)
    }
    broadcastStatus({
      type: 'run-cancelled',
      runId: currentRun?.runId,
      table: currentRun ? SCRIPTS[currentRun.scriptIdx]?.table : null,
    })
    currentRun = null
  })

  socket.on('disconnect', () => {
    console.log(`[log-streamer] client disconnected: ${socket.id}`)
    connectedClients.delete(socket)
  })

  socket.on('error', (err) => {
    console.error(`[log-streamer] socket error (${socket.id}):`, err)
  })
})

const PORT = 3003
httpServer.listen(PORT, () => {
  console.log(`[log-streamer] WebSocket server running on port ${PORT}`)
  console.log(`[log-streamer] ${SCRIPTS.length} scripts loaded, ready for connections`)
})

// 启动后自动开始一个 demo run（让首次连接的客户端立即看到日志流）
// 注：暂时禁用 auto-start，避免空闲时进程异常退出
// setTimeout(() => {
//   if (!currentRun) {
//     console.log('[log-streamer] auto-starting demo run: stock_daily_kline')
//     startRun(1) // stock_daily_kline
//   }
// }, 3000)

// 全局未捕获异常处理，避免进程崩溃
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
