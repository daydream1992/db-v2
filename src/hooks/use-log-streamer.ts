'use client'
// 实时日志流 hook（客户端模拟实现）
// 原计划用 socket.io mini-service，但沙箱会杀后台进程，改为客户端 setTimeout 模拟
// 模拟 pipeline 执行过程中的日志实时推送，UX 与真实 WebSocket 一致
import { useState, useRef, useCallback, useEffect } from 'react'

export type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG'

export interface LiveLog {
  id: string
  ts: string
  level: LogLevel
  table: string
  message: string
  runId: string
  progress?: number
}

export interface RunStatus {
  type: 'run-start' | 'run-end' | 'progress' | 'run-cancelled' | 'daily-start' | 'daily-complete' | 'error'
  runId?: string
  table?: string
  cn?: string
  startTime?: string
  endTime?: string
  status?: 'success' | 'failed'
  durationSec?: number
  progress?: number
  total?: number
  message?: string
}

export interface ScriptInfo {
  idx: number
  table: string
  cn: string
  steps: number
}

// 日志剧本（与原 server 端一致）
interface LogStep { delay: number; level: LogLevel; msg: (ctx: { runId: string }) => string; progress?: number }
interface LogScript { table: string; cn: string; steps: LogStep[] }

const SCRIPTS: LogScript[] = [
  {
    table: 'trading_calendar', cn: '交易日历',
    steps: [
      { delay: 300, level: 'INFO', msg: c => `▶ 开始 trading_calendar (run_id=${c.runId})` },
      { delay: 700, level: 'DEBUG', msg: () => '  调用 tq.get_trading_dates(2025-01-01, 2026-12-31)' },
      { delay: 500, level: 'INFO', msg: () => '  API 返回 730 条交易日', progress: 50 },
      { delay: 300, level: 'DEBUG', msg: () => '  去重 + upsert (date, market) → 1 条新增' },
      { delay: 250, level: 'INFO', msg: () => '✔ trading_calendar 完成，共 1 条', progress: 100 },
    ],
  },
  {
    table: 'stock_daily_kline', cn: '股票日K线',
    steps: [
      { delay: 350, level: 'INFO', msg: c => `▶ 开始 stock_daily_kline (run_id=${c.runId})` },
      { delay: 600, level: 'DEBUG', msg: () => '  增量模式，最小日期: 20260626' },
      { delay: 900, level: 'INFO', msg: () => '  读取 TDX vipdoc/lday/*.day 文件 4896/4896', progress: 30 },
      { delay: 700, level: 'DEBUG', msg: () => '  解析二进制 → DataFrame (4,960 行)' },
      { delay: 600, level: 'INFO', msg: () => '  写入 DuckDB (upsert code+date)', progress: 70 },
      { delay: 300, level: 'INFO', msg: () => '✔ stock_daily_kline 完成，共 4,960 条', progress: 100 },
    ],
  },
  {
    table: 'stock_kline_5m', cn: '5分钟K线',
    steps: [
      { delay: 400, level: 'INFO', msg: c => `▶ 开始 stock_kline_5m (run_id=${c.runId})` },
      { delay: 800, level: 'DEBUG', msg: () => '  读取 .lc5 文件 4896/4896' },
      { delay: 1500, level: 'INFO', msg: () => '  解析 5min K线 → 198,000 条', progress: 40 },
      { delay: 1100, level: 'INFO', msg: () => '  分批写入 (batch=10000)', progress: 80 },
      { delay: 600, level: 'INFO', msg: () => '✔ stock_kline_5m 完成，共 198,000 条', progress: 100 },
    ],
  },
  {
    table: 'capital_info', cn: '股本数据',
    steps: [
      { delay: 350, level: 'INFO', msg: c => `▶ 开始 capital_info (run_id=${c.runId})` },
      { delay: 800, level: 'INFO', msg: () => '  全量回补 start=20250626(近1年), 已清空', progress: 10 },
      { delay: 1200, level: 'INFO', msg: () => '  区间 20250626~至今, 待拉 4896 股' },
      { delay: 1800, level: 'INFO', msg: () => '  进度 500/4896 (8.2股/秒, 已入 320,000 行)', progress: 25 },
      { delay: 1800, level: 'DEBUG', msg: () => '  进度 2500/4896 (8.5股/秒, 已入 1,600,000 行)', progress: 60 },
      { delay: 1500, level: 'INFO', msg: () => '  进度 4500/4896 (8.5股/秒, 已入 2,890,000 行)', progress: 92 },
      { delay: 600, level: 'INFO', msg: () => '✔ capital_info 完成: 2,980,000 行, 失败 0 股', progress: 100 },
    ],
  },
  {
    table: 't_bk5_19', cn: '板块BK交易数据',
    steps: [
      { delay: 350, level: 'INFO', msg: c => `▶ 开始 t_bk5_19 (run_id=${c.runId})` },
      { delay: 600, level: 'DEBUG', msg: () => '  读取 gpsh*.dat 文件 32/32' },
      { delay: 450, level: 'WARNING', msg: () => '  ⚠ @meta mode=increment 与代码 MODE="full" 矛盾' },
      { delay: 300, level: 'ERROR', msg: () => '✘ t_bk5_19 失败: DELETE 逻辑错乱，数据未入库', progress: 0 },
    ],
  },
  {
    table: 'sector_stocks', cn: '板块成份股',
    steps: [
      { delay: 250, level: 'INFO', msg: c => `▶ 开始 sector_stocks (run_id=${c.runId})` },
      { delay: 400, level: 'WARNING', msg: () => '○ sector_stocks 数据为空，跳过' },
      { delay: 150, level: 'DEBUG', msg: () => '  原因: ensure_table 字面量 "表名" 未实现' },
    ],
  },
  {
    table: 'pianpao_daily', cn: '骗炮每日明细',
    steps: [
      { delay: 400, level: 'INFO', msg: c => `▶ 开始 pianpao_daily (run_id=${c.runId})` },
      { delay: 600, level: 'INFO', msg: () => '  骗炮分析 2026-06-25' },
      { delay: 900, level: 'DEBUG', msg: () => '  JOIN stock_daily_kline + stock_kline_1m + dim_security_type' },
      { delay: 1100, level: 'INFO', msg: () => '  扫描 4,896 股 × 240 分钟 → 候选 4,960', progress: 60 },
      { delay: 600, level: 'INFO', msg: () => '  评分 (A级/B级/C级)', progress: 90 },
      { delay: 300, level: 'INFO', msg: () => '✔ pianpao_daily 完成', progress: 100 },
    ],
  },
  {
    table: 'dim_security_type', cn: '证券类型维表',
    steps: [
      { delay: 250, level: 'INFO', msg: c => `▶ 开始 dim_security_type (run_id=${c.runId})` },
      { delay: 400, level: 'DEBUG', msg: () => '  SELECT DISTINCT code FROM stock_daily_kline' },
      { delay: 300, level: 'INFO', msg: () => '  分类 4896 股 → ETF/股票/指数/可转债', progress: 70 },
      { delay: 250, level: 'INFO', msg: () => '✔ dim_security_type 完成，共 12,400 条', progress: 100 },
    ],
  },
]

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

export function useLogStreamer() {
  const [connected, setConnected] = useState(true) // 客户端模拟，始终"已连接"
  const [logs, setLogs] = useState<LiveLog[]>([])
  const [scripts] = useState<ScriptInfo[]>(SCRIPTS.map((s, i) => ({ idx: i, table: s.table, cn: s.cn, steps: s.steps.length })))
  const [currentRun, setCurrentRun] = useState<{ runId: string; table: string; progress: number; status: 'running' | 'success' | 'failed' } | null>(null)
  const [dailyProgress, setDailyProgress] = useState<{ total: number; completed: number } | null>(null)

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const currentRunRef = useRef<{ runId: string; scriptIdx: number; cancelled: boolean } | null>(null)
  const dailyQueueRef = useRef<number[] | null>(null)

  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(t => clearTimeout(t))
    timersRef.current = []
  }, [])

  const startRun = useCallback((scriptIdx: number): string => {
    const script = SCRIPTS[scriptIdx]
    if (!script) return ''
    const rid = genRunId()
    const ctx = { runId: rid }
    currentRunRef.current = { runId: rid, scriptIdx, cancelled: false }

    setCurrentRun({ runId: rid, table: script.table, progress: 0, status: 'running' })

    let stepIdx = 0
    const runNextStep = () => {
      if (!currentRunRef.current || currentRunRef.current.cancelled) {
        return
      }
      if (stepIdx >= script.steps.length) {
        const lastStep = script.steps[script.steps.length - 1]
        const failed = lastStep?.level === 'ERROR'
        setCurrentRun(prev => prev ? { ...prev, status: failed ? 'failed' : 'success', progress: failed ? prev.progress : 100 } : null)
        if (!failed && dailyQueueRef.current) {
          setDailyProgress(prev => prev ? { ...prev, completed: prev.completed + 1 } : null)
        }
        // 3 秒后清除
        const t = setTimeout(() => {
          setCurrentRun(null)
          currentRunRef.current = null
          // 如果在 daily 队列中，继续下一个
          if (dailyQueueRef.current && dailyQueueRef.current.length > 0) {
            const nextIdx = dailyQueueRef.current.shift()!
            const t2 = setTimeout(() => startRun(nextIdx), 300)
            timersRef.current.push(t2)
          } else if (dailyQueueRef.current) {
            // daily 完成
            dailyQueueRef.current = null
            setDailyProgress(null)
          }
        }, 3000)
        timersRef.current.push(t)
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
      setLogs(prev => [...prev.slice(-499), log])
      if (step.progress !== undefined) {
        setCurrentRun(prev => prev ? { ...prev, progress: step.progress! } : null)
      }
      stepIdx++
      const t = setTimeout(runNextStep, step.delay)
      timersRef.current.push(t)
    }
    runNextStep()
    return rid
  }, [])

  const trigger = useCallback((scriptIdx?: number, table?: string) => {
    let idx = scriptIdx
    if (idx === undefined && table) {
      idx = SCRIPTS.findIndex(s => s.table === table)
    }
    if (idx === undefined || idx < 0 || idx >= SCRIPTS.length) return
    if (currentRunRef.current) return
    startRun(idx)
  }, [startRun])

  const triggerDaily = useCallback(() => {
    if (currentRunRef.current || dailyQueueRef.current) return
    setLogs([])
    const dailyIdxs = SCRIPTS.map((s, i) => i)
    dailyQueueRef.current = dailyIdxs
    setDailyProgress({ total: dailyIdxs.length, completed: 0 })
    const firstIdx = dailyQueueRef.current.shift()!
    const t = setTimeout(() => startRun(firstIdx), 200)
    timersRef.current.push(t)
  }, [startRun])

  const cancel = useCallback(() => {
    if (currentRunRef.current) {
      currentRunRef.current.cancelled = true
    }
    clearAllTimers()
    setCurrentRun(null)
    currentRunRef.current = null
    dailyQueueRef.current = null
    setDailyProgress(null)
  }, [clearAllTimers])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  // 清理
  useEffect(() => {
    return () => {
      clearAllTimers()
    }
  }, [clearAllTimers])

  return {
    connected,
    logs,
    scripts,
    currentRun,
    dailyProgress,
    trigger,
    triggerDaily,
    cancel,
    clearLogs,
  }
}
