'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import {
  Play, Scan, Wrench, Calendar, Loader2, Square,
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Clock, AlertTriangle, Terminal, Zap,
} from 'lucide-react'
import {
  useScheduler,
  type SchedulerAction,
  type LogEntry,
  type SchedulerHistoryItem,
  type RunStatus,
} from '@/hooks/useScheduler'
import { toast } from 'sonner'

// ─── Log level color mapping ──────────────────────────────────────
function logLevelColor(level: LogEntry['level']): string {
  switch (level) {
    case 'INFO': return 'text-zinc-700 dark:text-zinc-300'
    case 'WARNING': return 'text-amber-600 dark:text-amber-400'
    case 'ERROR': return 'text-rose-600 dark:text-rose-400'
    case 'SUCCESS': return 'text-emerald-600 dark:text-emerald-400'
    default: return 'text-zinc-500'
  }
}

function logLevelBg(level: LogEntry['level']): string {
  switch (level) {
    case 'WARNING': return 'bg-amber-50 dark:bg-amber-950/20'
    case 'ERROR': return 'bg-rose-50 dark:bg-rose-950/20'
    case 'SUCCESS': return 'bg-emerald-50 dark:bg-emerald-950/20'
    default: return ''
  }
}

// ─── Status badge ─────────────────────────────────────────────────
function statusBadge(status: RunStatus) {
  switch (status) {
    case 'running':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 animate-pulse">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> 运行中
        </Badge>
      )
    case 'completed':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
          <CheckCircle2 className="h-3 w-3 mr-1" /> 完成
        </Badge>
      )
    case 'failed':
      return (
        <Badge className="bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
          <XCircle className="h-3 w-3 mr-1" /> 失败
        </Badge>
      )
    case 'cancelled':
      return (
        <Badge className="bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700">
          <Square className="h-3 w-3 mr-1" /> 已取消
        </Badge>
      )
  }
}

// ─── Action label ─────────────────────────────────────────────────
function actionLabel(action: SchedulerAction): string {
  switch (action) {
    case 'daily': return 'Daily 全量'
    case 'table': return '单表执行'
    case 'fix': return '补数'
    case 'scan': return '扫描'
    case 'check': return '检查'
  }
}

// ─── Duration helper ──────────────────────────────────────────────
function formatRunDuration(startedAt: string, finishedAt: string | null): string {
  const start = new Date(startedAt.replace(' ', 'T')).getTime()
  const end = finishedAt ? new Date(finishedAt.replace(' ', 'T')).getTime() : Date.now()
  const sec = Math.round((end - start) / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}m ${s}s`
}

// ─── Date input for backfill ──────────────────────────────────────
function DatePickerInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono"
    />
  )
}

// ─── Main Scheduler Panel ─────────────────────────────────────────
export function SchedulerPanel() {
  const {
    currentRun,
    executionHistory,
    isTriggering,
    triggerExecution,
    cancel,
  } = useScheduler()

  const [fixDate, setFixDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null)
  const [historyLogs, setHistoryLogs] = useState<LogEntry[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)
  const [autoScroll, setAutoScroll] = useState(true)

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [currentRun?.logs, autoScroll])

  // Trigger handlers
  const handleTrigger = useCallback(async (action: SchedulerAction, options?: { tableName?: string; force?: boolean; date?: string }) => {
    try {
      const runId = await triggerExecution(action, options)
      if (runId) {
        toast.success(`已触发 ${actionLabel(action)} 执行`, { description: `Run ID: ${runId}` })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '触发失败'
      toast.error(`执行触发失败: ${msg}`)
    }
  }, [triggerExecution])

  const handleCancel = useCallback(async () => {
    try {
      await cancel()
      toast.info('执行已取消')
    } catch {
      toast.error('取消失败')
    }
  }, [cancel])

  // Load logs for expanded history item
  useEffect(() => {
    if (!expandedHistoryId) {
      queueMicrotask(() => setHistoryLogs([]))
      return
    }
    const item = executionHistory.find(h => h.runId === expandedHistoryId)
    if (!item) {
      queueMicrotask(() => setHistoryLogs([]))
      return
    }
    // Fetch full logs from API
    void (async () => {
      try {
        const res = await fetch(`/api/scheduler?runId=${expandedHistoryId}`)
        if (res.ok) {
          const data = await res.json()
          setHistoryLogs(data.logs ?? [])
        }
      } catch {
        setHistoryLogs([])
      }
    })()
  }, [expandedHistoryId, executionHistory])

  const isRunning = currentRun?.status === 'running'

  return (
    <div className="space-y-4">
      {/* Quick Actions Bar */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              调度面板
            </CardTitle>
            <div className="flex items-center gap-2">
              {isRunning ? (
                <>
                  {statusBadge('running')}
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {currentRun.tablesCompleted}/{currentRun.tablesTotal} 表
                  </Badge>
                </>
              ) : (
                <Badge variant="secondary" className="text-[10px]">
                  <Clock className="h-3 w-3 mr-1" /> 空闲
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Execute daily */}
            <Button
              size="sm"
              className="h-9 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => handleTrigger('daily')}
              disabled={isRunning || isTriggering}
            >
              {isTriggering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              执行 daily
            </Button>

            {/* Execute scan */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs gap-1.5 border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-700 dark:text-sky-400 dark:hover:bg-sky-950/30"
              onClick={() => handleTrigger('scan')}
              disabled={isRunning || isTriggering}
            >
              <Scan className="h-3.5 w-3.5" />
              执行扫描
            </Button>

            {/* Execute check */}
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-xs gap-1.5"
              onClick={() => handleTrigger('check')}
              disabled={isRunning || isTriggering}
            >
              <Wrench className="h-3.5 w-3.5" />
              健康检查
            </Button>

            {/* Backfill (fix) dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs gap-1.5 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/30"
                  disabled={isRunning || isTriggering}
                >
                  <Calendar className="h-3.5 w-3.5" />
                  补数
                  <ChevronDown className="h-3 w-3 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>补数执行 (backfill)</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-2 space-y-2">
                  <div className="text-[11px] text-zinc-500">选择日期:</div>
                  <DatePickerInput value={fixDate} onChange={setFixDate} />
                  <Button
                    size="sm"
                    className="w-full h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={() => handleTrigger('fix', { date: fixDate })}
                  >
                    <Calendar className="h-3 w-3 mr-1" />
                    执行补数 ({fixDate})
                  </Button>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleTrigger('fix', { date: fixDate, force: true })}>
                  <Zap className="h-3.5 w-3.5 mr-2 text-amber-500" />
                  强制补数 (force)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Cancel button (only when running) */}
            {isRunning && (
              <Button
                size="sm"
                variant="destructive"
                className="h-9 text-xs gap-1.5 ml-auto"
                onClick={handleCancel}
              >
                <Square className="h-3.5 w-3.5" />
                停止
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Execution Log Stream */}
      {isRunning && currentRun && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-500" />
                执行日志
                <Badge variant="outline" className="text-[10px] font-mono ml-1">
                  {currentRun.runId}
                </Badge>
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-zinc-500">
                  {actionLabel(currentRun.action)} · {formatRunDuration(currentRun.startedAt, currentRun.finishedAt)}
                </span>
                <label className="flex items-center gap-1 text-[11px] text-zinc-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={e => setAutoScroll(e.target.checked)}
                    className="rounded border-zinc-300"
                  />
                  自动滚动
                </label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {/* Progress bar */}
            <div className="mb-3">
              <div className="flex items-center justify-between text-[11px] text-zinc-500 mb-1">
                <span>{currentRun.tablesCompleted} / {currentRun.tablesTotal} 表已完成</span>
                <span className="font-mono">{currentRun.progress}%</span>
              </div>
              <Progress value={currentRun.progress} className="h-2" />
              <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                {currentRun.successCount > 0 && (
                  <span className="flex items-center gap-1 text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> {currentRun.successCount} 成功
                  </span>
                )}
                {currentRun.failCount > 0 && (
                  <span className="flex items-center gap-1 text-rose-600">
                    <XCircle className="h-3 w-3" /> {currentRun.failCount} 失败
                  </span>
                )}
              </div>
            </div>

            {/* Log stream */}
            <ScrollArea className="h-64 rounded-md border bg-zinc-950 dark:bg-zinc-900">
              <div className="p-3 font-mono text-xs space-y-0.5">
                {currentRun.logs.length === 0 ? (
                  <div className="text-zinc-500 py-4 text-center">等待日志...</div>
                ) : (
                  currentRun.logs.map((log, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-2 py-0.5 px-1 rounded ${logLevelBg(log.level)}`}
                    >
                      <span className="text-zinc-500 flex-shrink-0 w-[85px]">
                        {log.timestamp.slice(11)}
                      </span>
                      <span className={`flex-shrink-0 w-[60px] font-semibold ${logLevelColor(log.level)}`}>
                        [{log.level}]
                      </span>
                      <span className={logLevelColor(log.level)}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Execution History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-zinc-500" />
            执行历史
            <Badge variant="secondary" className="text-[10px]">
              {executionHistory.length} 条记录
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {executionHistory.length === 0 ? (
            <div className="text-center py-8 text-zinc-400 text-sm">
              <Terminal className="h-8 w-8 mx-auto mb-2 opacity-30" />
              暂无执行记录
            </div>
          ) : (
            <ScrollArea className="max-h-96">
              <div className="space-y-1">
                {executionHistory.slice(0, 10).map(item => {
                  const isExpanded = expandedHistoryId === item.runId
                  return (
                    <div key={item.runId}>
                      <button
                        onClick={() => setExpandedHistoryId(isExpanded ? null : item.runId)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-xs transition-colors text-left"
                      >
                        <span className="flex-shrink-0">
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                          )}
                        </span>
                        <span className="font-mono text-zinc-500 w-16 flex-shrink-0">{item.runId}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {actionLabel(item.action)}
                        </Badge>
                        <span className="font-mono text-zinc-400 w-[120px] flex-shrink-0">
                          {item.startedAt.slice(5)}
                        </span>
                        <span className="text-zinc-500 w-16 flex-shrink-0">
                          {formatRunDuration(item.startedAt, item.finishedAt)}
                        </span>
                        <span className="flex-shrink-0">{statusBadge(item.status)}</span>
                        <span className="ml-auto text-zinc-400 flex-shrink-0">
                          {item.tablesCompleted}/{item.tablesTotal}
                        </span>
                      </button>

                      {/* Expanded log view */}
                      {isExpanded && (
                        <div className="ml-7 mr-3 mb-2 rounded-md border bg-zinc-950 dark:bg-zinc-900 overflow-hidden">
                          <ScrollArea className="h-48">
                            <div className="p-2 font-mono text-[11px] space-y-0.5">
                              {historyLogs.length === 0 ? (
                                <div className="text-zinc-500 py-3 text-center">加载中...</div>
                              ) : (
                                historyLogs.map((log, idx) => (
                                  <div
                                    key={idx}
                                    className={`flex gap-2 py-0.5 px-1 rounded ${logLevelBg(log.level)}`}
                                  >
                                    <span className="text-zinc-500 flex-shrink-0 w-[70px]">
                                      {log.timestamp.slice(11)}
                                    </span>
                                    <span className={`flex-shrink-0 w-[50px] font-semibold ${logLevelColor(log.level)}`}>
                                      [{log.level}]
                                    </span>
                                    <span className={logLevelColor(log.level)}>
                                      {log.message}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </ScrollArea>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
