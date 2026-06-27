'use client'
// 实时告警推送 hook（客户端模拟实现）
// 模拟 WebSocket 告警随机间隔到达（15-45秒）
// 遵循 useLogStreamer hook 模式
import { useState, useRef, useCallback, useEffect } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'

export type AlertSeverity = 'info' | 'warning' | 'error'
export type AlertType = 'execution' | 'health' | 'lint' | 'schema'

export interface RealtimeAlert {
  id: string
  type: AlertType
  severity: AlertSeverity
  title: string
  message: string
  timestamp: string
  tableName: string
}

// Alert templates by type
const EXECUTION_TEMPLATES = [
  { title: '执行完成', message: (t: string) => `${t} 入库完成，耗时 {duration}秒，入库 {rows} 行`, severity: 'info' as AlertSeverity },
  { title: '执行失败', message: (t: string) => `${t} 执行失败: API 连接超时`, severity: 'error' as AlertSeverity },
  { title: '执行跳过', message: (t: string) => `${t} 数据为空，跳过执行`, severity: 'warning' as AlertSeverity },
]

const HEALTH_TEMPLATES = [
  { title: '健康度变更', message: (t: string) => `${t} 健康度从 green 变为 red`, severity: 'error' as AlertSeverity },
  { title: '健康度恢复', message: (t: string) => `${t} 健康度从 red 恢复为 green`, severity: 'info' as AlertSeverity },
  { title: '数据滞后', message: (t: string) => `${t} 数据滞后，最新日期落后于最后交易日`, severity: 'warning' as AlertSeverity },
]

const LINT_TEMPLATES = [
  { title: 'Lint 违规', message: (t: string) => `${t} 检测到 R004 违规: 列名含中文`, severity: 'warning' as AlertSeverity },
  { title: 'Lint 违规', message: (t: string) => `${t} 检测到 R002 违规: @meta mode 与代码 MODE 矛盾`, severity: 'error' as AlertSeverity },
  { title: 'Lint 违规', message: (t: string) => `${t} 检测到 R009 违规: 反向 import run.py`, severity: 'warning' as AlertSeverity },
]

const SCHEMA_TEMPLATES = [
  { title: 'Schema 变更', message: (t: string) => `${t} 检测到新增列 'updated_at TIMESTAMP'`, severity: 'info' as AlertSeverity },
  { title: 'Schema 变更', message: (t: string) => `${t} 检测到列类型变更 'volume: INT → BIGINT'`, severity: 'warning' as AlertSeverity },
]

const ALL_TEMPLATES = [
  { type: 'execution' as AlertType, templates: EXECUTION_TEMPLATES },
  { type: 'health' as AlertType, templates: HEALTH_TEMPLATES },
  { type: 'lint' as AlertType, templates: LINT_TEMPLATES },
  { type: 'schema' as AlertType, templates: SCHEMA_TEMPLATES },
]

function formatTs(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function genAlertId(): string {
  return `ra-${Date.now()}-${Math.floor(Math.random() * 999).toString().padStart(3, '0')}`
}

function generateAlert(): RealtimeAlert {
  // Pick a random table (prefer tables with more interesting properties)
  const tableNames = TABLES.map(t => t.table)
  const tableName = tableNames[Math.floor(Math.random() * tableNames.length)]

  // Pick a random alert category
  const category = ALL_TEMPLATES[Math.floor(Math.random() * ALL_TEMPLATES.length)]
  const template = category.templates[Math.floor(Math.random() * category.templates.length)]

  let message = template.message(tableName)
  // Replace placeholders for execution templates
  if (category.type === 'execution') {
    message = message
      .replace('{duration}', String(Math.floor(Math.random() * 600) + 5))
      .replace('{rows}', String(Math.floor(Math.random() * 200000) + 100).replace(/\B(?=(\d{3})+(?!\d))/g, ','))
  }

  return {
    id: genAlertId(),
    type: category.type,
    severity: template.severity,
    title: template.title,
    message,
    timestamp: formatTs(new Date()),
    tableName,
  }
}

export function useRealtimeAlerts(enabled: boolean = true) {
  const [alerts, setAlerts] = useState<RealtimeAlert[]>([])
  const [lastAlert, setLastAlert] = useState<RealtimeAlert | null>(null)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pausedRef = useRef(false)
  const enabledRef = useRef(enabled)

  // Keep refs in sync
  useEffect(() => {
    pausedRef.current = paused
  }, [paused])
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    if (!enabled) return

    const scheduleNext = () => {
      if (!enabledRef.current) return
      // Random interval between 15-45 seconds
      const interval = (15 + Math.random() * 30) * 1000
      timerRef.current = setTimeout(() => {
        if (!pausedRef.current) {
          const alert = generateAlert()
          setAlerts(prev => [alert, ...prev].slice(0, 100)) // keep max 100
          setLastAlert(alert)
        }
        scheduleNext()
      }, interval)
    }

    scheduleNext()

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled])

  const togglePause = useCallback(() => {
    setPaused(prev => !prev)
  }, [])

  const clearAlerts = useCallback(() => {
    setAlerts([])
    setLastAlert(null)
  }, [])

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id))
  }, [])

  // Clear lastAlert after 3 seconds (for bell pulse animation)
  useEffect(() => {
    if (lastAlert) {
      const t = setTimeout(() => setLastAlert(null), 3000)
      return () => clearTimeout(t)
    }
  }, [lastAlert])

  return {
    alerts,
    lastAlert,
    paused,
    togglePause,
    clearAlerts,
    dismissAlert,
    alertCount: alerts.length,
  }
}
