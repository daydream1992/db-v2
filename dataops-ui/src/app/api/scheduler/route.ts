import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'

// ─── Types ────────────────────────────────────────────────────────
type SchedulerAction = 'daily' | 'table' | 'fix' | 'scan' | 'check'
type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

interface ExecutionRun {
  runId: string
  action: SchedulerAction
  tableName?: string
  force?: boolean
  date?: string
  status: RunStatus
  progress: number
  logs: LogEntry[]
  startedAt: string
  finishedAt: string | null
  tablesCompleted: number
  tablesTotal: number
  successCount: number
  failCount: number
}

interface LogEntry {
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'
  message: string
}

// ─── In-memory state ──────────────────────────────────────────────
const runs = new Map<string, ExecutionRun>()
const runTimers = new Map<string, ReturnType<typeof setTimeout>[]>()

// ─── Daily tables for mock simulation ─────────────────────────────
const DAILY_TABLES = [
  'trading_calendar',
  'stock_daily_kline',
  'stock_kline_5m',
  'stock_kline_1m',
  'capital_info',
  'stock_financial_data',
  'sjb_api_plhqL2kz_88zd',
  'stock_block_relation',
  'market_sc1_42',
  'stock_gp1_46_indicators',
  'stock_signals_20001_20011',
  'stock_industry_3level',
  'stock_kline_15m',
  'stock_kline_30m',
  'stock_kline_60m',
  'stock_kline_weekly',
  'stock_kline_monthly',
  'stock_daily_turnover',
]

const SCAN_TABLES = [
  'dim_security_type',
  'dim_industry_code',
  'pianpao_daily',
  'pianpao_daily_summary',
  'dim_gp_indicator',
]

const CHECK_TABLES = [
  'trading_calendar',
  'stock_daily_kline',
  'capital_info',
  'stock_financial_data',
]

// ─── Helper: generate timestamp ───────────────────────────────────
function now(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23)
}

// ─── Helper: get tables for action ────────────────────────────────
function getTablesForAction(action: SchedulerAction, tableName?: string): string[] {
  switch (action) {
    case 'daily': return DAILY_TABLES
    case 'scan': return SCAN_TABLES
    case 'check': return CHECK_TABLES
    case 'table': return tableName ? [tableName] : ['stock_daily_kline']
    case 'fix': return tableName ? [tableName] : ['stock_daily_kline']
    default: return DAILY_TABLES
  }
}

// ─── Helper: generate mock log lines for a table ──────────────────
function generateTableLogs(table: string, index: number, total: number): LogEntry[] {
  const logs: LogEntry[] = []
  const ts = now()

  logs.push({ timestamp: ts, level: 'INFO', message: `[${index + 1}/${total}] 开始处理表: ${table}` })

  // Simulate fetching data
  const rowCount = Math.floor(Math.random() * 5000) + 500
  logs.push({ timestamp: ts, level: 'INFO', message: `  获取数据源: ${rowCount} 行` })

  // Random warning (30% chance)
  if (Math.random() < 0.3) {
    const warnings = [
      `部分数据缺失，使用默认值填充`,
      `检测到重复记录，自动去重`,
      `数据日期非交易日，跳过`,
      `字段类型不匹配，自动转换`,
    ]
    logs.push({ timestamp: ts, level: 'WARNING', message: `  ⚠ ${warnings[Math.floor(Math.random() * warnings.length)]}` })
  }

  // Simulate processing
  const duration = (Math.random() * 3 + 0.5).toFixed(2)
  logs.push({ timestamp: ts, level: 'INFO', message: `  写入 DuckDB: ${rowCount} 行 · 耗时 ${duration}s` })

  // Random error (10% chance)
  if (Math.random() < 0.1) {
    const errors = [
      `写入失败: duplicate key constraint`,
      `数据校验失败: 行数不一致`,
      `连接超时: TQ API 未响应`,
    ]
    logs.push({ timestamp: ts, level: 'ERROR', message: `  ✗ ${errors[Math.floor(Math.random() * errors.length)]}` })
    return logs
  }

  logs.push({ timestamp: ts, level: 'SUCCESS', message: `  ✓ ${table} 完成 (${rowCount} 行, ${duration}s)` })
  return logs
}

// ─── Simulate mock execution ──────────────────────────────────────
function simulateExecution(run: ExecutionRun) {
  const tables = getTablesForAction(run.action, run.tableName)
  const timers: ReturnType<typeof setTimeout>[] = []
  run.tablesTotal = tables.length
  let completed = 0
  let successCount = 0
  let failCount = 0

  // Add initial log
  run.logs.push({
    timestamp: now(),
    level: 'INFO',
    message: `启动 ${run.action} 执行 · 共 ${tables.length} 个表${run.force ? ' · 强制模式' : ''}${run.date ? ` · 日期: ${run.date}` : ''}`,
  })

  tables.forEach((table, index) => {
    const delay = (index + 1) * (Math.random() * 1500 + 800)
    const timer = setTimeout(() => {
      // Check if cancelled
      if (run.status === 'cancelled') return

      const tableLogs = generateTableLogs(table, index, tables.length)

      // Check for error in logs
      const hasError = tableLogs.some(l => l.level === 'ERROR')
      if (hasError) {
        failCount++
      } else {
        successCount++
      }
      completed++

      run.logs.push(...tableLogs)
      run.tablesCompleted = completed
      run.successCount = successCount
      run.failCount = failCount
      run.progress = Math.round((completed / tables.length) * 100)

      // Update status on last table
      if (completed === tables.length) {
        run.status = failCount > 0 ? 'completed' : 'completed'
        run.finishedAt = now()
        run.logs.push({
          timestamp: now(),
          level: failCount > 0 ? 'WARNING' : 'SUCCESS',
          message: `执行完成: 成功 ${successCount}, 失败 ${failCount}, 总计 ${tables.length}`,
        })
      }
    }, delay)
    timers.push(timer)
  })

  runTimers.set(run.runId, timers)
}

// ─── POST handler: trigger execution ──────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, tableName, force, date } = body as {
      action?: SchedulerAction
      tableName?: string
      force?: boolean
      date?: string
    }

    if (!action || !['daily', 'table', 'fix', 'scan', 'check'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be one of: daily, table, fix, scan, check' },
        { status: 400 }
      )
    }

    // Check if there's already a running execution
    const runningExec = Array.from(runs.values()).find(r => r.status === 'running')
    if (runningExec) {
      return NextResponse.json(
        { error: 'Another execution is already running', runId: runningExec.runId },
        { status: 409 }
      )
    }

    const runId = uuidv4().slice(0, 8)
    const run: ExecutionRun = {
      runId,
      action,
      tableName,
      force: force ?? false,
      date,
      status: 'running',
      progress: 0,
      logs: [],
      startedAt: now(),
      finishedAt: null,
      tablesCompleted: 0,
      tablesTotal: 0,
      successCount: 0,
      failCount: 0,
    }

    runs.set(runId, run)
    simulateExecution(run)

    return NextResponse.json({ runId, status: 'running' })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

// ─── GET handler: get execution status ────────────────────────────
export async function GET(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get('runId')

  if (!runId) {
    // Return list of all runs (most recent first)
    const allRuns = Array.from(runs.values())
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, 20)
      .map(r => ({
        runId: r.runId,
        action: r.action,
        status: r.status,
        progress: r.progress,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        tablesCompleted: r.tablesCompleted,
        tablesTotal: r.tablesTotal,
        successCount: r.successCount,
        failCount: r.failCount,
      }))
    return NextResponse.json({ runs: allRuns })
  }

  const run = runs.get(runId)
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  return NextResponse.json({
    runId: run.runId,
    action: run.action,
    status: run.status,
    progress: run.progress,
    logs: run.logs,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    tablesCompleted: run.tablesCompleted,
    tablesTotal: run.tablesTotal,
    successCount: run.successCount,
    failCount: run.failCount,
    tableName: run.tableName,
    force: run.force,
    date: run.date,
  })
}

// ─── DELETE handler: cancel execution ─────────────────────────────
export async function DELETE(request: NextRequest) {
  const runId = request.nextUrl.searchParams.get('runId')

  if (!runId) {
    return NextResponse.json({ error: 'runId is required' }, { status: 400 })
  }

  const run = runs.get(runId)
  if (!run) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }

  if (run.status !== 'running') {
    return NextResponse.json({ error: 'Run is not running' }, { status: 400 })
  }

  // Cancel timers
  const timers = runTimers.get(runId)
  if (timers) {
    timers.forEach(t => clearTimeout(t))
    runTimers.delete(runId)
  }

  run.status = 'cancelled'
  run.finishedAt = now()
  run.logs.push({
    timestamp: now(),
    level: 'WARNING',
    message: `执行已取消 · 已完成 ${run.tablesCompleted}/${run.tablesTotal}`,
  })

  return NextResponse.json({ runId, status: 'cancelled' })
}
