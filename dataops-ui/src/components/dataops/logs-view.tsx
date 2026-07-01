'use client'
import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Search, FileText, Radio, Pause, Play, Trash2, Activity, Loader2, CheckCircle2, XCircle, Zap, Wifi, WifiOff, Download, ArrowDownToLine, ChevronDown, ChevronRight, ChevronUp, Filter, Copy, Layers, ArrowUp, Clock, AlertTriangle, Bug, Info, ArrowDown, RefreshCw } from 'lucide-react'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import type { LogLine } from '@/hooks/use-log-streamer'
import { TABLES as TABLES_META } from '@/lib/dataops/mock-data'
import { toast } from 'sonner'

// ── Constants ──────────────────────────────────────────────────
const ROW_HEIGHT = 28
const GROUP_HEADER_HEIGHT = 40
const BUFFER_COUNT = 8
const SCROLL_THRESHOLD = 150 // px from bottom to show scroll-to-bottom button

// ── Types ──────────────────────────────────────────────────────
type LogLevel = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS' | 'DEBUG'

interface LogItem {
  id: string
  ts: string
  level: LogLevel
  table: string
  message: string
  file?: string
  runId: string
  isLive?: boolean
}

// Real log line shape from GET /api/dataops?op=logs
interface RawLogLine {
  ts: string | null
  level: string
  message: string
  file: string
}

interface LogGroup {
  runId: string
  logs: LogItem[]
  firstTs: string
  lastTs: string
  hasError: boolean
  hasWarning: boolean
}

interface VirtualItem {
  type: 'log' | 'group-header'
  key: string
  height: number
  top: number
  log?: LogItem
  logIndex?: number
  group?: LogGroup
}

// ── Main Component ─────────────────────────────────────────────
export function LogsView() {
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string>('all')
  const [table, setTable] = useState<string>('all')
  const [liveMode, setLiveMode] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const [groupByRun, setGroupByRun] = useState(false)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [hoveredLogId, setHoveredLogId] = useState<string | null>(null)

  // Virtual scroll state
  const [scrollTop, setScrollTop] = useState(0)
  const [renderedCount, setRenderedCount] = useState(0)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [isNearTop, setIsNearTop] = useState(true)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const containerHeightRef = useRef(0)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Real log lines from /api/dataops?op=logs
  const [realLines, setRealLines] = useState<RawLogLine[]>([])
  const [fileCount, setFileCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [logsLoading, setLogsLoading] = useState(true)
  const [logsError, setLogsError] = useState<string | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null)

  const streamer = useLogStreamer()
  const dailyScripts = useMemo(() => TABLES_META.filter(t => t.schedule === 'daily').map((t, i) => ({
    idx: i, table: t.table, cn: t.cn,
  })), [])

  // ── Load real log lines from backend ──────────────────────────
  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    setLogsError(null)
    try {
      const resp = await fetch('/api/dataops?op=logs', { cache: 'no-store' })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data = await resp.json()
      const lines: RawLogLine[] = Array.isArray(data?.lines) ? data.lines : []
      setRealLines(lines)
      setFileCount(typeof data?.fileCount === 'number' ? data.fileCount : 0)
      setTruncated(Boolean(data?.truncated))
      setLastFetchedAt(new Date())
    } catch (e) {
      setLogsError(e instanceof Error ? e.message : String(e))
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => { loadLogs() }, [loadLogs])
  const tables = useMemo(() => [...new Set(realLines.map(l => l.file).filter(Boolean))].sort(), [realLines])

  // ── Normalize real backend lines into LogItem[] with run_ids ──
  const staticLogsWithRunId = useMemo<LogItem[]>(() => {
    if (realLines.length === 0) return []

    // Normalize level to a known value; backend may emit INFO/WARNING/ERROR/SUCCESS/DEBUG/etc.
    const normLevel = (raw: string): LogLevel => {
      const u = (raw || '').toUpperCase()
      if (u === 'ERROR') return 'ERROR'
      if (u === 'WARNING' || u === 'WARN') return 'WARNING'
      if (u === 'SUCCESS') return 'SUCCESS'
      if (u === 'DEBUG') return 'DEBUG'
      return 'INFO'
    }
    const safeTs = (s: string | null): string => s ?? ''

    // Backend returns newest-first; reverse to ascending for run grouping.
    const sorted = realLines.map((l, i) => ({
      ...l,
      id: `real-${i}-${l.ts ?? 'nts'}-${l.file ?? 'nf'}`,
      ts: safeTs(l.ts),
      level: normLevel(l.level),
      table: l.file ?? '',
      message: l.message ?? '',
      file: l.file ?? '',
      isLive: false,
    })).reverse()
    // Stable ascending sort by ts (null/empty ts sink to the top of the ascending list)
    sorted.sort((a, b) => {
      if (!a.ts && !b.ts) return 0
      if (!a.ts) return -1
      if (!b.ts) return 1
      return a.ts.localeCompare(b.ts)
    })

    // Assign run_ids: same date prefix + same file + no time gap > 10min = same group
    let runCounter = 0
    let prevFile = ''
    let prevTs = ''
    let currentRunId = ''

    return sorted.map(l => {
      const datePrefix = (l.ts || '').slice(0, 10).replace(/-/g, '') || 'nodate'
      const timeGap = prevTs
        ? (new Date(l.ts).getTime() - new Date(prevTs).getTime()) / 60000
        : Infinity
      const gapUsable = !isNaN(timeGap)

      // New group if: different file, or gap > 10 minutes within same file
      if (l.file !== prevFile || (gapUsable && timeGap > 10)) {
        runCounter++
        currentRunId = `run-${datePrefix}-${String(runCounter).padStart(3, '0')}`
      }
      prevFile = l.file
      prevTs = l.ts

      return { ...l, runId: currentRunId } as LogItem
    })
  }, [realLines])

  // ── Merge static + live logs ─────────────────────────────────
  const allLogs = useMemo(() => {
    const live: LogItem[] = streamer.logs.map((l, i) => ({
      id: `live-${i}-${l.timestamp}-${l.table}`,
      ts: l.timestamp,
      level: (l.level === 'SUCCESS' ? 'INFO' : l.level) as LogLevel,
      table: l.table ?? '',
      message: l.message,
      runId: 'live',
      isLive: true,
    }))
    return liveMode ? [...live, ...staticLogsWithRunId] : staticLogsWithRunId
  }, [streamer.logs, liveMode, staticLogsWithRunId])

  // ── Filter ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return allLogs.filter(l => {
      if (level !== 'all' && l.level !== level) return false
      if (table !== 'all' && l.table !== table) return false
      if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.table.includes(search)) return false
      return true
    })
  }, [allLogs, search, level, table])

  // ── Level stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const s: Record<LogLevel, number> = { ERROR: 0, WARNING: 0, INFO: 0, SUCCESS: 0, DEBUG: 0 }
    allLogs.forEach(l => {
      if (l.level in s) s[l.level]++
    })
    return s
  }, [allLogs])

  // ── Group logs by runId ──────────────────────────────────────
  const groups = useMemo(() => {
    if (!groupByRun) return [] as LogGroup[]
    const map = new Map<string, LogItem[]>()
    filtered.forEach(l => {
      const key = l.runId || 'unknown'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(l)
    })
    const result: LogGroup[] = []
    map.forEach((logs, runId) => {
      const sorted = [...logs].sort((a, b) => a.ts.localeCompare(b.ts))
      result.push({
        runId,
        logs: sorted,
        firstTs: sorted[0]?.ts ?? '',
        lastTs: sorted[sorted.length - 1]?.ts ?? '',
        hasError: sorted.some(l => l.level === 'ERROR'),
        hasWarning: sorted.some(l => l.level === 'WARNING'),
      })
    })
    // Sort groups by first timestamp
    result.sort((a, b) => a.firstTs.localeCompare(b.firstTs))
    return result
  }, [groupByRun, filtered])

  const groupCount = groups.length

  // ── Auto-collapse clean groups on first enable ───────────────
  useEffect(() => {
    if (groupByRun && groups.length > 0) {
      const toCollapse = new Set<string>()
      groups.forEach(g => {
        if (!g.hasError && !g.hasWarning) {
          toCollapse.add(g.runId)
        }
      })
      setCollapsedGroups(toCollapse)
    }
  }, [groupByRun, groups])

  // ── Build virtual items list ─────────────────────────────────
  const virtualItems = useMemo(() => {
    const items: VirtualItem[] = []
    let top = 0

    if (!groupByRun) {
      // Flat list of logs
      filtered.forEach((log, i) => {
        const isExpanded = expandedRows.has(log.id)
        const h = isExpanded ? estimateRowHeight(log.message) : ROW_HEIGHT
        items.push({
          type: 'log',
          key: log.id ?? `log-${i}`,
          height: h,
          top,
          log,
          logIndex: i,
        })
        top += h
      })
    } else {
      // Grouped list
      groups.forEach(group => {
        // Group header
        items.push({
          type: 'group-header',
          key: `group-${group.runId}`,
          height: GROUP_HEADER_HEIGHT,
          top,
          group,
        })
        top += GROUP_HEADER_HEIGHT

        // Log rows (if not collapsed)
        if (!collapsedGroups.has(group.runId)) {
          group.logs.forEach((log, i) => {
            const isExpanded = expandedRows.has(log.id)
            const h = isExpanded ? estimateRowHeight(log.message) : ROW_HEIGHT
            items.push({
              type: 'log',
              key: log.id ?? `glog-${group.runId}-${i}`,
              height: h,
              top,
              log,
              logIndex: i,
            })
            top += h
          })
        }
      })
    }

    return items
  }, [groupByRun, filtered, groups, collapsedGroups, expandedRows])

  const totalHeight = virtualItems.length > 0
    ? virtualItems[virtualItems.length - 1].top + virtualItems[virtualItems.length - 1].height
    : 0

  // ── Visible items (virtual windowing with larger buffer) ───
  const visibleItems = useMemo(() => {
    const ch = containerHeightRef.current || 600
    const viewTop = scrollTop - BUFFER_COUNT * ROW_HEIGHT
    const viewBottom = scrollTop + ch + BUFFER_COUNT * ROW_HEIGHT

    // Binary search for first visible item
    let lo = 0
    let hi = virtualItems.length - 1
    let firstIdx = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (virtualItems[mid].top + virtualItems[mid].height >= viewTop) {
        firstIdx = mid
        hi = mid - 1
      } else {
        lo = mid + 1
      }
    }

    // Collect visible items from firstIdx
    const result: VirtualItem[] = []
    for (let i = firstIdx; i < virtualItems.length; i++) {
      const item = virtualItems[i]
      if (item.top > viewBottom) break
      result.push(item)
    }
    return result
  }, [virtualItems, scrollTop])

  // ── Visible range indicator ────────────────────────────────────
  const visibleRange = useMemo(() => {
    if (visibleItems.length === 0) return { start: 0, end: 0 }
    const firstLog = visibleItems.find(v => v.type === 'log' && v.logIndex !== undefined)
    const lastLog = [...visibleItems].reverse().find(v => v.type === 'log' && v.logIndex !== undefined)
    const start = firstLog?.logIndex ?? 0
    const end = lastLog?.logIndex ?? 0
    return { start, end: Math.max(start + 1, end + 1) }
  }, [visibleItems])

  // Track rendered count for performance indicator
  useEffect(() => {
    setRenderedCount(visibleItems.length)
  }, [visibleItems.length])

  // ── Scroll handler ───────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const el = scrollContainerRef.current
      setScrollTop(el.scrollTop)
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
      setIsNearBottom(nearBottom)
      setIsNearTop(el.scrollTop < SCROLL_THRESHOLD)
    }
  }, [])

  // ── Measure container height ─────────────────────────────────
  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        containerHeightRef.current = entry.contentRect.height
      }
      // Trigger re-render for visible items recalculation
      setScrollTop(el.scrollTop)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // ── Auto-scroll to bottom ────────────────────────────────────
  useEffect(() => {
    if (liveMode && autoScroll && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
    }
  }, [filtered.length, liveMode, autoScroll])

  // ── Handlers ─────────────────────────────────────────────────
  const handleTrigger = (_table: string) => {
    streamer.startExecution('daily')
    toast.success('已触发 daily 全量执行', { description: '观察下方日志流' })
  }

  const handleExport = () => {
    const lines = filtered.map(l => `[${l.ts}] ${l.level.padEnd(7)} ${l.table.padEnd(22)} | ${l.message}`)
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs_${new Date().toISOString().slice(0, 10)}.log`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${filtered.length} 条日志`, { description: a.download })
  }

  const copyLog = (msg: string, id: string) => {
    navigator.clipboard?.writeText(msg)
    setCopiedId(id)
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500)
  }

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleGroupCollapse = (runId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(runId)) next.delete(runId)
      else next.add(runId)
      return next
    })
  }

  const expandAllGroups = () => {
    setCollapsedGroups(new Set())
  }

  const collapseAllGroups = () => {
    setCollapsedGroups(new Set(groups.map(g => g.runId)))
  }

  const scrollToBottom = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [])

  const scrollToTop = useCallback(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: 0,
        behavior: 'smooth',
      })
    }
  }, [])

  // ── Group status helpers ─────────────────────────────────────
  const getGroupBorderColor = (group: LogGroup) => {
    if (group.hasError) return 'border-l-[3px] border-rose-500'
    if (group.hasWarning) return 'border-l-[3px] border-amber-500'
    return 'border-l-[3px] border-emerald-500'
  }

  const getGroupStatusDot = (group: LogGroup) => {
    if (group.hasError) return 'bg-rose-500'
    if (group.hasWarning) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const getGroupStatus = (group: LogGroup): 'failed' | 'warning' | 'completed' => {
    if (group.hasError) return 'failed'
    if (group.hasWarning) return 'warning'
    return 'completed'
  }

  const getGroupDuration = (group: LogGroup): string => {
    if (!group.firstTs || !group.lastTs) return '—'
    const start = new Date(group.firstTs).getTime()
    const end = new Date(group.lastTs).getTime()
    const sec = Math.round((end - start) / 1000)
    if (sec < 60) return `${sec}s`
    const m = Math.floor(sec / 60)
    const s = sec % 60
    if (m < 60) return `${m}m ${s}s`
    const h = Math.floor(m / 60)
    return `${h}h ${m % 60}m`
  }

  // ── Row left border color (enhanced with thicker border + bg tint) ──
  const getLevelBorder = (l: LogItem) => {
    switch (l.level) {
      case 'ERROR': return 'border-l-[3px] border-rose-500'
      case 'WARNING': return 'border-l-[3px] border-amber-500'
      case 'SUCCESS': return 'border-l-[3px] border-emerald-500'
      case 'INFO': return 'border-l-[3px] border-sky-500'
      case 'DEBUG': return 'border-l-[3px] border-zinc-300 dark:border-zinc-600'
      default: return 'border-l-[3px] border-zinc-200 dark:border-zinc-700'
    }
  }

  // ── Timestamp recency check ─────────────────────────────────
  const isRecentLog = (ts: string): boolean => {
    if (!ts) return false
    const logTime = new Date(ts).getTime()
    if (isNaN(logTime)) return false
    const now = Date.now()
    return (now - logTime) < 60000 // within last minute
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* 真实日志加载状态 */}
      {logsLoading && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 text-sm text-zinc-500">
          <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
          <span>正在读取 logs/ 目录...</span>
        </div>
      )}
      {logsError && !logsLoading && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
          <span className="text-amber-700 dark:text-amber-300 font-medium">日志加载失败</span>
          <span className="text-amber-600 dark:text-amber-400">({logsError})</span>
          <Button size="sm" variant="outline" className="ml-auto h-6 text-[11px]" onClick={loadLogs}>重试</Button>
        </div>
      )}
      {truncated && !logsLoading && (
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-700 dark:text-sky-300">
          <Info className="h-3.5 w-3.5 text-sky-500 flex-shrink-0" />
          <span>仅显示最近 500 行（共扫描 {fileCount} 个日志文件）</span>
        </div>
      )}
      {/* 实时状态栏 */}
      <Card className={streamer.connected ? 'border-emerald-200 dark:border-emerald-800' : 'border-zinc-200 dark:border-zinc-800'}>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className={`p-1.5 rounded-md ${streamer.connected ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'}`}>
                {streamer.connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
              </div>
              <div>
                <div className="text-xs font-medium flex items-center gap-1.5">
                  实时日志流
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0 rounded text-[10px] ${streamer.connected ? 'text-emerald-600' : 'text-zinc-400'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${streamer.connected ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'}`} />
                    {streamer.connected ? 'WS 已连接' : '断开'}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-400">mini-service :3003 · socket.io</div>
              </div>
            </div>

            <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />

            {/* Live 模式开关 */}
            <div className="flex items-center gap-2">
              <Radio className={`h-4 w-4 ${liveMode && streamer.connected ? 'text-rose-500 animate-pulse' : 'text-zinc-400'}`} />
              <span className="text-xs font-medium">Live 模式</span>
              <Switch checked={liveMode} onCheckedChange={setLiveMode} disabled={!streamer.connected} />
            </div>

            {/* 当前运行 */}
            {streamer.progress.status === 'running' && (
              <>
                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">运行中:</span>
                  <span className="font-mono font-medium text-sky-600 dark:text-sky-400">{streamer.progress.currentTable}</span>
                  <Badge variant="outline" className="text-sky-600 border-sky-300 py-0">
                    <Loader2 className="h-3 w-3 mr-0.5 animate-spin" /> {streamer.progress.percent}%
                  </Badge>
                </div>
              </>
            )}
            {streamer.progress.status === 'completed' && (
              <>
                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-emerald-600 border-emerald-300 py-0">
                    <CheckCircle2 className="h-3 w-3 mr-0.5" /> 执行完成
                  </Badge>
                </div>
              </>
            )}

            {/* daily 全量进度 */}
            {streamer.progress.status === 'running' && streamer.progress.tablesTotal > 0 && (
              <>
                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex items-center gap-2 text-xs">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-zinc-500">daily 全量</span>
                  <div className="w-24 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${streamer.progress.percent}%` }} />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400">{streamer.progress.tablesCompleted}/{streamer.progress.tablesTotal}</span>
                </div>
              </>
            )}

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => streamer.startExecution('daily')}
                disabled={streamer.progress.status === 'running'}
                title="触发 daily 全量执行"
              >
                <Play className="h-3 w-3 mr-1" /> 触发 daily
              </Button>
              {streamer.progress.status === 'running' && (
                <Button size="sm" variant="outline" className="h-8 text-xs text-rose-600 hover:text-rose-700" onClick={() => streamer.cancelExecution()}>
                  <Pause className="h-3 w-3 mr-1" /> 取消
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => streamer.clearLogs()} title="清空实时日志">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* 进度条 */}
          {streamer.progress.status === 'running' && (
            <div className="mt-2 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-fuchsia-500 transition-all duration-300"
                style={{ width: `${streamer.progress.percent}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 触发器：可触发的 daily 脚本列表 */}
      {dailyScripts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500">
              <Activity className="h-3.5 w-3.5" /> Daily 表 ({dailyScripts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {dailyScripts.map(s => {
                const isRunning = streamer.progress.status === 'running' && streamer.progress.currentTable === s.table
                return (
                  <button
                    key={s.table}
                    onClick={() => handleTrigger(s.table)}
                    disabled={streamer.progress.status === 'running'}
                    className={`px-2 py-1 rounded text-[11px] font-mono border transition-all ${
                      isRunning
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={`${s.cn}`}
                  >
                    {isRunning && <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />}
                    {s.table}
                    <span className="text-zinc-400 ml-1">{s.cn}</span>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 筛选栏 + 级别 pills + 分组切换 */}
      <Card>
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input placeholder="搜索日志内容 / 表名..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-mono text-sm h-9" />
            </div>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="表" /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">全部表</SelectItem>
                {tables.map(t => <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>

            {/* 分组切换按钮 */}
            <Button
              variant={groupByRun ? 'default' : 'outline'}
              size="sm"
              className={`h-9 text-xs gap-1.5 ${groupByRun ? 'bg-zinc-700 hover:bg-zinc-800 text-white' : ''}`}
              onClick={() => setGroupByRun(v => !v)}
              title="按 run_id 分组显示日志"
            >
              <Layers className="h-3.5 w-3.5" />
              按执行分组
              {groupByRun && groupCount > 0 && (
                <Badge variant="secondary" className="ml-0.5 px-1.5 py-0 text-[10px] bg-white/20 text-white border-0">
                  {groupCount}
                </Badge>
              )}
            </Button>

            {/* Expand/Collapse all when grouped */}
            {groupByRun && groupCount > 0 && (
              <div className="flex items-center gap-1">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={expandAllGroups}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>展开所有组</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" className="h-9 w-9 p-0" onClick={collapseAllGroups}>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>折叠所有组</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            )}

            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={handleExport} disabled={filtered.length === 0} title="导出为 .log 文件">
              <Download className="h-3.5 w-3.5 mr-1" />导出
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-9 text-xs"
              onClick={loadLogs}
              disabled={logsLoading}
              title={lastFetchedAt ? `上次刷新: ${lastFetchedAt.toLocaleTimeString('zh-CN')}` : '重新读取日志'}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${logsLoading ? 'animate-spin' : ''}`} />
              {logsLoading ? '刷新中' : '刷新'}
            </Button>
            <Badge variant="secondary" className="ml-auto">
              {filtered.length} / {allLogs.length}
              {liveMode && streamer.logs.length > 0 && <span className="ml-1 text-rose-500">·{streamer.logs.length} live</span>}
            </Badge>
          </div>
          {/* 级别 pills — enhanced toggle pills */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1 mr-1"><Filter className="h-3 w-3" />级别:</span>
            <LevelPill label="全部" count={allLogs.length} active={level === 'all'} onClick={() => setLevel('all')} color="zinc" />
            <LevelPill label="ERROR" count={stats.ERROR} active={level === 'ERROR'} onClick={() => setLevel('ERROR')} color="rose" icon={<Bug className="h-3 w-3" />} />
            <LevelPill label="WARNING" count={stats.WARNING} active={level === 'WARNING'} onClick={() => setLevel('WARNING')} color="amber" icon={<AlertTriangle className="h-3 w-3" />} />
            <LevelPill label="INFO" count={stats.INFO} active={level === 'INFO'} onClick={() => setLevel('INFO')} color="sky" icon={<Info className="h-3 w-3" />} />
            <LevelPill label="DEBUG" count={stats.DEBUG} active={level === 'DEBUG'} onClick={() => setLevel('DEBUG')} color="zinc" icon={<Bug className="h-3 w-3" />} />
          </div>
        </CardContent>
      </Card>

      {/* 日志流 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-zinc-500" />
              日志流
              {liveMode ? (
                <Badge variant="outline" className="text-rose-600 border-rose-300 ml-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse mr-1" /> LIVE
                </Badge>
              ) : (
                <Badge variant="outline" className="text-zinc-500 ml-1">历史回放</Badge>
              )}
              <span className="text-[11px] text-zinc-400 font-normal ml-2">
                {liveMode ? `logs/ (${fileCount} 文件) + 实时推送` : `logs/ (${fileCount} 文件)`}
              </span>
              <Badge variant="outline" className="text-[10px] text-zinc-500 border-zinc-300 ml-2 font-mono">
                显示 {visibleRange.start + 1}-{visibleRange.end} / {filtered.length.toLocaleString()}
              </Badge>
              {groupByRun && (
                <Badge variant="outline" className="text-zinc-500 ml-1">
                  <Layers className="h-3 w-3 mr-0.5" /> {groupCount} 组
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px] text-zinc-500 border-zinc-300 ml-2 font-mono">
                {renderedCount} rendered
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <ArrowDownToLine className={`h-3.5 w-3.5 ${autoScroll && liveMode ? 'text-emerald-500' : 'text-zinc-400'}`} />
                <span className="text-zinc-500">自动滚动</span>
                <Switch checked={autoScroll && liveMode} onCheckedChange={v => { setAutoScroll(v); if (v) setLiveMode(true) }} disabled={!liveMode} />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 relative">
          <div
            ref={scrollContainerRef}
            className="h-[calc(100vh-460px)] overflow-y-auto font-mono"
            onScroll={handleScroll}
          >
            {filtered.length === 0 ? (
              <div className="py-10 text-center text-zinc-400">
                <FileText className="h-8 w-8 mx-auto opacity-40 mb-2" />
                {liveMode && streamer.connected ? '等待日志推送... 点击上方剧本触发' : (logsError ? '日志加载失败，点击右上角重试' : '无匹配日志')}
              </div>
            ) : (
              <div className="relative" style={{ height: totalHeight }}>
                <div className="px-3 py-2 text-xs">
                  {visibleItems.map((item, _visibleIdx) => {
                    if (item.type === 'group-header' && item.group) {
                      return (
                        <GroupHeader
                          key={item.key}
                          group={item.group}
                          isCollapsed={collapsedGroups.has(item.group.runId)}
                          onToggle={() => toggleGroupCollapse(item.group!.runId)}
                          borderColor={getGroupBorderColor(item.group)}
                          statusDot={getGroupStatusDot(item.group)}
                          status={getGroupStatus(item.group)}
                          duration={getGroupDuration(item.group)}
                          style={{ position: 'sticky', top: 0, zIndex: 10 }}
                          virtualTop={item.top}
                        />
                      )
                    }
                    if (item.type === 'log' && item.log) {
                      return (
                        <MemoizedLogRow
                          key={item.key}
                          log={item.log}
                          height={item.height}
                          top={item.top}
                          isExpanded={expandedRows.has(item.log.id)}
                          isCopied={copiedId === item.log.id}
                          isHovered={hoveredLogId === item.log.id}
                          lineNumber={item.logIndex !== undefined ? item.logIndex + 1 : 0}
                          isRecent={isRecentLog(item.log.ts)}
                          onToggleExpand={toggleExpand}
                          onCopy={copyLog}
                          onHover={setHoveredLogId}
                        />
                      )
                    }
                    return null
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Floating scroll-to-bottom button (enhanced) */}
          {filtered.length > 0 && !isNearTop && (
            <button
              onClick={scrollToTop}
              className="absolute top-3 right-3 z-20 h-8 w-8 rounded-full bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 shadow-lg flex items-center justify-center text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:shadow-xl transition-all"
              title="滚动到顶部"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          )}
          {filtered.length > 0 && !isNearBottom && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-3 right-3 z-20 h-9 w-9 rounded-full bg-sky-600 hover:bg-sky-700 text-white shadow-lg flex items-center justify-center transition-all hover:shadow-xl"
              title="滚动到底部"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ── GroupHeader Component (enhanced with run_id badge, duration, status) ────
function GroupHeader({
  group,
  isCollapsed,
  onToggle,
  borderColor,
  statusDot,
  status,
  duration,
  style,
  virtualTop,
}: {
  group: LogGroup
  isCollapsed: boolean
  onToggle: () => void
  borderColor: string
  statusDot: string
  status: 'failed' | 'warning' | 'completed'
  duration: string
  style: React.CSSProperties
  virtualTop: number
}) {
  const timeRange = group.firstTs.slice(11) + ' → ' + group.lastTs.slice(11)

  const statusBadge = {
    failed: { cls: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300', icon: <XCircle className="h-3 w-3 mr-0.5" />, text: '失败' },
    warning: { cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300', icon: <AlertTriangle className="h-3 w-3 mr-0.5" />, text: '警告' },
    completed: { cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', icon: <CheckCircle2 className="h-3 w-3 mr-0.5" />, text: '完成' },
  }[status]

  return (
    <div
      style={{ ...style, position: 'absolute', top: virtualTop, left: 0, right: 0, willChange: 'transform' }}
      className={`flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800/90 rounded cursor-pointer select-none ${borderColor} hover:bg-zinc-200 dark:hover:bg-zinc-700/90 transition-colors`}
      onClick={onToggle}
    >
      {/* Collapse toggle */}
      {isCollapsed ? (
        <ChevronRight className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5 text-zinc-500 flex-shrink-0" />
      )}

      {/* Status dot */}
      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDot}`} />

      {/* Run ID as clickable badge */}
      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 h-5 border-sky-300 text-sky-700 dark:text-sky-400 dark:border-sky-700 cursor-pointer hover:bg-sky-50 dark:hover:bg-sky-950/30">
        {group.runId}
      </Badge>

      {/* Status badge */}
      <span className={`inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium ${statusBadge.cls}`}>
        {statusBadge.icon}
        {statusBadge.text}
      </span>

      {/* Duration */}
      <span className="flex items-center gap-0.5 text-[10px] text-zinc-500">
        <Clock className="h-2.5 w-2.5" />
        {duration}
      </span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Log count badge */}
      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
        {group.logs.length} 条
      </Badge>

      {/* Time range */}
      <span className="text-[10px] text-zinc-400 font-mono">{timeRange}</span>
    </div>
  )
}

// ── MemoizedLogRow Component (enhanced with line numbers, monospace, copy on hover, timestamp highlighting) ──
interface LogRowProps {
  log: LogItem
  height: number
  top: number
  isExpanded: boolean
  isCopied: boolean
  isHovered: boolean
  lineNumber: number
  isRecent: boolean
  onToggleExpand: (id: string) => void
  onCopy: (msg: string, id: string) => void
  onHover: (id: string | null) => void
}

const LogRowInner = ({ log, height, top, isExpanded, isCopied, isHovered, lineNumber, isRecent, onToggleExpand, onCopy, onHover }: LogRowProps) => {
  const l = log
  const isLive = l.isLive
  const hasLong = l.message.length > 80
  const levelBorder = getLevelBorderStatic(l.level)
  const levelCls = levelColorStatic(l.level)
  const bgCls =
    l.level === 'ERROR' ? 'bg-rose-50/80 dark:bg-rose-950/30' :
    l.level === 'WARNING' ? 'bg-amber-50/80 dark:bg-amber-950/20' :
    l.level === 'SUCCESS' ? 'bg-emerald-50/70 dark:bg-emerald-950/20' :
    isLive ? 'bg-sky-50/50 dark:bg-sky-950/20' :
    isHovered ? 'bg-zinc-50 dark:bg-zinc-800/50' :
    ''
  const tsDisplay = l.ts ? l.ts.slice(5) : '—'

  return (
    <div
      className={`group flex gap-2 py-0.5 px-2 rounded-sm transition-colors ${levelBorder} ${bgCls}`}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height,
        willChange: 'transform',
        contentVisibility: 'auto',
        containIntrinsicSize: `${ROW_HEIGHT}px`,
      }}
      onMouseEnter={() => onHover(l.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* Line number */}
      <span className="text-zinc-300 dark:text-zinc-600 flex-shrink-0 w-8 text-right select-none text-[10px] leading-6">{lineNumber}</span>

      {/* Timestamp with recency highlighting */}
      <span className={`flex-shrink-0 w-[7.5rem] text-[11px] leading-6 ${l.ts && isRecent ? 'text-sky-600 dark:text-sky-400 font-medium' : 'text-zinc-400'}`}>
        {tsDisplay}
        {l.ts && isRecent && <span className="ml-1 inline-block h-1 w-1 rounded-full bg-sky-500 animate-pulse" />}
      </span>

      {/* Level badge with icon */}
      <span className={`flex-shrink-0 w-20 font-bold text-[11px] leading-6 flex items-center gap-0.5 ${levelCls}`}>
        {l.level === 'ERROR' && <XCircle className="h-3 w-3" />}
        {l.level === 'WARNING' && <AlertTriangle className="h-3 w-3" />}
        {l.level === 'SUCCESS' && <CheckCircle2 className="h-3 w-3" />}
        {l.level === 'INFO' && <Info className="h-3 w-3" />}
        {l.level === 'DEBUG' && <Bug className="h-3 w-3" />}
        {l.level}
        {isLive && <span className="ml-1 text-rose-500">●</span>}
      </span>

      {/* Source file name */}
      <span className="text-sky-600 dark:text-sky-400 flex-shrink-0 w-40 truncate text-[11px] leading-6" title={l.table}>{l.table || '—'}</span>

      {/* Message */}
      <span className={`text-zinc-700 dark:text-zinc-300 flex-1 text-[11px] leading-6 ${!isExpanded && hasLong ? 'truncate' : ''}`}>{l.message}</span>

      {/* Copy button per line (on hover) */}
      <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity relative">
        {hasLong && (
          <button onClick={() => onToggleExpand(l.id)} className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title={isExpanded ? '收起' : '展开'}>
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        )}
        <button
          onClick={() => onCopy(l.message, l.id)}
          className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 relative"
          title="复制"
        >
          <Copy className="h-3 w-3" />
          {isCopied && (
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-800 dark:bg-zinc-200 text-white dark:text-zinc-800 text-[10px] whitespace-nowrap animate-fade-in">
              Copied!
            </span>
          )}
        </button>
      </div>
    </div>
  )
}

const MemoizedLogRow = React.memo(LogRowInner)

// ── LevelPill Component (enhanced toggle pills with icons) ──────
function LevelPill({ label, count, active, onClick, color, icon }: { label: string; count: number; active: boolean; onClick: () => void; color: 'zinc' | 'rose' | 'amber' | 'sky'; icon?: React.ReactNode }) {
  const colorMap = {
    zinc: active ? 'bg-zinc-700 text-white border-zinc-700 shadow-sm' : 'text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800',
    rose: active ? 'bg-rose-600 text-white border-rose-600 shadow-sm' : 'text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30',
    amber: active ? 'bg-amber-500 text-white border-amber-500 shadow-sm' : 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/30',
    sky: active ? 'bg-sky-600 text-white border-sky-600 shadow-sm' : 'text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-900 hover:bg-sky-50 dark:hover:bg-sky-950/30',
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border transition-all ${colorMap[color]}`}
    >
      {icon}
      {label}
      <span className={`px-1.5 rounded-full text-[10px] ${active ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-800'}`}>{count}</span>
    </button>
  )
}

// ── Utility Functions ──────────────────────────────────────────
function levelColorStatic(l: string): string {
  switch (l) {
    case 'ERROR': return 'text-rose-600'
    case 'WARNING': return 'text-amber-600'
    case 'SUCCESS': return 'text-emerald-600'
    case 'INFO': return 'text-sky-600'
    case 'DEBUG': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}

function getLevelBorderStatic(level: string): string {
  switch (level) {
    case 'ERROR': return 'border-l-[3px] border-rose-500'
    case 'WARNING': return 'border-l-[3px] border-amber-500'
    case 'SUCCESS': return 'border-l-[3px] border-emerald-500'
    case 'INFO': return 'border-l-[3px] border-sky-500'
    case 'DEBUG': return 'border-l-[3px] border-zinc-300 dark:border-zinc-600'
    default: return 'border-l-[3px] border-zinc-200 dark:border-zinc-700'
  }
}

function estimateRowHeight(message: string): number {
  const lines = Math.ceil(message.length / 80)
  return ROW_HEIGHT + Math.max(0, lines - 1) * 16
}
