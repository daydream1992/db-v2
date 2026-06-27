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
import { Search, FileText, Radio, Pause, Play, Trash2, Activity, Loader2, CheckCircle2, XCircle, Zap, Wifi, WifiOff } from 'lucide-react'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import { toast } from 'sonner'

export function LogsView() {
  // 静态历史日志
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string>('all')
  const [table, setTable] = useState<string>('all')
  const [liveMode, setLiveMode] = useState(true)

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

  const liveRefs = useRef<HTMLDivElement>(null)
  // 自动滚动到底部（live 模式）
  useEffect(() => {
    if (liveMode && liveRefs.current) {
      liveRefs.current.scrollTop = liveRefs.current.scrollHeight
    }
  }, [filtered.length, liveMode])

  const handleTrigger = (table: string) => {
    streamer.trigger(undefined, table)
    toast.success(`已触发实时执行：${table}`, { description: '观察下方日志流' })
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

      {/* 筛选栏 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input placeholder="搜索日志内容..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-mono text-sm" />
            </div>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="级别" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部级别</SelectItem>
                <SelectItem value="ERROR">ERROR</SelectItem>
                <SelectItem value="WARNING">WARNING</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
                <SelectItem value="DEBUG">DEBUG</SelectItem>
              </SelectContent>
            </Select>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="表" /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">全部表</SelectItem>
                {tables.map(t => <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="ml-auto">
              {filtered.length} / {allLogs.length}
              {liveMode && streamer.logs.length > 0 && <span className="ml-1 text-rose-500">·{streamer.logs.length} live</span>}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* 日志流 */}
      <Card>
        <CardHeader className="pb-3">
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
                return (
                  <div
                    key={l.id ?? i}
                    className={`flex gap-2 py-0.5 px-2 rounded ${
                      l.level === 'ERROR' ? 'bg-rose-50 dark:bg-rose-950/30' :
                      l.level === 'WARNING' ? 'bg-amber-50 dark:bg-amber-950/20' :
                      isLive ? 'bg-sky-50/50 dark:bg-sky-950/20' :
                      'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                    }`}
                  >
                    <span className="text-zinc-400 flex-shrink-0">{l.ts.slice(5)}</span>
                    <span className={`flex-shrink-0 w-16 font-bold ${levelColor(l.level)}`}>
                      {l.level}
                      {isLive && <span className="ml-1 text-rose-500">●</span>}
                    </span>
                    <span className="text-sky-600 dark:text-sky-400 flex-shrink-0 w-40 truncate">{l.table}</span>
                    <span className="text-zinc-700 dark:text-zinc-300 flex-1">{l.message}</span>
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

function levelColor(l: string): string {
  switch (l) {
    case 'ERROR': return 'text-rose-600'
    case 'WARNING': return 'text-amber-600'
    case 'INFO': return 'text-emerald-600'
    case 'DEBUG': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}
