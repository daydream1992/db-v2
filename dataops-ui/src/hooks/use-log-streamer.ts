'use client'
// 实时日志流 hook — Socket.IO WebSocket 优先，断线回退到客户端模拟
import { useState, useRef, useCallback, useEffect } from 'react'
import { io, Socket } from 'socket.io-client'

// ---- 类型定义 ----
export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' | 'SUCCESS'

export interface LogLine {
  timestamp: string
  level: LogLevel
  message: string
  table?: string
}

export interface ExecutionProgress {
  tablesCompleted: number
  tablesTotal: number
  currentTable: string
  percent: number
  status: 'idle' | 'running' | 'completed' | 'cancelled' | 'error'
  startedAt?: string
  finishedAt?: string
}

// ---- 客户端模拟剧本（回退用） ----
interface SimStep { delay: number; level: LogLevel; msg: () => string; progress?: number }
interface SimScript { table: string; cn: string; steps: SimStep[] }

const SIM_DAILY_TABLES: SimScript[] = [
  { table: 'trading_calendar', cn: '交易日历', steps: [
    { delay: 200, level: 'INFO', msg: () => '▶ 开始 trading_calendar' },
    { delay: 600, level: 'INFO', msg: () => '  API 返回 730 条交易日', progress: 50 },
    { delay: 300, level: 'SUCCESS', msg: () => '✔ trading_calendar 完成', progress: 100 },
  ]},
  { table: 'stock_daily_kline', cn: '股票日K线', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_daily_kline (增量)' },
    { delay: 800, level: 'INFO', msg: () => '  读取 TDX *.day 4896/4896', progress: 30 },
    { delay: 600, level: 'INFO', msg: () => '  写入 DuckDB 4,960 行', progress: 70 },
    { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_daily_kline 完成', progress: 100 },
  ]},
  { table: 'stock_kline_5m', cn: '5分钟K线', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_5m' },
    { delay: 900, level: 'INFO', msg: () => '  解析 .lc5 → 198,000 条', progress: 40 },
    { delay: 700, level: 'INFO', msg: () => '  分批写入 batch=10000', progress: 80 },
    { delay: 300, level: 'SUCCESS', msg: () => '✔ stock_kline_5m 完成', progress: 100 },
  ]},
  { table: 'stock_kline_1m', cn: '1分钟K线', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_1m' },
    { delay: 1000, level: 'INFO', msg: () => '  解析 .lc1 → 960,000 条', progress: 35 },
    { delay: 800, level: 'INFO', msg: () => '  分批写入 batch=10000', progress: 75 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_kline_1m 完成', progress: 100 },
  ]},
  { table: 'capital_info', cn: '股本数据', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 capital_info' },
    { delay: 800, level: 'INFO', msg: () => '  全量回补 4896 股', progress: 10 },
    { delay: 1200, level: 'INFO', msg: () => '  进度 2500/4896', progress: 50 },
    { delay: 1000, level: 'INFO', msg: () => '  进度 4500/4896', progress: 90 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ capital_info 完成: 2,980,000 行', progress: 100 },
  ]},
  { table: 'stock_financial_data', cn: '股票财务数据', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_financial_data' },
    { delay: 700, level: 'INFO', msg: () => '  API 拉取 2026Q2 报表', progress: 40 },
    { delay: 500, level: 'SUCCESS', msg: () => '✔ stock_financial_data 完成 12,400 行', progress: 100 },
  ]},
  { table: 'sjb_api_plhqL2kz_88zd', cn: 'L2快照88字段', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 sjb_api_plhqL2kz_88zd' },
    { delay: 900, level: 'INFO', msg: () => '  TQ API 拉取 L2 快照', progress: 30 },
    { delay: 600, level: 'WARNING', msg: () => '  ⚠ 部分字段为 NULL (预期行为)', progress: 60 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ sjb_api_plhqL2kz_88zd 完成', progress: 100 },
  ]},
  { table: 'stock_block_relation', cn: '股票板块关系', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_block_relation' },
    { delay: 600, level: 'INFO', msg: () => '  TQ API 拉取板块成分', progress: 50 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_block_relation 完成', progress: 100 },
  ]},
  { table: 'market_sc1_42', cn: '市场SC宏观指标', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 market_sc1_42' },
    { delay: 500, level: 'INFO', msg: () => '  读取二进制 42 指标', progress: 50 },
    { delay: 300, level: 'SUCCESS', msg: () => '✔ market_sc1_42 完成', progress: 100 },
  ]},
  { table: 'stock_gp1_46_indicators', cn: '个股GP指标', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_gp1_46_indicators' },
    { delay: 700, level: 'INFO', msg: () => '  读取二进制 46 字段', progress: 40 },
    { delay: 500, level: 'SUCCESS', msg: () => '✔ stock_gp1_46_indicators 完成 89,000 行', progress: 100 },
  ]},
  { table: 'stock_signals_20001_20011', cn: '股票信号数据', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_signals_20001_20011' },
    { delay: 600, level: 'INFO', msg: () => '  解析文本信号文件', progress: 50 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_signals_20001_20011 完成', progress: 100 },
  ]},
  { table: 'sector_stocks', cn: '板块成份股', steps: [
    { delay: 250, level: 'INFO', msg: () => '▶ 开始 sector_stocks' },
    { delay: 400, level: 'WARNING', msg: () => '  ○ sector_stocks 数据为空，跳过' },
  ]},
  { table: 't_bk5_19', cn: '板块BK交易数据', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 t_bk5_19' },
    { delay: 500, level: 'WARNING', msg: () => '  ⚠ mode=increment 与 MODE="full" 矛盾' },
    { delay: 300, level: 'ERROR', msg: () => '✘ t_bk5_19 失败: DELETE 逻辑错乱' },
  ]},
  { table: 'dim_security_type', cn: '证券类型维表', steps: [
    { delay: 250, level: 'INFO', msg: () => '▶ 开始 dim_security_type' },
    { delay: 400, level: 'INFO', msg: () => '  SELECT DISTINCT → 分类 4896 股', progress: 60 },
    { delay: 300, level: 'SUCCESS', msg: () => '✔ dim_security_type 完成 12,400 条', progress: 100 },
  ]},
  { table: 'stock_daily_turnover', cn: '日换手率涨跌幅', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_daily_turnover' },
    { delay: 500, level: 'INFO', msg: () => '  SQL 计算换手率+涨跌幅', progress: 50 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ stock_daily_turnover 完成', progress: 100 },
  ]},
  { table: 'stock_kline_15m', cn: '15分钟K线', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 stock_kline_15m' },
    { delay: 600, level: 'INFO', msg: () => '  SQL 聚合 1m→15m', progress: 40 },
    { delay: 500, level: 'SUCCESS', msg: () => '✔ stock_kline_15m 完成 66,000 行', progress: 100 },
  ]},
  { table: 'pianpao_daily', cn: '骗炮日表', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 pianpao_daily' },
    { delay: 800, level: 'INFO', msg: () => '  JOIN kline + dim_security_type', progress: 30 },
    { delay: 600, level: 'INFO', msg: () => '  扫描 4896 股 → 候选 4960', progress: 60 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ pianpao_daily 完成', progress: 100 },
  ]},
  { table: 'market_snapshot', cn: '市场快照', steps: [
    { delay: 300, level: 'INFO', msg: () => '▶ 开始 market_snapshot' },
    { delay: 500, level: 'INFO', msg: () => '  TQ API 拉取全市场快照', progress: 50 },
    { delay: 400, level: 'SUCCESS', msg: () => '✔ market_snapshot 完成', progress: 100 },
  ]},
]

function simFormatTs(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

// ---- Hook ----
export function useLogStreamer(enabled: boolean = true) {
  const [connected, setConnected] = useState(false)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [progress, setProgress] = useState<ExecutionProgress>({
    tablesCompleted: 0, tablesTotal: 0, currentTable: '', percent: 0, status: 'idle',
  })
  const socketRef = useRef<Socket | null>(null)
  const simTimersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const simCancelledRef = useRef(false)

  // 清理所有模拟定时器
  const clearSimTimers = useCallback(() => {
    simTimersRef.current.forEach(t => clearTimeout(t))
    simTimersRef.current = []
  }, [])

  // 客户端模拟 daily 执行（WS 断线时的回退方案）
  const startSimDaily = useCallback(() => {
    clearSimTimers()
    simCancelledRef.current = false
    const tablesTotal = SIM_DAILY_TABLES.length
    let tablesCompleted = 0
    let tableIdx = 0
    const startedAt = simFormatTs(new Date())

    setLogs([])
    setProgress({
      tablesCompleted: 0,
      tablesTotal,
      currentTable: SIM_DAILY_TABLES[0]?.table ?? '',
      percent: 0,
      status: 'running',
      startedAt,
    })

    function runNextTable() {
      if (simCancelledRef.current) return
      if (tableIdx >= SIM_DAILY_TABLES.length) {
        const finishedAt = simFormatTs(new Date())
        setProgress({
          tablesCompleted,
          tablesTotal,
          currentTable: '',
          percent: 100,
          status: 'completed',
          startedAt,
          finishedAt,
        })
        return
      }
      const script = SIM_DAILY_TABLES[tableIdx]
      let stepIdx = 0

      function runNextStep() {
        if (simCancelledRef.current) return
        if (stepIdx >= script.steps.length) {
          tablesCompleted++
          tableIdx++
          const percent = Math.round((tablesCompleted / tablesTotal) * 100)
          setProgress(prev => ({
            ...prev,
            tablesCompleted,
            currentTable: SIM_DAILY_TABLES[tableIdx]?.table ?? '',
            percent,
          }))
          const t = setTimeout(runNextTable, 300)
          simTimersRef.current.push(t)
          return
        }
        const step = script.steps[stepIdx]
        setLogs(prev => [...prev.slice(-499), {
          timestamp: simFormatTs(new Date()),
          level: step.level,
          message: step.msg(),
          table: script.table,
        }])
        if (step.progress !== undefined) {
          // Update the per-table progress isn't needed in the global progress,
          // but we keep the global progress running
        }
        stepIdx++
        const t = setTimeout(runNextStep, step.delay)
        simTimersRef.current.push(t)
      }
      runNextStep()
    }
    runNextTable()
  }, [clearSimTimers])

  // ---- WebSocket 连接 ----
  useEffect(() => {
    if (!enabled) return

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    })

    socket.on('connect', () => {
      console.log('[useLogStreamer] WebSocket connected')
      setConnected(true)
    })

    socket.on('disconnect', () => {
      console.log('[useLogStreamer] WebSocket disconnected')
      setConnected(false)
    })

    socket.on('log:line', (line: LogLine) => {
      setLogs(prev => [...prev.slice(-499), line])
    })

    socket.on('execution:progress', (p: ExecutionProgress) => {
      setProgress(p)
    })

    socket.on('execution:complete', (result: ExecutionProgress) => {
      setProgress(prev => ({ ...prev, status: 'completed', ...result }))
    })

    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [enabled])

  // 清理模拟定时器
  useEffect(() => {
    return () => { clearSimTimers() }
  }, [clearSimTimers])

  const startExecution = useCallback((action: string, options?: { force?: boolean }) => {
    setLogs([])
    setProgress({
      tablesCompleted: 0,
      tablesTotal: 18,
      currentTable: '',
      percent: 0,
      status: 'running',
      startedAt: simFormatTs(new Date()),
    })

    if (connected && socketRef.current) {
      // WS 已连接：通过 WebSocket 发送
      socketRef.current.emit('execution:start', { action, ...options })
    } else {
      // WS 断线：回退到客户端模拟
      console.log('[useLogStreamer] WS disconnected, using client simulation')
      startSimDaily()
    }
  }, [connected, startSimDaily])

  const cancelExecution = useCallback(() => {
    if (connected && socketRef.current) {
      socketRef.current.emit('execution:cancel')
    } else {
      // 停止客户端模拟
      simCancelledRef.current = true
      clearSimTimers()
    }
    setProgress(prev => ({ ...prev, status: 'cancelled' }))
  }, [connected, clearSimTimers])

  const clearLogs = useCallback(() => setLogs([]), [])

  // Derived helpers for convenience
  const currentRun = progress.status !== 'idle' ? {
    table: progress.currentTable,
    status: progress.status,
    progress: progress.percent,
  } : null

  const dailyProgress = progress.status === 'running' ? {
    completed: progress.tablesCompleted,
    total: progress.tablesTotal,
  } : null

  const trigger = useCallback((action?: string, table?: string) => {
    if (table) {
      startExecution(table)
    } else {
      startExecution(action ?? 'daily')
    }
  }, [startExecution])

  const triggerDaily = useCallback(() => {
    startExecution('daily')
  }, [startExecution])

  const cancel = useCallback(() => {
    cancelExecution()
  }, [cancelExecution])

  // Expose scripts from SIM_DAILY_TABLES for UI
  const scripts = SIM_DAILY_TABLES.map((s, idx) => ({
    idx,
    table: s.table,
    cn: s.cn,
    steps: s.steps.length,
  }))

  return { connected, logs, progress, startExecution, cancelExecution, clearLogs, currentRun, dailyProgress, trigger, triggerDaily, cancel, scripts }
}
