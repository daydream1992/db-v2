'use client'
import { useState, useMemo, useEffect, useRef } from 'react'
import { LOGS } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Search, FileText, Radio, Pause, Play, Trash2, Activity, Loader2, CheckCircle2, XCircle, Zap, Wifi, WifiOff, Download, ArrowDownToLine, ChevronDown, ChevronUp, Filter, Copy } from 'lucide-react'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import { toast } from 'sonner'

export function LogsView() {
  // 静态历史日志
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string>('all')
  const [table, setTable] = useState<string>('all')
  const [liveMode, setLiveMode] = useState(true)
  const [autoScroll, setAutoScroll] = useState(true)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  // 实时流
  const streamer = useLogStreamer()

  const tables = useMemo(() => [...new Set(LOGS.map(l => l.table))].sort(), [])

  // 合并静态 + 实时日志（实时优先显示在顶部）
  const allLogs = useMemo(() => {
    const live = streamer.logs
    const staticLogs = LOGS.map(l => ({ ...l, id: `static-${l.ts}-${l.table}`, runId: 'r-202606251700' }))
    return liveMode ? [...live, ...staticLogs] : staticLogs
  }, [streamer.logs, liveMode])

  const filtered = useMemo(() => {
    return allLogs.filter(l => {
      if (level !== 'all' && l.level !== level) return false
      if (table !== 'all' && l.table !== table) return false
      if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.table.includes(search)) return false
      return true
    })
  }, [allLogs, search, level, table])

  // 按级别统计
  const stats = useMemo(() => {
    const s = { ERROR: 0, WARNING: 0, INFO: 0, DEBUG: 0 }
    allLogs.forEach(l => { s[l.level]++ })
    return s
  }, [allLogs])

  const liveRefs = useRef<HTMLDivElement>(null)
  // 自动滚动到底部（live 模式 + autoScroll 开启）
  useEffect(() => {
    if (liveMode && autoScroll && liveRefs.current) {
      liveRefs.current.scrollTop = liveRefs.current.scrollHeight
    }
  }, [filtered.length, liveMode, autoScroll])

  const handleTrigger = (table: string) => {
    streamer.trigger(undefined, table)
    toast.success(`已触发实时执行：${table}`, { description: '观察下方日志流' })
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

  const copyLog = (msg: string) => {
    navigator.clipboard?.writeText(msg)
    toast.success('已复制日志内容')
  }

  const toggleExpand = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-4">
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
                    {streamer.connected ? '已连接' : '断开'}
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
            {streamer.currentRun && (
              <>
                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-500">运行中:</span>
                  <span className="font-mono font-medium text-sky-600 dark:text-sky-400">{streamer.currentRun.table}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{streamer.currentRun.runId}</span>
                  {streamer.currentRun.status === 'running' && (
                    <Badge variant="outline" className="text-sky-600 border-sky-300 py-0">
                      <Loader2 className="h-3 w-3 mr-0.5 animate-spin" /> {streamer.currentRun.progress ?? 0}%
                    </Badge>
                  )}
                  {streamer.currentRun.status === 'success' && (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 py-0">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" /> 完成
                    </Badge>
                  )}
                  {streamer.currentRun.status === 'failed' && (
                    <Badge variant="outline" className="text-rose-600 border-rose-300 py-0">
                      <XCircle className="h-3 w-3 mr-0.5" /> 失败
                    </Badge>
                  )}
                </div>
              </>
            )}

            {/* daily 全量进度 */}
            {streamer.dailyProgress && (
              <>
                <div className="h-8 w-px bg-zinc-200 dark:bg-zinc-800" />
                <div className="flex items-center gap-2 text-xs">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span className="text-zinc-500">daily 全量</span>
                  <div className="w-24 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${(streamer.dailyProgress.completed / streamer.dailyProgress.total) * 100}%` }} />
                  </div>
                  <span className="font-mono text-[10px] text-zinc-400">{streamer.dailyProgress.completed}/{streamer.dailyProgress.total}</span>
                </div>
              </>
            )}

            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => streamer.triggerDaily()}
                disabled={!streamer.connected || !!streamer.currentRun}
                title="触发 daily 全量执行"
              >
                <Play className="h-3 w-3 mr-1" /> 触发 daily
              </Button>
              {streamer.currentRun?.status === 'running' && (
                <Button size="sm" variant="outline" className="h-8 text-xs text-rose-600 hover:text-rose-700" onClick={() => streamer.cancel()}>
                  <Pause className="h-3 w-3 mr-1" /> 取消
                </Button>
              )}
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => streamer.clearLogs()} title="清空实时日志">
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* 进度条 */}
          {streamer.currentRun?.status === 'running' && (
            <div className="mt-2 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-fuchsia-500 transition-all duration-300"
                style={{ width: `${streamer.currentRun.progress ?? 0}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 触发器：可触发的脚本列表 */}
      {streamer.scripts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500">
              <Activity className="h-3.5 w-3.5" /> 可触发的执行剧本 ({streamer.scripts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex flex-wrap gap-1.5">
              {streamer.scripts.map(s => {
                const isRunning = streamer.currentRun?.table === s.table
                return (
                  <button
                    key={s.idx}
                    onClick={() => handleTrigger(s.table)}
                    disabled={!streamer.connected || !!streamer.currentRun}
                    className={`px-2 py-1 rounded text-[11px] font-mono border transition-all ${
                      isRunning
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={`${s.cn} · ${s.steps} 步日志`}
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

      {/* 筛选栏 + 级别 chips */}
      <Card>
        <CardContent className="p-3 space-y-2">
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
            <Button variant="outline" size="sm" className="h-9 text-xs" onClick={handleExport} disabled={filtered.length === 0} title="导出为 .log 文件">
              <Download className="h-3.5 w-3.5 mr-1" />导出
            </Button>
            <Badge variant="secondary" className="ml-auto">
              {filtered.length} / {allLogs.length}
              {liveMode && streamer.logs.length > 0 && <span className="ml-1 text-rose-500">·{streamer.logs.length} live</span>}
            </Badge>
          </div>
          {/* 级别 chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] text-zinc-400 flex items-center gap-1 mr-1"><Filter className="h-3 w-3" />级别:</span>
            <LevelChip label="全部" count={allLogs.length} active={level === 'all'} onClick={() => setLevel('all')} color="zinc" />
            <LevelChip label="ERROR" count={stats.ERROR} active={level === 'ERROR'} onClick={() => setLevel('ERROR')} color="rose" />
            <LevelChip label="WARNING" count={stats.WARNING} active={level === 'WARNING'} onClick={() => setLevel('WARNING')} color="amber" />
            <LevelChip label="INFO" count={stats.INFO} active={level === 'INFO'} onClick={() => setLevel('INFO')} color="emerald" />
            <LevelChip label="DEBUG" count={stats.DEBUG} active={level === 'DEBUG'} onClick={() => setLevel('DEBUG')} color="sky" />
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
                {liveMode ? 'logs/run_20260625.log + 实时推送' : 'logs/run_20260625.log'}
              </span>
            </CardTitle>
            <div className="flex items-center gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <ArrowDownToLine className={`h-3.5 w-3.5 ${autoScroll && liveMode ? 'text-emerald-500' : 'text-zinc-400'}`} />
                <span className="text-zinc-500">自动滚动</span>
                <Switch checked={autoScroll && liveMode} onCheckedChange={v => { setAutoScroll(v); if (v) setLiveMode(true) }} disabled={!liveMode} />
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { if (liveRefs.current) liveRefs.current.scrollTop = liveRefs.current.scrollHeight }} title="滚动到底部">
                <ChevronDown className="h-3.5 w-3.5" />底部
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div ref={liveRefs} className="h-[calc(100vh-460px)] overflow-y-auto font-mono">
            <div className="px-3 py-2 text-xs space-y-0.5">
              {filtered.length === 0 && (
                <div className="py-10 text-center text-zinc-400">
                  <FileText className="h-8 w-8 mx-auto opacity-40 mb-2" />
                  {liveMode && streamer.connected ? '等待日志推送... 点击上方剧本触发' : '无匹配日志'}
                </div>
              )}
              {filtered.map((l, i) => {
                const isLive = streamer.logs.some(s => s.id === l.id)
                const isExpanded = expandedRows.has(l.id ?? `row-${i}`)
                const hasLong = l.message.length > 80
                return (
                  <div
                    key={l.id ?? i}
                    className={`group flex gap-2 py-0.5 px-2 rounded ${
                      l.level === 'ERROR' ? 'bg-rose-50 dark:bg-rose-950/30' :
                      l.level === 'WARNING' ? 'bg-amber-50 dark:bg-amber-950/20' :
                      isLive ? 'bg-sky-50/50 dark:bg-sky-950/20' :
                      'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                    }`}
                  >
                    <span className="text-zinc-400 flex-shrink-0 w-20">{l.ts.slice(5)}</span>
                    <span className={`flex-shrink-0 w-20 font-bold ${levelColor(l.level)}`}>
                      {l.level}
                      {isLive && <span className="ml-1 text-rose-500">●</span>}
                    </span>
                    <span className="text-sky-600 dark:text-sky-400 flex-shrink-0 w-40 truncate" title={l.table}>{l.table}</span>
                    <span className={`text-zinc-700 dark:text-zinc-300 flex-1 ${!isExpanded && hasLong ? 'truncate' : ''}`}>{l.message}</span>
                    <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      {hasLong && (
                        <button onClick={() => toggleExpand(l.id ?? `row-${i}`)} className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title={isExpanded ? '收起' : '展开'}>
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      )}
                      <button onClick={() => copyLog(l.message)} className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400" title="复制">
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function LevelChip({ label, count, active, onClick, color }: { label: string; count: number; active: boolean; onClick: () => void; color: 'zinc' | 'rose' | 'amber' | 'emerald' | 'sky' }) {
  const colorMap = {
    zinc: active ? 'bg-zinc-700 text-white border-zinc-700' : 'text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800',
    rose: active ? 'bg-rose-600 text-white border-rose-600' : 'text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30',
    amber: active ? 'bg-amber-500 text-white border-amber-500' : 'text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-900 hover:bg-amber-50 dark:hover:bg-amber-950/30',
    emerald: active ? 'bg-emerald-600 text-white border-emerald-600' : 'text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/30',
    sky: active ? 'bg-sky-600 text-white border-sky-600' : 'text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-900 hover:bg-sky-50 dark:hover:bg-sky-950/30',
  }
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-medium border transition-all ${colorMap[color]}`}
    >
      {label}
      <span className={`px-1 rounded text-[10px] ${active ? 'bg-white/20' : 'bg-zinc-100 dark:bg-zinc-800'}`}>{count}</span>
    </button>
  )
}

function levelColor(l: string): string {
  switch (l) {
    case 'ERROR': return 'text-rose-600'
    case 'WARNING': return 'text-amber-600'
    case 'INFO': return 'text-emerald-600'
    case 'DEBUG': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}
