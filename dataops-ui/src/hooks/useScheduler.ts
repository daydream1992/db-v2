'use client'

import { useState, useCallback, useRef, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────
export type SchedulerAction = 'daily' | 'table' | 'fix' | 'scan' | 'check'
export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface LogEntry {
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS'
  message: string
}

export interface SchedulerRun {
  runId: string
  action: SchedulerAction
  status: RunStatus
  progress: number
  logs: LogEntry[]
  startedAt: string
  finishedAt: string | null
  tablesCompleted: number
  tablesTotal: number
  successCount: number
  failCount: number
  tableName?: string
  force?: boolean
  date?: string
}

export interface SchedulerHistoryItem {
  runId: string
  action: SchedulerAction
  status: RunStatus
  progress: number
  startedAt: string
  finishedAt: string | null
  tablesCompleted: number
  tablesTotal: number
  successCount: number
  failCount: number
  tableName?: string
}

interface UseSchedulerReturn {
  /** Current running execution (null if idle) */
  currentRun: SchedulerRun | null
  /** Execution history (from localStorage) */
  executionHistory: SchedulerHistoryItem[]
  /** Whether we are currently triggering an execution */
  isTriggering: boolean
  /** Trigger a new execution */
  triggerExecution: (action: SchedulerAction, options?: { tableName?: string; force?: boolean; date?: string }) => Promise<string | null>
  /** Cancel the current running execution */
  cancel: () => Promise<void>
  /** Refresh status manually */
  refreshStatus: () => Promise<void>
}

// ─── localStorage helpers ─────────────────────────────────────────
const STORAGE_KEY = 'dataops-scheduler-history'
const MAX_HISTORY = 20

function loadHistory(): SchedulerHistoryItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SchedulerHistoryItem[]
  } catch {
    return []
  }
}

function saveHistory(items: SchedulerHistoryItem[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_HISTORY)))
  } catch {
    // localStorage full or unavailable
  }
}

function runToHistoryItem(run: SchedulerRun): SchedulerHistoryItem {
  return {
    runId: run.runId,
    action: run.action,
    status: run.status,
    progress: run.progress,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    tablesCompleted: run.tablesCompleted,
    tablesTotal: run.tablesTotal,
    successCount: run.successCount,
    failCount: run.failCount,
    tableName: run.tableName,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────
export function useScheduler(): UseSchedulerReturn {
  const [currentRun, setCurrentRun] = useState<SchedulerRun | null>(null)
  const [executionHistory, setExecutionHistory] = useState<SchedulerHistoryItem[]>([])
  const [isTriggering, setIsTriggering] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load history on mount
  useEffect(() => {
    setExecutionHistory(loadHistory())
  }, [])

  // ─── Poll status ──────────────────────────────────────────────
  const pollStatus = useCallback(async (runId: string) => {
    try {
      const res = await fetch(`/api/scheduler?runId=${runId}`)
      if (!res.ok) return
      const data = await res.json() as SchedulerRun

      setCurrentRun(prev => {
        if (!prev) return data
        return { ...prev, ...data }
      })

      // If completed, move to history
      if (data.status !== 'running') {
        setCurrentRun(null)
        setExecutionHistory(prev => {
          const exists = prev.some(h => h.runId === data.runId)
          const newItem = runToHistoryItem(data)
          const updated = exists ? prev : [newItem, ...prev].slice(0, MAX_HISTORY)
          saveHistory(updated)
          return updated
        })
        // Stop polling
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current)
          pollIntervalRef.current = null
        }
      }
    } catch {
      // Network error, keep polling
    }
  }, [])

  // ─── Start polling ────────────────────────────────────────────
  const startPolling = useCallback((runId: string) => {
    // Clear any existing interval
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current)
    }
    // Poll every 2 seconds
    pollIntervalRef.current = setInterval(() => {
      void pollStatus(runId)
    }, 2000)
    // Also poll immediately
    void pollStatus(runId)
  }, [pollStatus])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  // ─── Trigger execution ────────────────────────────────────────
  const triggerExecution = useCallback(async (
    action: SchedulerAction,
    options?: { tableName?: string; force?: boolean; date?: string }
  ): Promise<string | null> => {
    setIsTriggering(true)

    // Cancel any existing AbortController
    if (abortRef.current) {
      abortRef.current.abort()
    }
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const res = await fetch('/api/scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          tableName: options?.tableName,
          force: options?.force,
          date: options?.date,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      const data = await res.json() as { runId: string; status: string }

      // Start with initial state
      const newRun: SchedulerRun = {
        runId: data.runId,
        action,
        status: 'running',
        progress: 0,
        logs: [],
        startedAt: new Date().toISOString().replace('T', ' ').replace('Z', '').slice(0, 23),
        finishedAt: null,
        tablesCompleted: 0,
        tablesTotal: 0,
        successCount: 0,
        failCount: 0,
        tableName: options?.tableName,
        force: options?.force,
        date: options?.date,
      }
      setCurrentRun(newRun)

      // Start polling
      startPolling(data.runId)

      return data.runId
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      throw err
    } finally {
      setIsTriggering(false)
    }
  }, [startPolling])

  // ─── Cancel execution ─────────────────────────────────────────
  const cancel = useCallback(async () => {
    if (!currentRun) return

    try {
      await fetch(`/api/scheduler?runId=${currentRun.runId}`, { method: 'DELETE' })
      setCurrentRun(null)

      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
        pollIntervalRef.current = null
      }

      // Refresh history
      setExecutionHistory(loadHistory())
    } catch {
      // Silently handle
    }
  }, [currentRun])

  // ─── Manual refresh ───────────────────────────────────────────
  const refreshStatus = useCallback(async () => {
    if (currentRun) {
      await pollStatus(currentRun.runId)
    }
    // Also refresh history from API
    try {
      const res = await fetch('/api/scheduler')
      if (res.ok) {
        const data = await res.json() as { runs: SchedulerHistoryItem[] }
        setExecutionHistory(prev => {
          // Merge API runs with local history
          const apiIds = new Set(data.runs.map(r => r.runId))
          const localOnly = prev.filter(h => !apiIds.has(h.runId))
          const merged = [...data.runs, ...localOnly].slice(0, MAX_HISTORY)
          saveHistory(merged)
          return merged
        })
      }
    } catch {
      // Silently handle
    }
  }, [currentRun, pollStatus])

  return {
    currentRun,
    executionHistory,
    isTriggering,
    triggerExecution,
    cancel,
    refreshStatus,
  }
}
