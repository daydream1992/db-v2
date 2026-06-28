'use client'
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { PIPELINE_RUNS, SCHEDULES, TABLES, PipelineRun, isTradingDay, getLastTradingDay, TRADING_CALENDAR } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { RunDetailSheet } from './run-detail-sheet'
import { SchedulerPanel } from './scheduler-panel'
import { Play, Clock, CheckCircle2, XCircle, SkipForward, Loader2, Calendar, GitBranch, ChevronRight, ArrowDown, Activity, ZoomIn, ZoomOut, Move, GripVertical, ChevronUp, ChevronDown, Maximize2, Zap, MoreHorizontal, Timer, ArrowRight, AlertTriangle, Wifi, WifiOff, Terminal, Trash2 } from 'lucide-react'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import type { LogLine, LogLevel } from '@/hooks/use-log-streamer'
import { formatDuration, formatRows, runStatusClass, triggerClass } from '@/lib/dataops/styles'
import { toast } from 'sonner'

// ─── Gantt timeline helpers ───
function parseTs(s: string): number {
  return new Date(s.replace(' ', 'T')).getTime()
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtTimeFull(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
}

function fmtDateHourMin(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function tsToTimeInput(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function timeInputToTs(baseDate: Date, timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  const d = new Date(baseDate)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// Snap timestamp to 5-minute grid
function snapToGrid(ts: number): number {
  const FIVE_MIN = 5 * 60 * 1000
  return Math.round(ts / FIVE_MIN) * FIVE_MIN
}

// ─── Enhanced status bar colors (green=success, amber=running, red=failed, gray=skipped) ───
const STATUS_BAR_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  success: { fill: '#10b981', stroke: '#059669', text: '#fff' },
  failed:  { fill: '#f43f5e', stroke: '#e11d48', text: '#fff' },
  running: { fill: '#f59e0b', stroke: '#d97706', text: '#fff' },
  skipped: { fill: '#a1a1aa', stroke: '#71717a', text: '#fff' },
  pending: { fill: '#d4d4d8', stroke: '#a1a1aa', text: '#71717a' },
}

// ─── Status pill badge styles ───
function statusPillClass(s: string): string {
  switch (s) {
    case 'success': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
    case 'failed': return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
    case 'running': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 animate-pulse'
    case 'skipped': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
    case 'pending': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
    default: return 'bg-zinc-100 text-zinc-500'
  }
}

function statusIcon(s: string) {
  switch (s) {
    case 'success': return <CheckCircle2 className="h-3 w-3 mr-1" />
    case 'failed': return <XCircle className="h-3 w-3 mr-1" />
    case 'running': return <Loader2 className="h-3 w-3 mr-1 animate-spin" />
    case 'skipped': return <SkipForward className="h-3 w-3 mr-1" />
    default: return <Clock className="h-3 w-3 mr-1" />
  }
}

// ─── Human-readable duration ───
function humanDuration(sec: number | null): string {
  if (sec === null) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return `${h}h ${rm}m`
}

interface GanttTooltip {
  run: PipelineRun
  x: number
  y: number
}

interface DragState {
  startX: number
  currentTime: number
}

// Bar drag state for adjusting time ranges
interface BarDragState {
  runId: number
  type: 'start' | 'end' | 'move'
  originalStartTs: number
  originalEndTs: number
  pointerStartX: number
  currentStartTs: number
  currentEndTs: number
}

export function OrchestrationView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [tab, setTab] = useState<'scheduler' | 'history' | 'dag' | 'schedules' | 'live'>('scheduler')
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const logStreamer = useLogStreamer(true)

  const openDetail = (run: PipelineRun) => {
    setSelectedRun(run)
    setDetailOpen(true)
  }

  const isTodayTradingDay = isTradingDay()

  return (
    <div className="space-y-4">
      {/* Non-trading day notice */}
      {!isTodayTradingDay && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="text-sky-700 dark:text-sky-300 font-medium">当前为非交易日</span>
          <span className="text-sky-600 dark:text-sky-400">，执行 daily 前请确认。最近交易日: {getLastTradingDay()}</span>
        </div>
      )}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 w-fit">
        {([['scheduler', '调度面板'], ['history', '执行历史'], ['dag', 'DAG 依赖图'], ['schedules', '调度计划'], ['live', '实时日志流']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${tab === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
          >
            {l}
            {k === 'live' && (
              <span className={`h-2 w-2 rounded-full ${logStreamer.connected ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            )}
          </button>
        ))}
      </div>

      {tab === 'scheduler' && <SchedulerPanel />}
      {tab === 'history' && <HistoryView onRunTable={onRunTable} onOpenDetail={openDetail} logStreamer={logStreamer} />}
      {tab === 'dag' && <DagView />}
      {tab === 'schedules' && <SchedulesView wsConnected={logStreamer.connected} />}
      {tab === 'live' && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${logStreamer.connected ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
              实时日志流
              <Badge variant="outline" className="text-[10px]">{logStreamer.connected ? '已连接' : '模拟模式'}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[400px]">
              <div className="space-y-0.5 font-mono text-xs">
                {logStreamer.logs.length === 0 ? (
                  <div className="text-zinc-400 py-8 text-center">暂无日志，点击"执行 Daily"开始</div>
                ) : (
                  logStreamer.logs.map((log, i) => (
                    <div key={i} className={`py-0.5 ${log.level === 'ERROR' ? 'text-rose-600' : log.level === 'WARN' ? 'text-amber-600' : 'text-zinc-600 dark:text-zinc-400'}`}>
                      <span className="text-zinc-400 mr-2">{log.ts}</span>
                      <span className="mr-1">[{log.level}]</span>
                      {log.message}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      <RunDetailSheet
        run={selectedRun}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onRerun={(t) => { onRunTable?.(t); setDetailOpen(false) }}
      />
    </div>
  )
}

function GanttTimeline({ onOpenDetail }: { onOpenDetail: (r: PipelineRun) => void }) {
  const [tooltip, setTooltip] = useState<GanttTooltip | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const [dragMode, setDragMode] = useState(false)
  const [barDrag, setBarDrag] = useState<BarDragState | null>(null)
  const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number; text: string } | null>(null)

  // Mutable runs state for drag adjustments
  const [runsState, setRunsState] = useState(() => [...PIPELINE_RUNS])

  // Compute full range from data
  const { rawMinTs, rawMaxTs, baseDate } = useMemo(() => {
    const starts = runsState.map(r => parseTs(r.startedAt))
    const ends = runsState.map(r => r.finishedAt ? parseTs(r.finishedAt) : parseTs(r.startedAt) + 30 * 60 * 1000)
    const rawMin = Math.min(...starts)
    const rawMax = Math.max(...ends)
    return { rawMinTs: rawMin, rawMaxTs: rawMax, baseDate: new Date(rawMin) }
  }, [runsState])

  // Time range state (defaults to full range)
  const [rangeStart, setRangeStart] = useState<number>(rawMinTs)
  const [rangeEnd, setRangeEnd] = useState<number>(rawMaxTs)
  const [startTimeInput, setStartTimeInput] = useState<string>(tsToTimeInput(rawMinTs))
  const [endTimeInput, setEndTimeInput] = useState<string>(tsToTimeInput(rawMaxTs))

  // Drag-to-zoom state
  const [zoomDragState, setZoomDragState] = useState<DragState | null>(null)
  const [dragCurrentX, setDragCurrentX] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Computed range values
  const { minTs, maxTs, totalSpan, timeLabels } = useMemo(() => {
    const span = rangeEnd - rangeStart
    const padding = span * 0.05
    const minTs = rangeStart - padding
    const maxTs = rangeEnd + padding
    const totalSpan = maxTs - minTs

    // Determine interval based on span
    let interval: number
    const spanMinutes = span / (60 * 1000)
    if (spanMinutes <= 60) interval = 5 * 60 * 1000 // 5 min
    else if (spanMinutes <= 180) interval = 10 * 60 * 1000 // 10 min
    else if (spanMinutes <= 720) interval = 30 * 60 * 1000 // 30 min
    else interval = 60 * 60 * 1000 // 1 hour

    const labels: { ts: number; label: string }[] = []
    const firstTick = Math.ceil(minTs / interval) * interval
    for (let t = firstTick; t <= maxTs; t += interval) {
      labels.push({ ts: t, label: fmtTime(t) })
    }

    return { minTs, maxTs, totalSpan, timeLabels: labels }
  }, [rangeStart, rangeEnd])

  const isZoomed = rangeStart !== rawMinTs || rangeEnd !== rawMaxTs

  // Quick-select handlers
  const handleQuickSelect = useCallback((preset: 'today' | 'yesterday' | '3days') => {
    const now = baseDate
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)
    const todayEnd = new Date(now)
    todayEnd.setHours(23, 59, 59, 999)

    if (preset === 'today') {
      const s = todayStart.getTime()
      const e = Math.min(todayEnd.getTime(), rawMaxTs)
      setRangeStart(s)
      setRangeEnd(e)
      setStartTimeInput(tsToTimeInput(s))
      setEndTimeInput(tsToTimeInput(e))
    } else if (preset === 'yesterday') {
      const yesterdayStart = new Date(todayStart)
      yesterdayStart.setDate(yesterdayStart.getDate() - 1)
      const yesterdayEnd = new Date(todayEnd)
      yesterdayEnd.setDate(yesterdayEnd.getDate() - 1)
      const s = yesterdayStart.getTime()
      const e = yesterdayEnd.getTime()
      setRangeStart(s)
      setRangeEnd(e)
      setStartTimeInput(tsToTimeInput(s))
      setEndTimeInput(tsToTimeInput(e))
    } else if (preset === '3days') {
      const threeDaysAgo = new Date(todayStart)
      threeDaysAgo.setDate(threeDaysAgo.getDate() - 2)
      const s = threeDaysAgo.getTime()
      const e = Math.min(todayEnd.getTime(), rawMaxTs)
      setRangeStart(s)
      setRangeEnd(e)
      setStartTimeInput(tsToTimeInput(s))
      setEndTimeInput(tsToTimeInput(e))
    }
  }, [baseDate, rawMaxTs])

  const handleStartTimeChange = useCallback((val: string) => {
    setStartTimeInput(val)
    const ts = timeInputToTs(baseDate, val)
    if (ts < rangeEnd) {
      setRangeStart(ts)
    }
  }, [baseDate, rangeEnd])

  const handleEndTimeChange = useCallback((val: string) => {
    setEndTimeInput(val)
    const ts = timeInputToTs(baseDate, val)
    if (ts > rangeStart) {
      setRangeEnd(ts)
    }
  }, [baseDate, rangeStart])

  const handleResetZoom = useCallback(() => {
    setRangeStart(rawMinTs)
    setRangeEnd(rawMaxTs)
    setStartTimeInput(tsToTimeInput(rawMinTs))
    setEndTimeInput(tsToTimeInput(rawMaxTs))
  }, [rawMinTs, rawMaxTs])

  // SVG layout constants
  const LABEL_W = 140
  const CHART_RIGHT = 40
  const ROW_H = 28
  const BAR_H = 20
  const BAR_Y_OFFSET = (ROW_H - BAR_H) / 2
  const HEADER_H = 24
  const SVG_W = 1100
  const CHART_W = SVG_W - LABEL_W - CHART_RIGHT
  const SVG_H = HEADER_H + runsState.length * ROW_H + 8

  const toX = useCallback((ts: number) => ((ts - minTs) / totalSpan) * CHART_W, [minTs, totalSpan])
  const fromX = useCallback((x: number) => minTs + (x / CHART_W) * totalSpan, [minTs, totalSpan])

  const handleBarClick = (run: PipelineRun) => {
    if (barDrag) return
    setTooltip(null)
    onOpenDetail(run)
  }

  // Drag-to-zoom handlers (only in zoom mode)
  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragMode) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = SVG_W / rect.width
    const svgX = (e.clientX - rect.left) * scaleX
    // Only start drag in the chart area (time axis area)
    if (svgX < LABEL_W || svgX > LABEL_W + CHART_W) return
    const chartX = svgX - LABEL_W
    setZoomDragState({ startX: chartX, currentTime: fromX(chartX) })
    setDragCurrentX(chartX)
  }, [dragMode, fromX, CHART_W])

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (dragMode || !zoomDragState) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scaleX = SVG_W / rect.width
    const svgX = (e.clientX - rect.left) * scaleX
    const chartX = Math.max(0, Math.min(CHART_W, svgX - LABEL_W))
    setDragCurrentX(chartX)
  }, [dragMode, zoomDragState, CHART_W])

  const handleMouseUp = useCallback(() => {
    if (dragMode) return
    if (!zoomDragState || dragCurrentX === null) {
      setZoomDragState(null)
      setDragCurrentX(null)
      return
    }

    const x1 = Math.min(zoomDragState.startX, dragCurrentX)
    const x2 = Math.max(zoomDragState.startX, dragCurrentX)

    // Only zoom if drag distance is at least 20px
    if (x2 - x1 > 20) {
      const newStart = fromX(x1)
      const newEnd = fromX(x2)
      setRangeStart(newStart)
      setRangeEnd(newEnd)
      setStartTimeInput(tsToTimeInput(newStart))
      setEndTimeInput(tsToTimeInput(newEnd))
    }

    setZoomDragState(null)
    setDragCurrentX(null)
  }, [dragMode, zoomDragState, dragCurrentX, fromX])

  // Add global mouseup handler for when mouse leaves svg
  useEffect(() => {
    if (!zoomDragState) return
    const handleGlobalMouseUp = () => {
      setZoomDragState(null)
      setDragCurrentX(null)
    }
    window.addEventListener('mouseup', handleGlobalMouseUp)
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp)
  }, [zoomDragState])

  // ─── Bar drag handlers (pointer events) ───
  const getSvgPoint = useCallback((clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    const scaleX = SVG_W / rect.width
    const svgX = (clientX - rect.left) * scaleX
    return svgX - LABEL_W
  }, [])

  const handleBarPointerDown = useCallback((e: React.PointerEvent, run: PipelineRun, type: 'start' | 'end' | 'move') => {
    if (!dragMode) return
    e.stopPropagation()
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

    const startTs = parseTs(run.startedAt)
    const endTs = run.finishedAt ? parseTs(run.finishedAt) : startTs + Math.max((run.durationSec ?? 30) * 1000, 30 * 60 * 1000)

    setBarDrag({
      runId: run.id,
      type,
      originalStartTs: startTs,
      originalEndTs: endTs,
      pointerStartX: getSvgPoint(e.clientX),
      currentStartTs: startTs,
      currentEndTs: endTs,
    })
    setTooltip(null)
  }, [dragMode, getSvgPoint])

  const handleBarPointerMove = useCallback((e: React.PointerEvent) => {
    if (!barDrag) return
    e.preventDefault()

    const currentX = getSvgPoint(e.clientX)
    const deltaX = currentX - barDrag.pointerStartX
    const deltaTs = (deltaX / CHART_W) * totalSpan

    let newStart = barDrag.originalStartTs
    let newEnd = barDrag.originalEndTs

    if (barDrag.type === 'start') {
      newStart = snapToGrid(barDrag.originalStartTs + deltaTs)
      // Ensure start is before end (min 1 min gap)
      if (newStart >= newEnd - 60 * 1000) newStart = newEnd - 60 * 1000
    } else if (barDrag.type === 'end') {
      newEnd = snapToGrid(barDrag.originalEndTs + deltaTs)
      // Ensure end is after start (min 1 min gap)
      if (newEnd <= newStart + 60 * 1000) newEnd = newStart + 60 * 1000
    } else {
      // move entire bar
      const duration = barDrag.originalEndTs - barDrag.originalStartTs
      newStart = snapToGrid(barDrag.originalStartTs + deltaTs)
      newEnd = newStart + duration
    }

    setBarDrag(prev => prev ? { ...prev, currentStartTs: newStart, currentEndTs: newEnd } : null)

    // Show drag tooltip
    const containerRect = containerRef.current?.getBoundingClientRect()
    if (containerRect) {
      const ttText = barDrag.type === 'start'
        ? `开始: ${fmtDateHourMin(newStart)}`
        : barDrag.type === 'end'
        ? `结束: ${fmtDateHourMin(newEnd)}`
        : `${fmtDateHourMin(newStart)} → ${fmtDateHourMin(newEnd)}`
      setDragTooltip({
        x: e.clientX - containerRect.left,
        y: e.clientY - containerRect.top - 40,
        text: ttText,
      })
    }
  }, [barDrag, CHART_W, totalSpan, getSvgPoint])

  const handleBarPointerUp = useCallback((e: React.PointerEvent) => {
    if (!barDrag) return
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)

    // Apply the change to the runs state
    const { runId, currentStartTs, currentEndTs } = barDrag
    const run = runsState.find(r => r.id === runId)
    if (run) {
      const startChanged = currentStartTs !== parseTs(run.startedAt)
      const endChanged = currentEndTs !== (run.finishedAt ? parseTs(run.finishedAt) : 0)
      if (startChanged || endChanged) {
        setRunsState(prev => prev.map(r => {
          if (r.id !== runId) return r
          const newDuration = Math.round((currentEndTs - currentStartTs) / 1000)
          const fmtTs = (ts: number) => {
            const d = new Date(ts)
            const pad = (n: number) => String(n).padStart(2, '0')
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
          }
          return {
            ...r,
            startedAt: fmtTs(currentStartTs),
            finishedAt: fmtTs(currentEndTs),
            durationSec: newDuration,
          }
        }))
        toast.success(`已调整 ${run.table} 的时间范围`, {
          description: `${fmtDateHourMin(currentStartTs)} → ${fmtDateHourMin(currentEndTs)} (${formatDuration(Math.round((currentEndTs - currentStartTs) / 1000))})`,
          duration: 3000,
        })
      }
    }

    setBarDrag(null)
    setDragTooltip(null)
  }, [barDrag, runsState])

  // Build dependency line data from TABLES dependsOn
  const dependencyLines = useMemo(() => {
    const runMap = new Map<string, { index: number; startTs: number; endTs: number }>()
    runsState.forEach((run, i) => {
      const startTs = parseTs(run.startedAt)
      const endTs = run.finishedAt ? parseTs(run.finishedAt) : startTs + 30 * 60 * 1000
      runMap.set(run.table, { index: i, startTs, endTs })
    })

    const lines: { fromX: number; fromY: number; toX: number; toY: number; key: string }[] = []
    const table = TABLES

    runsState.forEach((run, i) => {
      const tableMeta = table.find(t => t.table === run.table)
      if (!tableMeta) return

      // Draw lines from this run's dependencies TO this run
      for (const dep of tableMeta.dependsOn) {
        const depRun = runMap.get(dep)
        if (depRun && depRun.index !== i) {
          const fromBarEndX = LABEL_W + toX(depRun.endTs)
          const toBarStartX = LABEL_W + toX(parseTs(run.startedAt))
          const fromY = HEADER_H + depRun.index * ROW_H + ROW_H / 2
          const toY = HEADER_H + i * ROW_H + ROW_H / 2
          lines.push({
            fromX: fromBarEndX,
            fromY,
            toX: toBarStartX,
            toY,
            key: `${dep}->${run.table}`,
          })
        }
      }
    })

    return lines
  }, [runsState, toX])

  // Current time indicator (now as a vertical red line)
  const nowTs = Date.now()
  const nowX = toX(nowTs)
  const showNowLine = nowX > 0 && nowX < CHART_W

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-500" />
            执行时序图
          </CardTitle>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="font-mono">
              {fmtTime(minTs + (maxTs - minTs) * 0.05)} → {fmtTime(maxTs - (maxTs - minTs) * 0.05)} · {runsState.length} 次执行
            </span>
            <span className="flex items-center gap-1.5 ml-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> success
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500 ml-1.5" /> failed
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500 ml-1.5" /> running
              <span className="inline-block h-2 w-2 rounded-full bg-zinc-400 ml-1.5" /> skipped
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {/* Time Range Selector + Drag Mode Toggle */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500">开始时间</span>
            <input
              type="time"
              value={startTimeInput}
              onChange={e => handleStartTimeChange(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono"
            />
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-zinc-500">结束时间</span>
            <input
              type="time"
              value={endTimeInput}
              onChange={e => handleEndTimeChange(e.target.value)}
              className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono"
            />
          </div>
          <div className="flex items-center gap-1">
            {(['today', 'yesterday', '3days'] as const).map(preset => (
              <Button
                key={preset}
                size="sm"
                variant="outline"
                className="h-7 text-[11px] px-2"
                onClick={() => handleQuickSelect(preset)}
              >
                {preset === 'today' ? '今天' : preset === 'yesterday' ? '昨天' : '近3天'}
              </Button>
            ))}
          </div>
          {isZoomed && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px] px-2 text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
              onClick={handleResetZoom}
            >
              <ZoomOut className="h-3 w-3 mr-1" /> 重置缩放
            </Button>
          )}

          {/* Drag Mode Toggle */}
          <Button
            size="sm"
            variant={dragMode ? 'default' : 'outline'}
            className={`h-7 text-[11px] px-2.5 ml-auto ${dragMode ? 'bg-fuchsia-600 hover:bg-fuchsia-700 text-white' : ''}`}
            onClick={() => {
              setDragMode(prev => !prev)
              if (!dragMode) {
                toast.info('拖拽模式已开启', { description: '拖拽时间条的两端或中间来调整执行时间，5分钟对齐', duration: 3000 })
              }
            }}
          >
            <Move className="h-3 w-3 mr-1" />
            拖拽模式
          </Button>
        </div>

        {dragMode && (
          <div className="mb-2 px-3 py-1.5 rounded-md bg-fuchsia-50 dark:bg-fuchsia-950/30 border border-fuchsia-200 dark:border-fuchsia-900 text-[11px] text-fuchsia-700 dark:text-fuchsia-300 flex items-center gap-2">
            <GripVertical className="h-3.5 w-3.5" />
            <span>拖拽模式：拖拽条形图 <strong>左端</strong> 调整开始时间，<strong>右端</strong> 调整结束时间，<strong>中间</strong> 整体移动 · 自动对齐 5 分钟</span>
          </div>
        )}

        <div className="overflow-x-auto relative" ref={containerRef} style={{ scrollbarWidth: 'thin' }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full min-w-[700px]"
            style={{ height: Math.max(SVG_H, 100), transition: 'all 0.3s ease' }}
            onMouseDown={!dragMode ? handleMouseDown : undefined}
            onMouseMove={!dragMode ? handleMouseMove : undefined}
            onMouseUp={!dragMode ? handleMouseUp : undefined}
            onPointerMove={dragMode && barDrag ? handleBarPointerMove : undefined}
            onPointerUp={dragMode && barDrag ? handleBarPointerUp : undefined}
          >
            {/* Enhanced Grid lines with solid + dashed pattern */}
            {timeLabels.map((tl, idx) => {
              const x = LABEL_W + toX(tl.ts)
              return (
                <line
                  key={tl.ts}
                  x1={x} y1={HEADER_H}
                  x2={x} y2={SVG_H - 4}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeWidth={idx % 3 === 0 ? 0.8 : 0.4}
                  strokeDasharray={idx % 3 === 0 ? 'none' : '4,4'}
                  style={{ transition: 'x1 0.3s ease, x2 0.3s ease' }}
                />
              )
            })}

            {/* Horizontal row grid lines for better readability */}
            {runsState.map((_run, i) => {
              const y = HEADER_H + i * ROW_H
              return (
                <line
                  key={`hline-${i}`}
                  x1={LABEL_W} y1={y + ROW_H}
                  x2={SVG_W - CHART_RIGHT} y2={y + ROW_H}
                  stroke="currentColor"
                  className="text-zinc-100 dark:text-zinc-800/50"
                  strokeWidth={0.5}
                />
              )
            })}

            {/* Current time indicator (red vertical line) */}
            {showNowLine && (
              <g>
                <line
                  x1={LABEL_W + nowX} y1={HEADER_H - 4}
                  x2={LABEL_W + nowX} y2={SVG_H - 4}
                  stroke="#ef4444"
                  strokeWidth={1.5}
                  strokeDasharray="4,2"
                  opacity={0.8}
                />
                {/* Now label */}
                <rect
                  x={LABEL_W + nowX - 18} y={2}
                  width={36} height={14}
                  rx={3}
                  fill="#ef4444"
                  opacity={0.9}
                />
                <text
                  x={LABEL_W + nowX} y={12}
                  className="fill-white"
                  fontSize={8}
                  fontFamily="monospace"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  NOW
                </text>
              </g>
            )}

            {/* Time axis labels */}
            {timeLabels.map(tl => {
              const x = LABEL_W + toX(tl.ts)
              return (
                <text
                  key={`lbl-${tl.ts}`}
                  x={x} y={14}
                  className="fill-zinc-400"
                  fontSize={10}
                  fontFamily="monospace"
                  textAnchor="middle"
                  style={{ transition: 'x 0.3s ease' }}
                >
                  {tl.label}
                </text>
              )
            })}

            {/* Drag-to-zoom selection overlay (only in zoom mode) */}
            {!dragMode && zoomDragState && dragCurrentX !== null && (
              <rect
                x={LABEL_W + Math.min(zoomDragState.startX, dragCurrentX)}
                y={HEADER_H}
                width={Math.abs(dragCurrentX - zoomDragState.startX)}
                height={SVG_H - HEADER_H - 4}
                fill="oklch(0.65 0.2 250 / 0.15)"
                stroke="oklch(0.65 0.2 250 / 0.5)"
                strokeWidth={1}
                rx={2}
                className="pointer-events-none"
              />
            )}

            {/* Time axis area indicator (clickable region for drag-to-zoom) */}
            {!dragMode && (
              <rect
                x={LABEL_W} y={0}
                width={CHART_W} height={HEADER_H}
                fill="transparent"
                className="cursor-crosshair"
              />
            )}

            {/* Dependency lines with arrows */}
            {dependencyLines.map(line => (
              <g key={line.key}>
                <line
                  x1={line.fromX} y1={line.fromY}
                  x2={line.toX} y2={line.toY}
                  stroke="#d946ef"
                  strokeWidth={1.5}
                  strokeDasharray="6,3"
                  opacity={0.5}
                  className="dark:opacity-40"
                />
                {/* Arrow at the end */}
                <circle
                  cx={line.toX} cy={line.toY}
                  r={3}
                  fill="#d946ef"
                  opacity={0.6}
                />
              </g>
            ))}

            {/* Rows */}
            {runsState.map((run, i) => {
              // Use barDrag state for current run if dragging
              const isDraggingThis = barDrag?.runId === run.id
              const defaultStartTs = parseTs(run.startedAt)
              const defaultEndTs = run.finishedAt
                ? parseTs(run.finishedAt)
                : defaultStartTs + Math.max((run.durationSec ?? 30) * 1000, 30 * 60 * 1000)

              const startTs = isDraggingThis ? barDrag.currentStartTs : defaultStartTs
              const endTs = isDraggingThis ? barDrag.currentEndTs : defaultEndTs

              const barX = LABEL_W + toX(startTs)
              const rawBarW = ((endTs - startTs) / totalSpan) * CHART_W
              const barW = Math.max(rawBarW, CHART_W * 0.02) // min 2% for visibility
              const barY = HEADER_H + i * ROW_H + BAR_Y_OFFSET
              const isRunning = run.status === 'running'
              const isFailed = run.status === 'failed'
              const colors = STATUS_BAR_COLOR[run.status] || STATUS_BAR_COLOR.pending
              const isHovered = hoveredId === run.id
              const durLabel = run.durationSec !== null ? formatDuration(isDraggingThis ? Math.round((endTs - startTs) / 1000) : run.durationSec) : '…'
              const showLabelInside = barW > 80

              return (
                <g
                  key={run.id}
                  onMouseEnter={() => !dragMode && setHoveredId(run.id)}
                  onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                  onMouseMove={!dragMode ? (e) => {
                    const rect = (e.currentTarget as SVGGElement).closest('svg')?.getBoundingClientRect()
                    if (rect) {
                      setTooltip({
                        run,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      })
                    }
                  } : undefined}
                  onClick={() => !dragMode && handleBarClick(run)}
                  className={!dragMode ? 'cursor-pointer' : ''}
                >
                  {/* Row background on hover */}
                  {isHovered && !dragMode && (
                    <rect
                      x={0} y={HEADER_H + i * ROW_H}
                      width={SVG_W} height={ROW_H}
                      className="fill-sky-50 dark:fill-sky-950/30"
                      rx={2}
                    />
                  )}

                  {/* Table name label */}
                  <text
                    x={LABEL_W - 8} y={HEADER_H + i * ROW_H + ROW_H / 2 + 1}
                    className="fill-zinc-500 dark:fill-zinc-400"
                    fontSize={10}
                    fontFamily="monospace"
                    textAnchor="end"
                    dominantBaseline="middle"
                  >
                    {run.table.length > 18 ? run.table.slice(0, 17) + '…' : run.table}
                  </text>

                  {/* Bar shadow on hover */}
                  {isHovered && !dragMode && (
                    <rect
                      x={barX + 1} y={barY + 1}
                      width={barW} height={BAR_H}
                      className="fill-black/10 dark:fill-black/30"
                      rx={5}
                    />
                  )}

                  {/* Bar — colored by status */}
                  <rect
                    x={barX} y={barY}
                    width={barW} height={BAR_H}
                    fill={isRunning ? 'url(#runningGrad)' : colors.fill}
                    stroke={isDraggingThis ? '#d946ef' : colors.stroke}
                    strokeWidth={isDraggingThis ? 2.5 : isHovered ? 1.5 : 0.5}
                    rx={4}
                    opacity={isHovered || isDraggingThis ? 1 : 0.9}
                    style={{
                      filter: isHovered ? 'brightness(1.15)' : isDraggingThis ? 'brightness(1.2)' : undefined,
                      transition: isDraggingThis ? 'none' : 'filter 0.15s, x 0.3s ease, width 0.3s ease',
                    }}
                  />

                  {/* Drag handles (visible in drag mode) */}
                  {dragMode && (
                    <>
                      {/* Left handle (start) */}
                      <rect
                        x={barX - 2} y={barY - 2}
                        width={8} height={BAR_H + 4}
                        fill="#d946ef"
                        rx={2}
                        opacity={0.7}
                        className="cursor-ew-resize"
                        onPointerDown={(e) => handleBarPointerDown(e, run, 'start')}
                      />
                      {/* Right handle (end) */}
                      <rect
                        x={barX + barW - 6} y={barY - 2}
                        width={8} height={BAR_H + 4}
                        fill="#d946ef"
                        rx={2}
                        opacity={0.7}
                        className="cursor-ew-resize"
                        onPointerDown={(e) => handleBarPointerDown(e, run, 'end')}
                      />
                      {/* Middle body (move entire bar) */}
                      <rect
                        x={barX + 8} y={barY}
                        width={Math.max(barW - 16, 1)} height={BAR_H}
                        fill="transparent"
                        className="cursor-move"
                        onPointerDown={(e) => handleBarPointerDown(e, run, 'move')}
                      />
                    </>
                  )}

                  {/* Running pulse overlay */}
                  {isRunning && (
                    <rect
                      x={barX} y={barY}
                      width={barW} height={BAR_H}
                      fill="url(#runningPulse)"
                      rx={4}
                      opacity={0.5}
                    >
                      <animate attributeName="opacity" values="0.3;0.7;0.3" dur="1.5s" repeatCount="indefinite" />
                    </rect>
                  )}

                  {/* Failed dot indicator */}
                  {isFailed && (
                    <circle
                      cx={barX + barW - 6} cy={barY + BAR_H / 2}
                      r={3}
                      fill="#fff"
                      opacity={0.9}
                    />
                  )}

                  {/* Table name inside bar (if wide enough) */}
                  {showLabelInside && (
                    <text
                      x={barX + 8} y={barY + BAR_H / 2 + 1}
                      className="fill-white"
                      fontSize={9}
                      fontFamily="monospace"
                      dominantBaseline="middle"
                      style={{ pointerEvents: 'none' }}
                    >
                      {run.table.length > 14 ? run.table.slice(0, 13) + '…' : run.table}
                    </text>
                  )}

                  {/* Duration label at end of bar */}
                  <text
                    x={barX + barW + 4} y={barY + BAR_H / 2 + 1}
                    className="fill-zinc-500 dark:fill-zinc-400"
                    fontSize={9}
                    fontFamily="monospace"
                    dominantBaseline="middle"
                  >
                    {durLabel}
                  </text>
                </g>
              )
            })}

            {/* Gradient definitions */}
            <defs>
              <linearGradient id="runningGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#f59e0b" />
                <stop offset="100%" stopColor="#d97706" />
              </linearGradient>
              <linearGradient id="runningPulse" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fbbf24" stopOpacity={0.8} />
                <stop offset="50%" stopColor="#f59e0b" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#d97706" stopOpacity={0.8} />
                <animate attributeName="x1" values="0%;100%;0%" dur="2s" repeatCount="indefinite" />
              </linearGradient>
            </defs>
          </svg>

          {/* Enhanced Tooltip on hover showing task details */}
          {tooltip && !dragMode && (
            <div
              className="absolute z-50 pointer-events-none rounded-lg border bg-card p-3 shadow-lg text-[11px] max-w-[280px]"
              style={{ left: Math.min(tooltip.x + 12, 600), top: tooltip.y + 12 }}
            >
              <div className="font-medium font-mono text-xs mb-1.5">{tooltip.run.table}</div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusPillClass(tooltip.run.status)}`}>
                  {statusIcon(tooltip.run.status)}
                  {tooltip.run.status}
                </span>
              </div>
              <div className="text-zinc-500 font-mono space-y-0.5">
                <div>开始: {fmtDateHourMin(parseTs(tooltip.run.startedAt))}</div>
                <div>结束: {tooltip.run.finishedAt ? fmtDateHourMin(parseTs(tooltip.run.finishedAt)) : '运行中…'}</div>
                <div className="flex items-center gap-1">耗时: <Timer className="h-3 w-3" />{tooltip.run.durationSec !== null ? humanDuration(tooltip.run.durationSec) : '运行中'}</div>
                {tooltip.run.rowsIn !== null && <div>行数: {formatRows(tooltip.run.rowsIn)}</div>}
              </div>
              {tooltip.run.error && <div className="text-rose-500 mt-1.5 pt-1 border-t border-rose-200 dark:border-rose-800">⚠ {tooltip.run.error}</div>}
              {isZoomed && (
                <div className="mt-1.5 pt-1 border-t text-[10px] text-zinc-400">
                  缩放范围: {fmtTime(rangeStart)} → {fmtTime(rangeEnd)}
                </div>
              )}
            </div>
          )}

          {/* Drag tooltip (shows new time while dragging) */}
          {dragTooltip && dragMode && (
            <div
              className="absolute z-50 pointer-events-none rounded-md bg-fuchsia-600 text-white px-2.5 py-1.5 shadow-lg text-xs font-mono whitespace-nowrap"
              style={{ left: dragTooltip.x, top: dragTooltip.y, transform: 'translateX(-50%)' }}
            >
              {dragTooltip.text}
            </div>
          )}
        </div>

        {/* Dependency lines legend */}
        <div className="mt-2 flex items-center gap-4 text-[10px] text-zinc-500 flex-wrap">
          {dependencyLines.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-5 h-0 border-t-2 border-dashed border-fuchsia-400" />
              依赖关系线
            </span>
          )}
          {showNowLine && (
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0 border-t-2 border-dashed border-rose-500" />
              当前时间
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-2 bg-fuchsia-500 rounded-sm opacity-70" />
            拖拽手柄
          </span>
          {!dragMode && (
            <span className="ml-auto flex items-center gap-1">
              <ZoomIn className="h-3 w-3" /> 拖拽时间轴区域可缩放
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function HistoryView({ onRunTable, onOpenDetail, logStreamer }: { onRunTable?: (t: string) => void; onOpenDetail: (r: PipelineRun) => void; logStreamer: ReturnType<typeof useLogStreamer> }) {
  const [dailyLoading, setDailyLoading] = useState(false)

  // Last execution time
  const lastExecTime = useMemo(() => {
    const sorted = [...PIPELINE_RUNS].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return sorted[0]?.startedAt ?? '—'
  }, [])

  // Batch trigger handlers
  const handleBatchTrigger = (type: string) => {
    const targets = type === 'all'
      ? PIPELINE_RUNS.filter(r => r.status === 'failed').map(r => r.table)
      : PIPELINE_RUNS.filter(r => r.trigger === type).map(r => r.table)
    if (targets.length === 0) {
      toast.info('没有匹配的执行记录')
      return
    }
    toast.success(`批量触发 ${targets.length} 个任务`, { description: targets.slice(0, 5).join(', ') + (targets.length > 5 ? '...' : '') })
    targets.forEach(t => onRunTable?.(t))
  }

  const handleDailyExecute = () => {
    setDailyLoading(true)
    // Check if today is a trading day
    if (!isTradingDay()) {
      toast.warning('当前为非交易日，确认执行？', {
        description: `最近交易日: ${getLastTradingDay()} · 点击确认将继续执行`,
        duration: 5000,
        action: {
          label: '确认执行',
          onClick: () => {
            toast.success('已触发 daily 全量执行（非交易日）')
          },
        },
      })
    } else {
      toast.success('已触发 daily 全量执行')
    }
    // 启动 WS 实时日志流
    logStreamer.startExecution('daily')
    setTimeout(() => setDailyLoading(false), 3000)
  }

  return (
    <div className="space-y-4">
      <GanttTimeline onOpenDetail={onOpenDetail} />

      {/* Trigger Actions Bar */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Batch trigger dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 text-xs gap-1.5">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                  批量触发
                  <ChevronDown className="h-3 w-3 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>选择触发类型</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBatchTrigger('all')}>
                  <XCircle className="h-3.5 w-3.5 mr-2 text-rose-500" />
                  重跑失败任务
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchTrigger('schedule')}>
                  <Clock className="h-3.5 w-3.5 mr-2 text-zinc-500" />
                  重跑调度任务
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleBatchTrigger('manual')}>
                  <Play className="h-3.5 w-3.5 mr-2 text-sky-500" />
                  重跑手动触发
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleBatchTrigger('all')}>
                  <Zap className="h-3.5 w-3.5 mr-2 text-amber-500" />
                  全部重跑
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Execute daily button with loading state */}
            <Button
              size="sm"
              className={`h-9 text-xs gap-1.5 text-white ${isTradingDay() ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-500 hover:bg-amber-600'}`}
              onClick={handleDailyExecute}
              disabled={dailyLoading}
            >
              {dailyLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              {dailyLoading ? '执行中...' : '执行 daily'}
              {!isTradingDay() && <AlertTriangle className="h-3 w-3 ml-0.5" />}
            </Button>

            {/* Last execution time */}
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 ml-2">
              <Clock className="h-3 w-3" />
              <span>上次执行: </span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300">{lastExecTime.slice(5)}</span>
            </div>

            <div className="flex-1" />

            <Badge variant="secondary" className="text-[10px]">
              {PIPELINE_RUNS.length} 条记录
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Execution History Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Play className="h-4 w-4 text-sky-500" />
            执行历史 (pipeline_runs)
            <Badge variant="secondary" className="ml-2 text-[10px]">{PIPELINE_RUNS.length} 条记录</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-520px)]">
            <div className="min-w-[1000px]">
              <div className="grid grid-cols-[50px_1fr_90px_100px_140px_80px_90px_1fr_30px] gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                <div>#</div>
                <div>表名</div>
                <div>触发</div>
                <div>状态</div>
                <div>开始</div>
                <div className="text-right">耗时</div>
                <div className="text-right">行数</div>
                <div>错误</div>
                <div></div>
              </div>
              {PIPELINE_RUNS.map((r, idx) => (
                <button
                  key={r.id}
                  onClick={() => onOpenDetail(r)}
                  className={`w-full grid grid-cols-[50px_1fr_90px_100px_140px_80px_90px_1fr_30px] gap-2 px-3 py-2 text-xs items-center border-b last:border-0 text-left transition-colors group ${
                    idx % 2 === 0
                      ? 'bg-white dark:bg-zinc-950/20'
                      : 'bg-zinc-50/50 dark:bg-zinc-900/20'
                  } hover:bg-sky-50/70 dark:hover:bg-sky-950/30 hover:shadow-sm`}
                >
                  <div className="font-mono text-zinc-400">{r.id}</div>
                  <div className="font-mono truncate flex items-center gap-1.5" title={r.table}>
                    {r.table}
                    {/* Trading day badge: check if the run date is a trading day */}
                    {(() => {
                      const runDate = r.startedAt.slice(0, 10)
                      const runDay = new Date(runDate).getDay()
                      const isRunTradingDay = runDay >= 1 && runDay <= 5
                      return (
                        <span className={`inline-flex items-center gap-0.5 px-1 py-0 rounded text-[8px] font-medium flex-shrink-0 ${
                          isRunTradingDay
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-500'
                        }`}>
                          <span className={`h-1 w-1 rounded-full ${isRunTradingDay ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
                          {isRunTradingDay ? 'T' : '休'}
                        </span>
                      )
                    })()}
                  </div>
                  <div><Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${triggerClass(r.trigger)}`}>{r.trigger}</Badge></div>
                  <div>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${statusPillClass(r.status)}`}>
                      {statusIcon(r.status)}
                      {r.status}
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500">{r.startedAt.slice(5)}</div>
                  <div className="text-right">
                    {/* Progress bar for running executions */}
                    {r.status === 'running' ? (
                      <div className="flex items-center gap-1.5">
                        <Progress value={65} className="h-1.5 flex-1" />
                        <span className="font-mono text-zinc-500 text-[10px]">65%</span>
                      </div>
                    ) : (
                      <span className="font-mono text-zinc-500 flex items-center justify-end gap-1">
                        <Timer className="h-3 w-3 text-zinc-400" />
                        {humanDuration(r.durationSec)}
                      </span>
                    )}
                  </div>
                  <div className="text-right font-mono text-zinc-500">{r.rowsIn ? formatRows(r.rowsIn) : '—'}</div>
                  <div className="text-[11px] text-rose-600 truncate" title={r.error || ''}>{r.error || '—'}</div>
                  <div className="text-zinc-300 group-hover:text-sky-500 transition-colors">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

function DagView() {
  // 改进的 DAG：显示节点 + 连线 + 健康度 + 详情
  const [hovered, setHovered] = useState<string | null>(null)
  const [allExpanded, setAllExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const layers: { name: string; desc: string; tables: string[] }[] = [
    { name: '外部数据源', desc: 'TQ API / TDX 二进制 / 文本', tables: ['TQ API', 'TDX .day', 'TDX .lc5', 'TDX .lc1', 'TDX gpsz', 'TDX signals'] },
    { name: 'L1 基础入库', desc: '17 个采集脚本，外部源 → DuckDB', tables: ['trading_calendar', 'stock_daily_kline', 'stock_kline_5m', 'stock_kline_1m', 'capital_info', 'stock_financial_data', 'sjb_api_plhqL2kz_88zd', 'stock_block_relation', 'market_sc1_42', 'stock_gp1_46_indicators', 'stock_signals_20001_20011', 'stock_industry_3level'] },
    { name: 'L2 派生计算', desc: '9 个 SQL 派生脚本', tables: ['stock_kline_15m', 'stock_kline_30m', 'stock_kline_60m', 'stock_kline_weekly', 'stock_kline_monthly', 'stock_daily_turnover', 'dim_security_type', 'dim_industry_code', 'pianpao_daily'] },
    { name: 'L3 聚合视图', desc: '多表产物 / 汇总', tables: ['pianpao_daily_summary', 'dim_gp_indicator'] },
  ]
  const healthOf = (name: string) => TABLES.find(t => t.table === name)?.health || 'external'

  // Total node count
  const totalNodes = layers.reduce((acc, l) => acc + l.tables.length, 0)

  // Health indicator for node
  const healthIndicator = (health: string) => {
    switch (health) {
      case 'green': return { dot: 'bg-emerald-500', ring: 'ring-emerald-300' }
      case 'yellow': return { dot: 'bg-amber-500', ring: 'ring-amber-300' }
      case 'red': return { dot: 'bg-rose-500 animate-pulse', ring: 'ring-rose-300' }
      case 'white': return { dot: 'bg-zinc-300', ring: 'ring-zinc-200' }
      default: return { dot: 'bg-sky-500', ring: 'ring-sky-300' } // external
    }
  }

  const handleFitToView = () => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <Card ref={containerRef}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-fuchsia-500" />
            DAG 依赖图（拓扑分层 · 可悬停查看）
            <Badge variant="secondary" className="ml-2 text-[10px]">{totalNodes} 节点</Badge>
          </CardTitle>
          <div className="flex items-center gap-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={handleFitToView}>
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>适配视图</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 w-7 p-0" onClick={() => setAllExpanded(v => !v)}>
                    {allExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{allExpanded ? '折叠' : '展开'}全部</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {layers.map((layer, i) => (
            <div key={layer.name}>
              <div className="flex items-stretch gap-3 py-2">
                <div className="w-32 flex-shrink-0 flex flex-col justify-center">
                  <div className="text-[10px] text-zinc-400 font-mono">LAYER {i}</div>
                  <div className="text-xs font-medium leading-tight">{layer.name}</div>
                  <div className="text-[10px] text-zinc-400 leading-tight mt-0.5">{layer.desc}</div>
                  <Badge variant="outline" className="text-[10px] mt-1 w-fit px-1.5 py-0 h-4">{layer.tables.length} 节点</Badge>
                </div>
                <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                  {layer.tables.map(t => {
                    const h = healthOf(t)
                    const isExternal = h === 'external'
                    const isHovered = hovered === t
                    const healthInd = healthIndicator(h)
                    return (
                      <div
                        key={t}
                        onMouseEnter={() => setHovered(t)}
                        onMouseLeave={() => setHovered(null)}
                        className={`relative px-2.5 py-1.5 rounded-md border text-xs font-mono cursor-default transition-all ${
                          h === 'green' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' :
                          h === 'red' ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 text-rose-700 dark:text-rose-300' :
                          h === 'white' ? 'border-zinc-200 bg-zinc-50 dark:bg-zinc-800/50 dark:border-zinc-700 text-zinc-500' :
                          isExternal ? 'border-dashed border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 text-sky-700 dark:text-sky-300' :
                          'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                        } ${isHovered ? 'scale-105 shadow-md ring-2 ring-offset-1 ring-zinc-300 dark:ring-zinc-600' : ''}`}
                        title={isExternal ? `外部源: ${t}` : `${t} (${TABLES.find(x => x.table === t)?.cn || ''})`}
                      >
                        {/* Health indicator dot */}
                        <span className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-1 ${healthInd.dot} ${isHovered ? healthInd.ring : 'ring-white dark:ring-zinc-900'}`} />
                        {t}
                        {h === 'red' && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />}
                      </div>
                    )
                  })}
                </div>
              </div>
              {/* Edge arrows between layers */}
              {i < layers.length - 1 && (
                <div className="ml-32 flex items-center gap-2 text-zinc-300 dark:text-zinc-700 py-1">
                  <div className="flex items-center">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <div key={j} className="h-4 w-px bg-current ml-3 first:ml-2" />
                    ))}
                  </div>
                  <ArrowRight className="h-3 w-3" />
                  <ArrowDown className="h-3 w-3" />
                  <div className="text-[10px] text-zinc-400">数据流向下游</div>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 pt-3 border-t flex items-center gap-4 text-[11px] text-zinc-500 flex-wrap">
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-emerald-300 bg-emerald-50" /> 正常 (green)</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-rose-300 bg-rose-50" /> 异常 (red)</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-amber-300 bg-amber-50" /> 警告 (yellow)</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-zinc-300 bg-zinc-50" /> once/不适用</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-dashed border-sky-300 bg-sky-50" /> 外部数据源</span>
          <span className="ml-auto text-zinc-400">悬停节点查看详情 · 拓扑排序自动决定执行顺序</span>
        </div>
      </CardContent>
    </Card>
  )
}

function SchedulesView({ wsConnected }: { wsConnected: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-fuchsia-500" />
            调度计划 (schedules.yaml)
          </CardTitle>
          {/* 连接状态指示器 */}
          <div className="flex items-center gap-1.5 text-xs">
            {wsConnected ? (
              <>
                <Wifi className="h-3.5 w-3.5 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">WS 已连接</span>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              </>
            ) : (
              <>
                <WifiOff className="h-3.5 w-3.5 text-rose-400" />
                <span className="text-rose-500 dark:text-rose-400 font-medium">WS 断线</span>
                <span className="h-2 w-2 rounded-full bg-rose-500" />
              </>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-hidden">
          <div className="grid grid-cols-[140px_140px_80px_160px_100px_80px] gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50">
            <div>名称</div><div>cron</div><div>层</div><div>下次执行</div><div>上次</div><div className="text-center">表数</div>
          </div>
          {SCHEDULES.map(s => (
            <div key={s.name} className="grid grid-cols-[140px_140px_80px_160px_100px_80px] gap-2 px-3 py-2.5 text-xs items-center border-t hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
              <div className="font-mono font-medium">{s.name}</div>
              <div className="font-mono text-zinc-500">{s.cron}</div>
              <div><Badge variant="outline" className="text-[10px]">{s.tier}</Badge></div>
              <div className="font-mono text-zinc-600 dark:text-zinc-400">{s.nextRun}</div>
              <div className="flex items-center gap-1">
                {s.lastStatus === 'success' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                {s.lastStatus === 'failed' && <XCircle className="h-3.5 w-3.5 text-rose-500" />}
                {!s.lastStatus && <Clock className="h-3.5 w-3.5 text-zinc-400" />}
                <span className="text-[11px] text-zinc-500">{s.lastStatus || '—'}</span>
              </div>
              <div className="text-center font-mono">{s.tables}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-500">
          <strong className="text-zinc-700 dark:text-zinc-300">说明：</strong>调度器读取 <code className="font-mono text-sky-600">config/registry/schedules.yaml</code>，按拓扑排序执行同层表。
          支持 cron / systemd timer / 手动 <code className="font-mono text-sky-600">python run.py all</code> 三种触发方式。
        </div>
      </CardContent>
    </Card>
  )
}

// ─── 日志级别颜色映射 ───
function logLevelColor(level: LogLevel): string {
  switch (level) {
    case 'INFO': return 'text-sky-600 dark:text-sky-400'
    case 'WARNING': return 'text-amber-600 dark:text-amber-400'
    case 'ERROR': return 'text-rose-600 dark:text-rose-400'
    case 'SUCCESS': return 'text-emerald-600 dark:text-emerald-400'
    case 'DEBUG': return 'text-zinc-400 dark:text-zinc-500'
    default: return 'text-zinc-500'
  }
}

function logLevelBg(level: LogLevel): string {
  switch (level) {
    case 'ERROR': return 'bg-rose-50 dark:bg-rose-950/20'
    case 'WARNING': return 'bg-amber-50 dark:bg-amber-950/20'
    default: return ''
  }
}

// ─── 实时日志流面板 ───
function LogStreamPanel({
  connected,
  logs,
  progress,
  startExecution,
  cancelExecution,
  clearLogs,
}: ReturnType<typeof useLogStreamer>) {
  const logEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs.length, autoScroll])

  const isRunning = progress.status === 'running'
  const isCompleted = progress.status === 'completed'
  const isCancelled = progress.status === 'cancelled'

  return (
    <div className="space-y-4">
      {/* 连接状态 + 控制栏 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* 连接状态 */}
            <div className="flex items-center gap-2">
              {connected ? (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">WebSocket 已连接</span>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  <WifiOff className="h-3.5 w-3.5 text-rose-500" />
                  <span className="text-xs font-medium text-rose-600 dark:text-rose-400">WS 断线 · 客户端模拟</span>
                </div>
              )}
            </div>

            <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-700" />

            {/* 执行按钮 */}
            {!isRunning ? (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => startExecution('daily')}
              >
                <Zap className="h-3.5 w-3.5" />
                执行 daily 全量
              </Button>
            ) : (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 text-xs gap-1.5"
                onClick={cancelExecution}
              >
                <XCircle className="h-3.5 w-3.5" />
                取消执行
              </Button>
            )}

            {logs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={clearLogs}
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空日志
              </Button>
            )}

            <div className="flex-1" />

            {/* 日志统计 */}
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <Badge variant="secondary" className="text-[10px]">
                {logs.length} 行日志
              </Badge>
              {isRunning && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  运行中
                </Badge>
              )}
              {isCompleted && (
                <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  已完成
                </Badge>
              )}
              {isCancelled && (
                <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300">
                  <XCircle className="h-3 w-3 mr-1" />
                  已取消
                </Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 实时进度条 */}
      {(isRunning || isCompleted || isCancelled) && (
        <Card>
          <CardContent className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {isRunning ? `正在执行: ${progress.currentTable}` :
                   isCompleted ? '执行完成' :
                   isCancelled ? '执行已取消' : ''}
                </span>
                <span className="font-mono text-zinc-500">
                  {progress.tablesCompleted}/{progress.tablesTotal} 表 · {progress.percent}%
                </span>
              </div>
              <Progress
                value={progress.percent}
                className={`h-2.5 ${isCompleted ? '[&>div]:bg-emerald-500' : isCancelled ? '[&>div]:bg-rose-400' : '[&>div]:bg-amber-500'}`}
              />
              {progress.startedAt && (
                <div className="flex items-center gap-3 text-[10px] text-zinc-400">
                  <span>开始: {progress.startedAt}</span>
                  {progress.finishedAt && <span>结束: {progress.finishedAt}</span>}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 日志流显示 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Terminal className="h-4 w-4 text-zinc-500" />
              日志流
            </CardTitle>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[11px] text-zinc-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="rounded border-zinc-300"
                />
                自动滚动
              </label>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative">
            <ScrollArea className="h-[calc(100vh-420px)]">
              <div className="font-mono text-xs p-3 space-y-0">
                {logs.length === 0 && (
                  <div className="text-center py-12 text-zinc-400">
                    <Terminal className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">暂无日志</p>
                    <p className="text-[11px] mt-1">点击「执行 daily 全量」开始实时日志流</p>
                  </div>
                )}
                {logs.map((line, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-2 py-0.5 px-1 rounded ${logLevelBg(line.level)} hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors`}
                  >
                    <span className="text-zinc-400 dark:text-zinc-600 flex-shrink-0 w-[78px] text-right select-none">
                      {line.timestamp.slice(11)}
                    </span>
                    <span className={`flex-shrink-0 w-[60px] text-right font-semibold ${logLevelColor(line.level)}`}>
                      [{line.level}]
                    </span>
                    {line.table && (
                      <span className="flex-shrink-0 text-sky-600 dark:text-sky-400 w-[130px] truncate" title={line.table}>
                        {line.table}
                      </span>
                    )}
                    <span className={`${logLevelColor(line.level)} flex-1`}>
                      {line.message}
                    </span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
