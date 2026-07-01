'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { TABLES, isTradingDay, getLastTradingDay, getNextTradingDay, TRADING_CALENDAR } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench, Activity, TrendingUp, BarChart3, Filter, X, Loader2, Zap, ArrowRight, Clock, GitBranch, Eye, ChevronDown, ChevronRight, HeartPulse, Calendar, Info } from 'lucide-react'
import { HEALTH_MATRIX } from '@/lib/dataops/mock-data'
import { freshnessClass, healthColorClass, healthTextColorClass } from '@/lib/dataops/styles'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

type HealthStatus = 'green' | 'yellow' | 'red' | 'white'

// Real health snapshot from /api/dataops?op=health (one entry per table)
interface HealthEntry {
  rows: number
  maxDate: string | null
  dateCol: string | null
}
type HealthMap = Map<string, HealthEntry>

// Compute staleness in trading days between maxDate and the last trading day.
// Returns NaN if maxDate cannot be parsed.
function tradingDaysStale(maxDate: string | null): number {
  if (!maxDate) return NaN
  const md = new Date(maxDate)
  if (isNaN(md.getTime())) return NaN
  // Walk calendar days from maxDate (exclusive) up to today, counting trading days (Mon-Fri).
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const cursor = new Date(md)
  cursor.setHours(0, 0, 0, 0)
  let staleTradingDays = 0
  // Guard against infinite loop / future maxDate
  let guard = 0
  while (cursor.getTime() < today.getTime() && guard < 1000) {
    cursor.setDate(cursor.getDate() + 1)
    const dow = cursor.getDay()
    if (dow >= 1 && dow <= 5) staleTradingDays++
    guard++
  }
  return staleTradingDays
}

// Calendar-day difference (today - maxDate), regardless of trading days.
function calendarDaysStale(maxDate: string | null): number {
  if (!maxDate) return NaN
  const md = new Date(maxDate)
  if (isNaN(md.getTime())) return NaN
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  md.setHours(0, 0, 0, 0)
  return Math.floor((today.getTime() - md.getTime()) / 86400000)
}

// Local table health override for mock force-retry
interface HealthOverride {
  [table: string]: HealthStatus
}

// Remediation plan step
interface RemediationStep {
  table: string
  cn: string
  status: 'waiting' | 'running' | 'success' | 'failed'
  estimatedTime: string
  dependsOn: string[]
  order: number
  isForce: boolean
}

// ── Health Score Ring Component ─────────────────────────────────
function HealthScoreRing({ score, size = 160 }: { score: number; size?: number }) {
  const [animatedScore, setAnimatedScore] = useState(0)
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (animatedScore / 100) * circumference

  useEffect(() => {
    const timer = setTimeout(() => setAnimatedScore(score), 100)
    return () => clearTimeout(timer)
  }, [score])

  const color = score >= 90 ? '#10b981' : score >= 70 ? '#f59e0b' : '#f43f5e' // emerald-500 / amber-500 / rose-500
  const colorClass = score >= 90 ? 'text-emerald-500' : score >= 70 ? 'text-amber-500' : 'text-rose-500'

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-zinc-200 dark:text-zinc-800"
          strokeWidth={strokeWidth}
        />
        {/* Animated progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold tabular-nums ${colorClass}`}>{animatedScore}</span>
        <span className="text-xs text-zinc-500">%</span>
      </div>
    </div>
  )
}

export function HealthView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirFilter, setDirFilter] = useState<string>('all')
  const [healthOverrides, setHealthOverrides] = useState<HealthOverride>({})
  const [runningTables, setRunningTables] = useState<string[]>([])
  const [completedTables, setCompletedTables] = useState<Set<string>>(new Set())
  const [flashTables, setFlashTables] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // Real health snapshot from DuckDB (rows / maxDate / dateCol per table)
  const [healthMap, setHealthMap] = useState<HealthMap>(new Map())
  const [healthLoading, setHealthLoading] = useState(true)
  const [healthError, setHealthError] = useState<string | null>(null)

  // Load real health once on mount; keep page usable on error (falls back to mock).
  const loadHealth = useCallback(async () => {
    setHealthLoading(true)
    setHealthError(null)
    try {
      const resp = await fetch('/api/dataops?op=health', { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const tables: Array<{ table: string; rows: number; maxDate: string | null; dateCol: string | null }> = data?.tables ?? []
      const next = new Map<string, HealthEntry>()
      for (const t of tables) {
        next.set(t.table, { rows: t.rows ?? 0, maxDate: t.maxDate ?? null, dateCol: t.dateCol ?? null })
      }
      setHealthMap(next)
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e))
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => { loadHealth() }, [loadHealth])

  // C5: Batch remediation state
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showBatchDialog, setShowBatchDialog] = useState(false)
  const [batchSteps, setBatchSteps] = useState<RemediationStep[]>([])
  const [batchExecuting, setBatchExecuting] = useState(false)
  const [batchForceMode, setBatchForceMode] = useState(false)
  const [smartSort, setSmartSort] = useState(true)
  const [batchCompleted, setBatchCompleted] = useState(false)
  const [showSummaryDialog, setShowSummaryDialog] = useState(false)
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getHealth = useCallback((table: string): HealthStatus => {
    // Manual override wins (force-retry / batch remediation simulation)
    if (healthOverrides[table]) return healthOverrides[table]
    const meta = TABLES.find(x => x.table === table)
    if (!meta) return 'white'
    // Schedule (cn/dir/etc.) still comes from mock metadata — not in DuckDB.
    if (meta.schedule === 'once') return 'white'

    const real = healthMap.get(table)
    // Use real snapshot when available; otherwise fall back to mock maxDate/rows
    // so the page still renders meaningfully before load.
    const rows = real ? real.rows : meta.rows
    const maxDate = real ? real.maxDate : meta.maxDate

    // No data at all → red
    if (!rows || rows === 0) return 'red'

    if (meta.schedule === 'daily') {
      const stale = tradingDaysStale(maxDate)
      if (isNaN(stale)) return 'red' // has rows but no usable date → can't verify freshness
      // On a trading day, any staleness past the last trading day is red.
      // On non-trading days, a stale daily table is at most yellow.
      if (isTodayTradingDay) {
        if (stale >= 2) return 'red'
        if (stale >= 1) return 'yellow'
        return 'green'
      } else {
        // Non-trading day: never red for daily staleness
        if (stale >= 2) return 'yellow'
        if (stale >= 1) return 'yellow'
        return 'green'
      }
    }

    if (meta.schedule === 'weekly') {
      const days = calendarDaysStale(maxDate)
      if (isNaN(days)) return 'red'
      if (days > 7) return 'red'
      if (days > 3) return 'yellow'
      return 'green'
    }

    if (meta.schedule === 'monthly') {
      const days = calendarDaysStale(maxDate)
      if (isNaN(days)) return 'red'
      if (days > 31) return 'red'
      if (days > 10) return 'yellow'
      return 'green'
    }

    return 'green'
  }, [healthOverrides, healthMap, isTodayTradingDay])

  // Real rows with mock fallback (used wherever t.rows is displayed)
  const getRows = useCallback((table: string): number => {
    const real = healthMap.get(table)
    if (real) return real.rows
    const meta = TABLES.find(x => x.table === table)
    return meta?.rows ?? 0
  }, [healthMap])

  const redTables = TABLES.filter(t => getHealth(t.table) === 'red')
  const yellowTables = TABLES.filter(t => getHealth(t.table) === 'yellow')
  const greenTables = TABLES.filter(t => getHealth(t.table) === 'green')
  const whiteTables = TABLES.filter(t => getHealth(t.table) === 'white')

  // Trading calendar awareness
  const lastTradingDay = getLastTradingDay()
  const nextTradingDay = getNextTradingDay()
  const isTodayTradingDay = isTradingDay()

  // Overall health score (calendar-aware: non-trading days don't penalize stale tables)
  const healthScore = useMemo(() => {
    const total = TABLES.length
    if (total === 0) return 100
    const greenWeight = 100
    const yellowWeight = 60
    const redWeight = 0
    const whiteWeight = 80 // once tables are fine
    // On non-trading days, treat yellow (stale) tables as green-ish
    // since data not updating on weekends/holidays is expected
    const effectiveYellowWeight = isTodayTradingDay ? yellowWeight : 85
    const score = (
      greenTables.length * greenWeight +
      yellowTables.length * effectiveYellowWeight +
      redTables.length * redWeight +
      whiteTables.length * whiteWeight
    ) / total
    return Math.round(score)
  }, [greenTables.length, yellowTables.length, redTables.length, whiteTables.length, isTodayTradingDay])

  const toggle = (table: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })
  }

  const toggleRow = (table: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })
  }

  const selectAllRed = () => {
    setSelected(prev => {
      const next = new Set(prev)
      redTables.forEach(t => next.add(t.table))
      return next
    })
  }

  const selectAllRedYellow = () => {
    setSelected(prev => {
      const next = new Set(prev)
      redTables.forEach(t => next.add(t.table))
      yellowTables.forEach(t => next.add(t.table))
      return next
    })
  }

  const clearSelection = () => {
    setSelected(new Set())
  }

  const handleForceRetry = () => {
    setShowConfirmDialog(true)
  }

  // 刷新健康度 (re-fetch real snapshot from DuckDB)
  const handleRefreshHealth = async () => {
    setRefreshing(true)
    await loadHealth()
    setRefreshing(false)
    if (healthError) {
      toast.error('健康度刷新失败', { description: healthError })
      return
    }
    toast.success('健康度已刷新', {
      description: `当前评分 ${healthScore}% · ${greenTables.length} 健康 / ${redTables.length} 异常 / ${yellowTables.length} 待查`,
    })
  }

  // ── Topological sort for dependency ordering ────────────────
  const topologicalSort = useCallback((tables: string[]): string[] => {
    const tableSet = new Set(tables)
    const visited = new Set<string>()
    const result: string[] = []

    const visit = (table: string) => {
      if (visited.has(table)) return
      visited.add(table)
      const meta = TABLES.find(t => t.table === table)
      if (meta) {
        // Visit dependencies first (only those in our selection)
        for (const dep of meta.dependsOn) {
          if (tableSet.has(dep) && !visited.has(dep)) {
            visit(dep)
          }
        }
      }
      result.push(table)
    }

    tables.forEach(t => visit(t))
    return result
  }, [])

  // ── Estimate time for a table ──────────────────────────────
  const estimateTime = useCallback((table: string): string => {
    const meta = TABLES.find(t => t.table === table)
    if (!meta) return '~5s'
    // Rough estimation based on rows
    if (meta.rows > 5_000_000) return '~30s'
    if (meta.rows > 1_000_000) return '~15s'
    if (meta.rows > 100_000) return '~8s'
    return '~3s'
  }, [])

  // ── Open batch remediation dialog ──────────────────────────
  const openBatchDialog = useCallback(() => {
    const selectedTables = [...selected]
    const sorted = smartSort ? topologicalSort(selectedTables) : selectedTables

    const steps: RemediationStep[] = sorted.map((table, idx) => {
      const meta = TABLES.find(t => t.table === table)
      return {
        table,
        cn: meta?.cn ?? table,
        status: 'waiting',
        estimatedTime: estimateTime(table),
        dependsOn: meta?.dependsOn.filter(d => selectedTables.includes(d)) ?? [],
        order: idx + 1,
        isForce: batchForceMode,
      }
    })

    setBatchSteps(steps)
    setBatchExecuting(false)
    setBatchCompleted(false)
    setShowBatchDialog(true)
  }, [selected, smartSort, topologicalSort, estimateTime, batchForceMode])

  // ── Execute batch remediation step by step ─────────────────
  const executeBatch = useCallback(() => {
    setBatchExecuting(true)

    // Process each step sequentially
    const executeStep = (index: number) => {
      if (index >= batchSteps.length) {
        // All done
        setBatchCompleted(true)
        setBatchExecuting(false)
        setSelected(new Set())
        const successCount = batchSteps.filter(s => s.status === 'success').length
        const failedCount = batchSteps.filter(s => s.status === 'failed').length
        toast.success('批量补数完成', {
          description: `成功 ${successCount} 张, 失败 ${failedCount} 张`,
        })
        return
      }

      // Set current step to running
      setBatchSteps(prev => prev.map((s, i) => i === index ? { ...s, status: 'running' as const } : s))

      // Mock execution delay (1-3 seconds based on estimated time)
      const delay = batchSteps[index].estimatedTime.includes('30') ? 3000 :
                    batchSteps[index].estimatedTime.includes('15') ? 2000 :
                    batchSteps[index].estimatedTime.includes('8') ? 1500 : 1000

      batchTimerRef.current = setTimeout(() => {
        // 85% success rate for mock
        const isSuccess = Math.random() > 0.15

        setBatchSteps(prev => prev.map((s, i) => {
          if (i === index) {
            return { ...s, status: isSuccess ? 'success' as const : 'failed' as const }
          }
          return s
        }))

        // Update health override
        if (isSuccess) {
          setHealthOverrides(prev => ({ ...prev, [batchSteps[index].table]: 'green' }))
        }

        // Continue to next step
        executeStep(index + 1)
      }, delay)
    }

    executeStep(0)
  }, [batchSteps])

  // ── Cancel batch execution ─────────────────────────────────
  const cancelBatch = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setBatchExecuting(false)
    setBatchSteps(prev => prev.map(s =>
      s.status === 'waiting' ? s :
      s.status === 'running' ? { ...s, status: 'waiting' } : s
    ))
  }, [])

  // ── Close batch dialog ─────────────────────────────────────
  const closeBatchDialog = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    setShowBatchDialog(false)
    setBatchExecuting(false)
    setBatchCompleted(false)

    // Show summary if completed
    if (batchCompleted) {
      setShowSummaryDialog(true)
    }
  }, [batchCompleted])

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current)
      }
    }
  }, [])

  const confirmForceRetry = () => {
    setShowConfirmDialog(false)
    const tablesToRun = [...selected]
    setRunningTables(tablesToRun)

    // Mock: process each table with 2 second delay
    tablesToRun.forEach((table, index) => {
      setTimeout(() => {
        setRunningTables(prev => prev.filter(t => t !== table))
        setCompletedTables(prev => new Set(prev).add(table))
        setFlashTables(prev => new Set(prev).add(table))

        // Flash animation cleanup after 1s
        setTimeout(() => {
          setFlashTables(prev => {
            const next = new Set(prev)
            next.delete(table)
            return next
          })
        }, 1000)

        // Update health to green
        setHealthOverrides(prev => ({ ...prev, [table]: 'green' }))

        // Last table done
        if (index === tablesToRun.length - 1) {
          setCompletedTables(new Set())
          setSelected(new Set())
          toast.success(`补数完成`, {
            description: `已成功补数 ${tablesToRun.length} 张表`,
          })
        }
      }, (index + 1) * 2000)
    })
  }

  // 7 日健康度趋势（每日 success/failed/skipped 堆叠）
  const dailyTrend = useMemo(() => {
    const days = ['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25']
    return days.map(d => {
      let success = 0, failed = 0, skipped = 0, pending = 0
      HEALTH_MATRIX.forEach(row => {
        const day = row.days.find(x => x.date === d)
        if (!day) return
        if (day.status === 'success') success++
        else if (day.status === 'failed') failed++
        else if (day.status === 'skipped') skipped++
        else pending++
      })
      const total = success + failed + skipped + pending
      const rate = total > 0 ? Math.round((success / (success + failed)) * 100) : 100
      return { date: d, success, failed, skipped, pending, total, rate }
    })
  }, [])

  // 按目录分组的健康度分布
  const dirHealth = useMemo(() => {
    const dirs = ['1_入库', '2_计算', '3_策略', '4_工具']
    return dirs.map(dir => {
      const tables = TABLES.filter(t => t.dir === dir)
      return {
        dir,
        total: tables.length,
        green: tables.filter(t => getHealth(t.table) === 'green').length,
        yellow: tables.filter(t => getHealth(t.table) === 'yellow').length,
        red: tables.filter(t => getHealth(t.table) === 'red').length,
        white: tables.filter(t => getHealth(t.table) === 'white').length,
      }
    })
  }, [getHealth])

  // 过滤后的矩阵
  const filteredMatrix = useMemo(() => {
    if (dirFilter === 'all') return HEALTH_MATRIX
    return HEALTH_MATRIX.filter(row => {
      const t = TABLES.find(x => x.table === row.table)
      return t?.dir === dirFilter
    })
  }, [dirFilter])

  // Batch summary
  const batchSummary = useMemo(() => {
    const success = batchSteps.filter(s => s.status === 'success')
    const failed = batchSteps.filter(s => s.status === 'failed')
    const total = batchSteps.length
    const totalEstTime = batchSteps.reduce((sum, s) => {
      const t = parseInt(s.estimatedTime.replace(/[^0-9]/g, '')) || 5
      return sum + t
    }, 0)
    return { success, failed, total, totalEstTime }
  }, [batchSteps])

  return (
    <div className="space-y-5">
      {/* 加载中 / 错误提示 (real health snapshot) */}
      {healthLoading && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          <span>正在从 DuckDB 加载真实健康度快照...</span>
        </div>
      )}
      {healthError && !healthLoading && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="text-amber-700 dark:text-amber-300 font-medium">健康度实时加载失败</span>
          <span className="text-amber-600 dark:text-amber-400">({healthError})，已降级使用 mock 数据。</span>
          <Button size="sm" variant="outline" className="ml-auto h-6 text-[11px]" onClick={loadHealth}>重试</Button>
        </div>
      )}

      {/* 非交易日提示 */}
      {!isTodayTradingDay && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sm">
          <Info className="h-4 w-4 text-sky-500 flex-shrink-0" />
          <span className="text-sky-700 dark:text-sky-300 font-medium">当前为非交易日</span>
          <span className="text-sky-600 dark:text-sky-400">，部分数据指标可能不更新。滞后表不计入健康度扣分。</span>
        </div>
      )}

      {/* ── Health Score Hero Section ─────────────────────────── */}
      <Card className="overflow-hidden">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row items-center gap-6">
            {/* Circular progress ring */}
            <div className="flex flex-col items-center gap-2">
              <HealthScoreRing score={healthScore} size={160} />
              <span className="text-sm text-zinc-500 font-medium">健康度评分</span>
            </div>

            {/* Stats + description */}
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <HeartPulse className="h-5 w-5 text-emerald-500" />
                  数据管线健康度总览
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  基于 {TABLES.length} 张表的新鲜度、执行状态、一致性综合评分
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="健康" value={greenTables.length} color="emerald" />
                <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="异常/滞后" value={redTables.length} color="rose" />
                <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="待查" value={yellowTables.length} color="amber" />
                <StatCard icon={<Activity className="h-4 w-4" />} label="不适用(once)" value={whiteTables.length} color="zinc" />
              </div>

              {/* 刷新健康度 button */}
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleRefreshHealth}
                  disabled={refreshing}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {refreshing ? (
                    <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />刷新中...</>
                  ) : (
                    <><RefreshCw className="h-3.5 w-3.5 mr-1.5" />刷新健康度</>
                  )}
                </Button>
                <span className="text-[11px] text-zinc-400">上次刷新: {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 7 日健康度趋势 + 按目录分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              7 日健康度趋势
              <Badge variant="outline" className="text-[10px] ml-1">堆叠柱状图</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              {/* Grid lines */}
              <div className="absolute inset-0 flex flex-col justify-between pointer-events-none" style={{ height: '164px', paddingBottom: '24px' }}>
                {[0, 25, 50, 75, 100].map(pct => (
                  <div key={pct} className="flex items-center gap-1">
                    <span className="text-[9px] text-zinc-400 font-mono w-6 text-right">{pct}%</span>
                    <div className="flex-1 border-t border-dashed border-zinc-200 dark:border-zinc-800" />
                  </div>
                ))}
              </div>

              {/* Bar chart */}
              <div className="flex items-end gap-2 h-40 mb-3 pl-7">
                {dailyTrend.map((d, idx) => {
                  const maxTotal = Math.max(...dailyTrend.map(x => x.total), 1)
                  const unit = 140 / maxTotal
                  return (
                    <Tooltip key={d.date}>
                      <TooltipTrigger asChild>
                        <div
                          className="flex-1 flex flex-col items-center gap-1 group animate-fade-in"
                          style={{ animationDelay: `${idx * 80}ms`, animationFillMode: 'both' }}
                        >
                          <div className="text-[9px] text-zinc-500 font-mono font-medium">{d.rate}%</div>
                          <div className="w-full flex flex-col-reverse rounded overflow-hidden" style={{ height: `${(d.total / maxTotal) * 140}px` }}>
                            <div className="bg-emerald-500 group-hover:bg-emerald-600 transition-colors" style={{ height: `${d.success * unit}px` }} />
                            <div className="bg-rose-500 group-hover:bg-rose-600 transition-colors" style={{ height: `${d.failed * unit}px` }} />
                            <div className="bg-amber-500 group-hover:bg-amber-600 transition-colors" style={{ height: `${d.skipped * unit}px` }} />
                            <div className="bg-zinc-200 dark:bg-zinc-700 group-hover:bg-zinc-300 dark:group-hover:bg-zinc-600 transition-colors" style={{ height: `${d.pending * unit}px` }} />
                          </div>
                          <div className="text-[10px] text-zinc-400">{d.date}</div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <div className="space-y-0.5">
                          <div className="font-medium">{d.date}</div>
                          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> 成功: {d.success}</div>
                          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-500" /> 失败: {d.failed}</div>
                          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-500" /> 跳过: {d.skipped}</div>
                          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-zinc-300" /> 待执行: {d.pending}</div>
                          <div className="border-t border-white/20 pt-0.5 mt-0.5">成功率: {d.rate}%</div>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> 成功</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> 失败</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> 跳过</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-200 dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-600" /> 待执行</span>
              <span className="ml-auto text-zinc-400">7 日均成功率 {Math.round(dailyTrend.reduce((s, d) => s + d.rate, 0) / dailyTrend.length)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-fuchsia-500" />
              按目录分布
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {dirHealth.map(d => {
                const total = d.total || 1
                const greenPct = Math.round((d.green / total) * 100)
                const yellowPct = Math.round((d.yellow / total) * 100)
                const redPct = Math.round((d.red / total) * 100)
                const whitePct = 100 - greenPct - yellowPct - redPct
                return (
                  <div key={d.dir}>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="font-mono font-medium">{d.dir}</span>
                      <span className="text-zinc-500">{d.total} 表</span>
                    </div>
                    {/* Horizontal stacked bar */}
                    <div className="flex h-5 rounded-md overflow-hidden">
                      <div
                        className="bg-emerald-500 flex items-center justify-center transition-all duration-500"
                        style={{ width: `${greenPct}%` }}
                        title={`健康 ${d.green} (${greenPct}%)`}
                      >
                        {greenPct >= 15 && <span className="text-[9px] text-white font-medium">{greenPct}%</span>}
                      </div>
                      <div
                        className="bg-amber-500 flex items-center justify-center transition-all duration-500"
                        style={{ width: `${yellowPct}%` }}
                        title={`待查 ${d.yellow} (${yellowPct}%)`}
                      >
                        {yellowPct >= 15 && <span className="text-[9px] text-white font-medium">{yellowPct}%</span>}
                      </div>
                      <div
                        className="bg-rose-500 flex items-center justify-center transition-all duration-500"
                        style={{ width: `${redPct}%` }}
                        title={`异常 ${d.red} (${redPct}%)`}
                      >
                        {redPct >= 15 && <span className="text-[9px] text-white font-medium">{redPct}%</span>}
                      </div>
                      <div
                        className="bg-zinc-300 dark:bg-zinc-700 flex items-center justify-center transition-all duration-500"
                        style={{ width: `${whitePct}%` }}
                        title={`once ${d.white} (${whitePct}%)`}
                      >
                        {whitePct >= 15 && <span className="text-[9px] text-zinc-600 dark:text-zinc-400 font-medium">{whitePct}%</span>}
                      </div>
                    </div>
                    {/* Legend row with counts */}
                    <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <span className="h-2 w-2 rounded-sm bg-emerald-500" /> {d.green} 健康
                      </span>
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <span className="h-2 w-2 rounded-sm bg-amber-500" /> {d.yellow} 待查
                      </span>
                      <span className="flex items-center gap-1 text-rose-600 dark:text-rose-400">
                        <span className="h-2 w-2 rounded-sm bg-rose-500" /> {d.red} 异常
                      </span>
                      {d.white > 0 && (
                        <span className="flex items-center gap-1 text-zinc-500">
                          <span className="h-2 w-2 rounded-sm bg-zinc-300 dark:bg-zinc-700" /> {d.white} once
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 交易日历信息卡 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-sky-500" />
            交易日历
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-zinc-400">最近交易日</div>
              <div className="text-lg font-mono font-semibold text-emerald-600">{lastTradingDay}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">今日是否交易日</div>
              <div className={`text-lg font-mono font-semibold ${isTodayTradingDay ? 'text-emerald-600' : 'text-zinc-400'}`}>
                {isTodayTradingDay ? '是' : '否'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">下一交易日</div>
              <div className="text-lg font-mono font-semibold text-sky-600">{nextTradingDay}</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">市场状态</div>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`h-2 w-2 rounded-full ${isTodayTradingDay ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                <span className={`text-sm font-medium ${isTodayTradingDay ? 'text-emerald-600' : 'text-zinc-500'}`}>
                  {isTodayTradingDay ? '交易中' : '休市'}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 一致性栏 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">一致性总览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-zinc-400">孤儿表（有表无脚本）</div>
              <div className="text-lg font-mono font-semibold text-emerald-600">0</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">死脚本（有脚本无表）</div>
              <div className="text-lg font-mono font-semibold text-rose-500">2</div>
              <div className="text-[10px] text-zinc-400">sector_stocks / t_bk5_19</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">字段中文待补充</div>
              <div className="text-lg font-mono font-semibold text-amber-500">3</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">lint 通过率</div>
              <div className="text-lg font-mono font-semibold text-amber-500">70+</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 红绿灯矩阵 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3 flex-wrap gap-2">
          <CardTitle className="text-base">健康度矩阵 · 近 7 天</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1">
              <Filter className="h-3 w-3 text-zinc-400" />
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                <button onClick={() => setDirFilter('all')} className={`px-2 py-0.5 text-[11px] rounded ${dirFilter === 'all' ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>全部</button>
                {['1_入库', '2_计算', '3_策略', '4_工具'].map(d => (
                  <button key={d} onClick={() => setDirFilter(d)} className={`px-2 py-0.5 text-[11px] rounded ${dirFilter === d ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d.split('_')[1]}</button>
                ))}
              </div>
            </div>
            <Badge variant="outline" className="text-[10px]">最近交易日 {lastTradingDay}</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[840px]">
              <div className="grid grid-cols-[32px_20px_1fr_180px_repeat(7,60px)_90px] gap-1 px-3 py-2 text-[10px] font-medium text-zinc-500 border-b bg-zinc-50/50 dark:bg-zinc-900/30">
                <div />
                <div />
                <div>表名</div>
                <div>类型</div>
                {['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25'].map(d => <div key={d} className="text-center">{d}</div>)}
                <div className="text-center">操作</div>
              </div>
              {filteredMatrix.map((row, rowIdx) => {
                const t = TABLES.find(x => x.table === row.table)!
                const currentHealth = getHealth(row.table)
                const isRed = currentHealth === 'red'
                const isYellow = currentHealth === 'yellow'
                const isSelected = selected.has(row.table)
                const isRunning = runningTables.includes(row.table)
                const isCompleted = completedTables.has(row.table)
                const isFlashing = flashTables.has(row.table)
                const isExpanded = expandedRows.has(row.table)
                const isAltRow = rowIdx % 2 === 1
                return (
                  <Collapsible key={row.table} open={isExpanded} onOpenChange={() => toggleRow(row.table)}>
                    <div
                      className={`grid grid-cols-[32px_20px_1fr_180px_repeat(7,60px)_90px] gap-1 px-3 py-2 text-xs items-center border-b last:border-0 transition-colors ${
                        isAltRow ? 'bg-zinc-50/50 dark:bg-zinc-900/20' : ''
                      } hover:bg-amber-50/40 dark:hover:bg-amber-950/10 ${
                        isSelected ? 'bg-rose-50 dark:bg-rose-950/20' : ''
                      } ${isFlashing ? 'animate-pulse bg-emerald-50 dark:bg-emerald-950/30' : ''} ${
                        isRunning ? 'bg-amber-50 dark:bg-amber-950/20' : ''
                      }`}
                    >
                      <div className="flex justify-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(row.table)}
                          disabled={isRunning || isCompleted}
                          className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-600 text-amber-600 focus:ring-amber-500 cursor-pointer accent-amber-600"
                        />
                      </div>
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center justify-center text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                          {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      </CollapsibleTrigger>
                      <div className="min-w-0">
                        <div className="font-mono truncate flex items-center gap-1.5">
                          {row.table}
                          {/* Colored pill badge for health status */}
                          <HealthPillBadge status={currentHealth} />
                          {isRunning && <Loader2 className="h-3 w-3 text-amber-500 animate-spin" />}
                          {isCompleted && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                        </div>
                        <div className="text-[10px] text-zinc-400 truncate">{t.cn}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-zinc-500">{getRows(row.table) > 0 ? `${(getRows(row.table) / 10000).toFixed(1)}万行` : '0行'}</div>
                        <div className={`text-[11px] font-medium ${freshnessClass(t.freshness)}`}>{t.freshness}</div>
                      </div>
                      {row.days.map(d => (
                        <div key={d.date} className="flex justify-center">
                          <span className={`h-5 w-5 rounded flex items-center justify-center text-[9px] ${dayStatusClass(d.status)}`}>
                            {d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : d.status === 'skipped' ? '–' : ''}
                          </span>
                        </div>
                      ))}
                      <div className="flex justify-center">
                        {isRunning ? (
                          <Badge variant="outline" className="text-amber-600 border-amber-300 py-0 text-[10px]">
                            <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />补数中
                          </Badge>
                        ) : isRed || isYellow ? (
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onRunTable?.(row.table)}>
                            <RefreshCw className="h-3 w-3 mr-0.5" />补数
                          </Button>
                        ) : (
                          <span className={`text-[10px] ${healthTextColorClass(currentHealth)}`}>●</span>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail row */}
                    <CollapsibleContent>
                      <div className={`px-3 py-3 border-b text-xs ${isAltRow ? 'bg-zinc-50/30 dark:bg-zinc-900/10' : ''} bg-zinc-50/60 dark:bg-zinc-900/20`}>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 ml-[52px]">
                          <div>
                            <div className="text-[10px] text-zinc-400 mb-0.5">调度频率</div>
                            <div className="text-sm font-medium">{t.schedule}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-zinc-400 mb-0.5">写入模式</div>
                            <div className="text-sm font-medium">{t.mode}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-zinc-400 mb-0.5">行数</div>
                            <div className="text-sm font-mono font-medium">{getRows(t.table).toLocaleString()}</div>
                          </div>
                          <div>
                            <div className="text-[10px] text-zinc-400 mb-0.5">新鲜度</div>
                            <div className={`text-sm font-medium ${freshnessClass(t.freshness)}`}>{t.freshness}</div>
                          </div>
                        </div>
                        {t.dependsOn.length > 0 && (
                          <div className="mt-2 ml-[52px] flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <GitBranch className="h-3 w-3" />
                            <span>依赖:</span>
                            {t.dependsOn.map(d => (
                              <span key={d} className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">{d}</span>
                            ))}
                          </div>
                        )}
                        {t.downstream.length > 0 && (
                          <div className="mt-1 ml-[52px] flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <ArrowRight className="h-3 w-3" />
                            <span>下游:</span>
                            {t.downstream.slice(0, 3).map(d => (
                              <span key={d} className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1.5 py-0.5 rounded text-[10px]">{d}</span>
                            ))}
                            {t.downstream.length > 3 && <span className="text-zinc-400">+{t.downstream.length - 3}</span>}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 红表示例详情 - 异常自动归因 */}
      {redTables.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-rose-500">
              <AlertTriangle className="h-4 w-4" />异常表自动归因 ({redTables.length})
              <Badge variant="outline" className="text-[10px] text-rose-500 border-rose-300 ml-1">ROOT CAUSE</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {redTables.map(t => {
              const attribution = getAttribution(t.table)
              return (
                <div key={t.table} className="p-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-medium text-sm">{t.table}</span>
                      <span className="text-xs text-zinc-500">{t.cn}</span>
                      <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${attribution.severity === 'critical' ? 'text-rose-500 border-rose-400 bg-rose-100/50 dark:bg-rose-950/40' : 'text-amber-500 border-amber-400'}`}>
                        {attribution.severity === 'critical' ? 'CRITICAL' : 'WARNING'}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] py-0 px-1.5 text-zinc-500">{attribution.category}</Badge>
                    </div>
                    <Button size="sm" variant="destructive" onClick={() => onRunTable?.(t.table)}>
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />强制重跑
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    {/* 根因 */}
                    <div className="p-2 rounded bg-rose-100/40 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
                      <div className="text-[10px] font-medium text-rose-600 dark:text-rose-400 mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />根因
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{attribution.cause}</div>
                    </div>
                    {/* 影响 */}
                    <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                      <div className="text-[10px] font-medium text-amber-600 dark:text-amber-400 mb-1 flex items-center gap-1">
                        <Activity className="h-3 w-3" />下游影响
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300 leading-relaxed">
                        {t.downstream.length > 0 ? (
                          <>
                            <span className="font-mono">{t.downstream.length}</span> 张下游表阻塞：{t.downstream.slice(0, 2).map(d => <span key={d} className="font-mono text-[10px] bg-amber-100 dark:bg-amber-900/40 px-1 rounded mr-0.5">{d}</span>)}
                            {t.downstream.length > 2 && <span className="text-zinc-500"> 等</span>}
                          </>
                        ) : '无下游依赖'}
                      </div>
                    </div>
                    {/* 修复建议 */}
                    <div className="p-2 rounded bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                      <div className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1">
                        <Wrench className="h-3 w-3" />修复建议
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{attribution.fix}</div>
                    </div>
                  </div>

                  {/* 修复步骤 */}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] text-zinc-500 flex items-center gap-1"><RefreshCw className="h-3 w-3" />修复步骤:</span>
                    {attribution.steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-1">
                        <span className="h-4 w-4 rounded-full bg-zinc-200 dark:bg-zinc-700 text-[9px] font-mono flex items-center justify-center text-zinc-600 dark:text-zinc-300">{i + 1}</span>
                        <span className="text-[11px] text-zinc-600 dark:text-zinc-400">{step}</span>
                        {i < attribution.steps.length - 1 && <span className="text-zinc-300 mx-0.5">→</span>}
                      </div>
                    ))}
                  </div>

                  {/* 最后出错时间 */}
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-zinc-500">
                    <span className="flex items-center gap-1"><Activity className="h-3 w-3" />最后出错: {attribution.lastError}</span>
                    <span>·</span>
                    <span>重试次数: {attribution.retries}/3</span>
                    <span>·</span>
                    <span className={attribution.estimatedFix !== '5min' ? 'text-amber-500' : 'text-emerald-500'}>预计修复: {attribution.estimatedFix}</span>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Floating action bar when tables are selected */}
      {selected.size > 0 && !showConfirmDialog && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-center gap-3 px-5 py-3 bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-xl shadow-2xl border border-zinc-700 dark:border-zinc-300">
            <Badge className="bg-amber-500 text-white border-0 hover:bg-amber-600">
              已选 {selected.size} 张表
            </Badge>
            <Button
              size="sm"
              className="bg-amber-500 hover:bg-amber-600 text-white h-8"
              onClick={openBatchDialog}
            >
              <Zap className="h-3.5 w-3.5 mr-1" />
              批量补数
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 border-rose-400 text-rose-400 hover:bg-rose-500/10"
              onClick={selectAllRedYellow}
            >
              全选红/黄
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-zinc-400 hover:text-white dark:hover:text-zinc-900"
              onClick={clearSelection}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Running progress bar */}
      {runningTables.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-5 py-3 bg-amber-500 text-white rounded-xl shadow-2xl">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">
              正在补数... {completedTables.size}/{selected.size + completedTables.size + runningTables.length}
            </span>
            <div className="w-32 h-2 bg-amber-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-white rounded-full transition-all duration-300"
                style={{ width: `${(completedTables.size / (runningTables.length + completedTables.size)) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Batch Remediation Dialog */}
      <Dialog open={showBatchDialog} onOpenChange={(open) => { if (!open && !batchExecuting) closeBatchDialog() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col" showCloseButton={!batchExecuting}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-gradient-to-br from-amber-500 to-rose-500 text-white">
                <Zap className="h-4 w-4" />
              </div>
              批量补数任务编排
              {batchCompleted && (
                <Badge variant="outline" className="text-emerald-500 border-emerald-300 text-[10px]">
                  <CheckCircle2 className="h-3 w-3 mr-0.5" />已完成
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              {batchCompleted
                ? `补数完成：成功 ${batchSummary.success.length} 张，失败 ${batchSummary.failed.length} 张`
                : batchExecuting
                  ? '正在按顺序执行补数任务...'
                  : `已选 ${batchSteps.length} 张表，预计总耗时 ~${batchSteps.reduce((sum, s) => sum + (parseInt(s.estimatedTime.replace(/[^0-9]/g, '')) || 5), 0)}s`}
            </DialogDescription>
          </DialogHeader>

          {/* Controls */}
          {!batchExecuting && !batchCompleted && (
            <div className="flex items-center gap-4 px-1 py-2 border-b">
              <div className="flex items-center gap-2">
                <GitBranch className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-500">智能排序</span>
                <Switch
                  checked={smartSort}
                  onCheckedChange={(v) => {
                    setSmartSort(v)
                    // Re-sort steps
                    const currentTables = batchSteps.map(s => s.table)
                    const sorted = v ? topologicalSort(currentTables) : currentTables
                    setBatchSteps(prev => {
                      const stepMap = new Map(prev.map(s => [s.table, s]))
                      return sorted.map((table, idx) => {
                        const step = stepMap.get(table)!
                        return { ...step, order: idx + 1 }
                      })
                    })
                  }}
                />
                <span className="text-[10px] text-zinc-400">{smartSort ? '按依赖拓扑排序' : '按选择顺序'}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-xs text-zinc-500">Force 模式</span>
                <Switch
                  checked={batchForceMode}
                  onCheckedChange={setBatchForceMode}
                />
                <span className="text-[10px] text-zinc-400">{batchForceMode ? '强制重跑' : '正常重试'}</span>
              </div>
            </div>
          )}

          {/* Progress bar during execution */}
          {batchExecuting && (
            <div className="px-1 py-2">
              <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
                <span>执行进度</span>
                <span className="font-mono">
                  {batchSteps.filter(s => s.status === 'success' || s.status === 'failed').length} / {batchSteps.length}
                </span>
              </div>
              <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all duration-500"
                  style={{
                    width: `${((batchSteps.filter(s => s.status === 'success' || s.status === 'failed').length) / batchSteps.length) * 100}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* Steps list */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 py-2 px-1">
            {batchSteps.map((step, idx) => (
              <div
                key={step.table}
                className={`flex items-center gap-3 p-2.5 rounded-md border transition-all ${
                  step.status === 'running' ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30' :
                  step.status === 'success' ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/20' :
                  step.status === 'failed' ? 'border-rose-300 dark:border-rose-700 bg-rose-50 dark:bg-rose-950/20' :
                  'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50'
                }`}
              >
                {/* Order number */}
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-mono font-medium flex-shrink-0 ${
                  step.status === 'running' ? 'bg-amber-500 text-white' :
                  step.status === 'success' ? 'bg-emerald-500 text-white' :
                  step.status === 'failed' ? 'bg-rose-500 text-white' :
                  'bg-zinc-200 dark:bg-zinc-700 text-zinc-500'
                }`}>
                  {step.status === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                   step.status === 'failed' ? <X className="h-3.5 w-3.5" /> :
                   step.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                   step.order}
                </div>

                {/* Table info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-medium">{step.table}</span>
                    <span className="text-[10px] text-zinc-400">{step.cn}</span>
                    {step.isForce && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1 text-amber-500 border-amber-300">FORCE</Badge>
                    )}
                  </div>
                  {step.dependsOn.length > 0 && (
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] text-zinc-400">
                      <GitBranch className="h-2.5 w-2.5" />
                      依赖: {step.dependsOn.map(d => (
                        <span key={d} className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 rounded">{d}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Status + estimated time */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-zinc-400 flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />{step.estimatedTime}
                  </span>
                  <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${
                    step.status === 'running' ? 'text-amber-500 border-amber-300' :
                    step.status === 'success' ? 'text-emerald-500 border-emerald-300' :
                    step.status === 'failed' ? 'text-rose-500 border-rose-300' :
                    'text-zinc-400 border-zinc-300'
                  }`}>
                    {step.status === 'waiting' && '等待中'}
                    {step.status === 'running' && '执行中'}
                    {step.status === 'success' && '成功'}
                    {step.status === 'failed' && '失败'}
                  </Badge>
                </div>

                {/* Arrow between steps */}
                {idx < batchSteps.length - 1 && (
                  <div className="absolute right-6 bottom-0 translate-y-1/2">
                  </div>
                )}
              </div>
            ))}
            {/* Connecting lines */}
            {batchSteps.length > 1 && (
              <div className="absolute left-0 right-0 top-0 bottom-0 pointer-events-none" />
            )}
          </div>

          <DialogFooter className="flex items-center gap-2 border-t pt-3">
            {batchCompleted ? (
              <>
                <Button variant="outline" size="sm" onClick={closeBatchDialog}>
                  关闭
                </Button>
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => {
                  setShowSummaryDialog(true)
                  setShowBatchDialog(false)
                }}>
                  <Eye className="h-3.5 w-3.5 mr-1" />查看详情
                </Button>
              </>
            ) : batchExecuting ? (
              <Button variant="outline" size="sm" className="text-rose-500 border-rose-300" onClick={cancelBatch}>
                <X className="h-3.5 w-3.5 mr-1" />取消执行
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowBatchDialog(false)}>
                  取消
                </Button>
                <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={executeBatch}>
                  <Zap className="h-3.5 w-3.5 mr-1" />
                  开始执行 ({batchSteps.length} 张表)
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Summary Dialog */}
      <Dialog open={showSummaryDialog} onOpenChange={setShowSummaryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              补数执行报告
            </DialogTitle>
            <DialogDescription>
              批量补数任务已完成
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Summary stats */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 text-center">
                <div className="text-2xl font-bold text-emerald-500">{batchSummary.success.length}</div>
                <div className="text-[10px] text-emerald-500">成功</div>
              </div>
              <div className="p-3 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 text-center">
                <div className="text-2xl font-bold text-rose-500">{batchSummary.failed.length}</div>
                <div className="text-[10px] text-rose-500">失败</div>
              </div>
              <div className="p-3 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 text-center">
                <div className="text-2xl font-bold text-zinc-600">{batchSummary.total}</div>
                <div className="text-[10px] text-zinc-600">总计</div>
              </div>
            </div>

            {/* Failed tables detail */}
            {batchSummary.failed.length > 0 && (
              <div className="p-3 rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50/50 dark:bg-rose-950/20">
                <div className="text-xs font-medium text-rose-600 dark:text-rose-400 mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />失败表详情
                </div>
                <div className="space-y-1">
                  {batchSummary.failed.map(step => (
                    <div key={step.table} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{step.table}</span>
                      <Button size="sm" variant="ghost" className="h-6 text-[10px] text-rose-500" onClick={() => {
                        onRunTable?.(step.table)
                        setShowSummaryDialog(false)
                      }}>
                        <RefreshCw className="h-3 w-3 mr-0.5" />重试
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Total time */}
            <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />预计总耗时</span>
              <span className="font-mono">~{batchSummary.totalEstTime}s</span>
            </div>
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setShowSummaryDialog(false)}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowConfirmDialog(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-md border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b bg-gradient-to-r from-amber-50 to-rose-50 dark:from-amber-950/30 dark:to-rose-950/30 rounded-t-xl">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-amber-500 to-rose-500 text-white">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">确认批量补数</div>
                  <div className="text-[10px] text-zinc-500">将强制重跑以下表的数据管线</div>
                </div>
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="text-xs text-zinc-500 mb-2">已选 {selected.size} 张表：</div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 p-2 rounded-md bg-zinc-50 dark:bg-zinc-950/50 border">
                {[...selected].map(table => (
                  <div key={table} className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${getHealth(table) === 'red' ? 'bg-rose-500' : getHealth(table) === 'yellow' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span className="font-mono">{table}</span>
                    <span className="text-zinc-400">
                      {getHealth(table) === 'red' ? '异常' : getHealth(table) === 'yellow' ? '待查' : '健康'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>补数将执行 force 重跑，预计每张表耗时约 2 秒</span>
              </div>
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-b-xl">
              <Button size="sm" variant="outline" onClick={() => setShowConfirmDialog(false)}>取消</Button>
              <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={confirmForceRetry}>
                <Zap className="h-3 w-3 mr-1" />
                确认补数 ({selected.size})
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Status Pill Badge ─────────────────────────────────────────
function HealthPillBadge({ status }: { status: HealthStatus }) {
  const config: Record<HealthStatus, { label: string; className: string }> = {
    green: { label: '健康', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20' },
    yellow: { label: '待查', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20' },
    red: { label: '异常', className: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/20' },
    white: { label: 'once', className: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20' },
  }
  const { label, className } = config[status]
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-medium border ${className}`}>
      {label}
    </span>
  )
}

function dayStatusClass(s: string): string {
  switch (s) {
    case 'success': return 'bg-emerald-500 text-white'
    case 'failed': return 'bg-rose-500 text-white'
    case 'skipped': return 'bg-amber-500 text-white'
    default: return 'bg-zinc-200 dark:bg-zinc-700 text-zinc-400'
  }
}

// 异常自动归因数据
interface Attribution {
  severity: 'critical' | 'warning'
  category: string
  cause: string
  fix: string
  steps: string[]
  lastError: string
  retries: number
  estimatedFix: string
}

function getAttribution(table: string): Attribution {
  const map: Record<string, Attribution> = {
    sector_stocks: {
      severity: 'warning',
      category: '实现缺失',
      cause: '脚本未实现：ensure_table 里表名字面量写着「表名」，未真正建表也未灌数。',
      fix: '删除该脚本，或正确实现 ensure_table + fetch_data + save_data。',
      steps: ['定位脚本', '修复字面量', '本地验证', '重新入库'],
      lastError: new Date().toISOString().slice(0, 19).replace('T', ' '),
      retries: 0,
      estimatedFix: '15min',
    },
    t_bk5_19: {
      severity: 'critical',
      category: '配置矛盾',
      cause: '@meta mode=increment 与代码 MODE="full" 矛盾，DELETE 逻辑错乱导致数据滞后 1 天。',
      fix: '统一 @meta 与代码 MODE 为 full（全量重灌语义），并补跑昨日数据。',
      steps: ['改 YAML @meta', '改代码常量', 'lint 校验', 'force 补数'],
      lastError: new Date().toISOString().slice(0, 19).replace('T', ' '),
      retries: 3,
      estimatedFix: '30min',
    },
  }
  return map[table] || {
    severity: 'warning',
    category: '未知',
    cause: '未配置归因规则，请检查脚本日志确认根因。',
    fix: '查看 logs/run_YYYYMMDD.log 定位异常堆栈。',
    steps: ['查日志', '定位异常', '修复', '重跑'],
    lastError: '—',
    retries: 0,
    estimatedFix: '—',
  }
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'emerald' | 'rose' | 'amber' | 'zinc' }) {
  const map = {
    emerald: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40',
    rose: 'text-rose-500 bg-rose-50 dark:bg-rose-950/40',
    amber: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40',
    zinc: 'text-zinc-500 bg-zinc-100 dark:bg-zinc-800',
  }
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-3">
        <div className={`p-2 rounded-lg ${map[color]}`}>{icon}</div>
        <div>
          <div className="text-2xl font-semibold leading-none">{value}</div>
          <div className="text-[11px] text-zinc-500 mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  )
}
