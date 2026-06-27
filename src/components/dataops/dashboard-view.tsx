'use client'
import { TableMeta, DailyRunStat } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle, Activity, Database, CheckCircle2, Clock, TrendingUp, Zap, ArrowRight, Layers, Gauge, Cpu, HardDrive, Radio, Loader2, XCircle, Play, Pause, Terminal, Calendar, ArrowUpRight } from 'lucide-react'
import { ALERTS, PIPELINE_RUNS, ROW_TREND, TABLES, DAILY_STATS, INGEST_TREND, SCRIPT_DISTRIBUTION } from '@/lib/dataops/mock-data'
import { formatRows, runStatusClass, runStatusDot } from '@/lib/dataops/styles'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

type TimeRange = '7d' | '30d' | '90d'

// 根据时间范围生成缩放的 mock 数据
function genScaledStats(range: TimeRange): DailyRunStat[] {
  if (range === '7d') return DAILY_STATS
  const days = range === '30d' ? 30 : 90
  const result: DailyRunStat[] = []
  const baseDate = new Date('2026-06-25')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() - i)
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`
    const dayOfWeek = d.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    // 用周期性 mock 数据（基于日期 hash）
    const seed = (d.getDate() * 7 + d.getMonth() * 31) % 100
    const total = isWeekend ? 0 : 18 + (seed % 4)
    const failed = isWeekend ? 0 : (seed % 7 === 0 ? 1 : 0) + (seed % 11 === 0 ? 1 : 0)
    const skipped = isWeekend ? 0 : (seed % 5 === 0 ? 1 : 0)
    const success = total - failed - skipped
    const totalRows = isWeekend ? 0 : 3_200_000 + (seed * 47000) % 2_000_000
    const durationMin = isWeekend ? 0 : 38 + (seed % 12)
    result.push({ date: dateStr, success, failed, skipped, total, totalRows, durationMin })
  }
  return result
}

function genScaledIngest(range: TimeRange): { date: string; rows: number }[] {
  if (range === '7d') return INGEST_TREND
  const days = range === '30d' ? 30 : 90
  const result: { date: string; rows: number }[] = []
  const baseDate = new Date('2026-06-25')
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() - i)
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`
    const dayOfWeek = d.getDay()
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const seed = (d.getDate() * 13 + d.getMonth() * 7) % 100
    const rows = isWeekend ? 0 : 600_000 + (seed * 31000) % 3_500_000
    result.push({ date: dateStr, rows })
  }
  return result
}

export function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')

  const totalTables = TABLES.length
  const greenTables = TABLES.filter(t => t.health === 'green').length
  const redTables = TABLES.filter(t => t.health === 'red').length
  const yellowTables = TABLES.filter(t => t.health === 'yellow').length
  const todayRuns = PIPELINE_RUNS.filter(r => r.startedAt.startsWith('2026-06-25'))
  const successRate = todayRuns.length > 0
    ? Math.round((todayRuns.filter(r => r.status === 'success').length / todayRuns.length) * 100)
    : 0
  const totalRows = TABLES.reduce((s, t) => s + t.rows, 0)
  const runningRun = PIPELINE_RUNS.find(r => r.status === 'running')
  const todayStat = DAILY_STATS[DAILY_STATS.length - 1]

  // 时间范围相关数据
  const scaledStats = useMemo(() => genScaledStats(timeRange), [timeRange])
  const scaledIngest = useMemo(() => genScaledIngest(timeRange), [timeRange])
  const rangeSuccess = scaledStats.reduce((s, d) => s + d.success, 0)
  const rangeTotal = scaledStats.reduce((s, d) => s + d.total, 0)
  const rangeRate = rangeTotal > 0 ? Math.round((rangeSuccess / rangeTotal) * 100) : 0
  const rangeLabel = timeRange === '7d' ? '7日' : timeRange === '30d' ? '30日' : '90日'

  // 执行时间线 (gantt)
  const timelineRuns = todayRuns.filter(r => r.durationSec && r.durationSec > 0).slice(0, 12)
  const minStart = Math.min(...timelineRuns.map(r => new Date(r.startedAt).getTime()))
  const maxEnd = Math.max(...timelineRuns.map(r => new Date(r.finishedAt!).getTime()))
  const totalSpan = maxEnd - minStart || 1

  // Top 大表
  const topTables = [...TABLES].filter(t => t.rows > 0).sort((a, b) => b.rows - a.rows).slice(0, 6)

  return (
    <div className="space-y-6">
      {/* 时间范围选择器 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <Calendar className="h-3.5 w-3.5" />
          <span>统计区间</span>
        </div>
        <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
          {(['7d', '30d', '90d'] as TimeRange[]).map(r => (
            <button
              key={r}
              onClick={() => setTimeRange(r)}
              className={`px-3 py-1 text-xs rounded transition-all ${timeRange === r ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium text-zinc-900 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              {r === '7d' ? '近 7 天' : r === '30d' ? '近 30 天' : '近 90 天'}
            </button>
          ))}
        </div>
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Database className="h-5 w-5" />}
          label="数据表总数"
          value={totalTables.toString()}
          sub={`${greenTables} 健康 · ${redTables} 异常 · ${yellowTables} 待查`}
          tone="sky"
          spark={<Sparkline data={[20, 22, 22, 23, 25, 25, 26]} color="sky" />}
          onClick={() => onNavigate('health')}
          navigable
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label={`${rangeLabel}执行成功率`}
          value={`${rangeRate}%`}
          sub={`${rangeSuccess}/${rangeTotal} 成功 · 今日 ${successRate}%`}
          tone={rangeRate >= 90 ? 'emerald' : 'amber'}
          spark={<Sparkline data={scaledStats.slice(-7).map(d => d.total > 0 ? Math.round((d.success / d.total) * 100) : 0)} color={rangeRate >= 90 ? 'emerald' : 'amber'} />}
          popover={<SuccessRatePopover stats={scaledStats} onNavigate={onNavigate} />}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={`${rangeLabel}入库行数`}
          value={formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0))}
          sub={`日均 ${formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0) / scaledIngest.filter(d => d.rows > 0).length || 1)}`}
          tone="fuchsia"
          spark={<Sparkline data={scaledIngest.slice(-7).map(d => Math.round(d.rows / 1000000 * 10) / 10)} color="fuchsia" suffix="M" />}
          popover={<IngestRowsPopover onNavigate={onNavigate} />}
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="待处理告警"
          value={ALERTS.length.toString()}
          sub={`${ALERTS.filter(a => a.level === 'red').length} 红 · ${ALERTS.filter(a => a.level === 'yellow').length} 黄`}
          tone={ALERTS.filter(a => a.level === 'red').length > 0 ? 'rose' : 'amber'}
          spark={<Sparkline data={[3, 4, 5, 6, 7, 8, 8]} color="rose" />}
          onClick={() => onNavigate('lint')}
          navigable
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 执行时间线 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-sky-500" />
              今日执行时间线
              <Badge variant="outline" className="text-[10px] ml-1">{todayRuns.length} 次</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('orchestration')}>
              查看全部 <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent>
            {runningRun && (
              <div className="mb-3 p-2 rounded-md bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sm flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                <span className="font-medium text-sky-700 dark:text-sky-300">运行中：</span>
                <span className="text-sky-700 dark:text-sky-300 font-mono">{runningRun.table}</span>
                <span className="text-zinc-500 ml-auto text-xs">force={String(runningRun.force)} · 已运行 {Math.floor((Date.now() - new Date(runningRun.startedAt).getTime()) / 1000)}s</span>
              </div>
            )}
            <div className="space-y-1.5">
              {timelineRuns.map(r => {
                const start = new Date(r.startedAt).getTime()
                const end = new Date(r.finishedAt!).getTime()
                const left = ((start - minStart) / totalSpan) * 100
                const width = ((end - start) / totalSpan) * 100
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs group">
                    <div className="w-32 truncate text-zinc-600 dark:text-zinc-400 font-mono text-[11px]">{r.table}</div>
                    <div className="flex-1 relative h-5 bg-zinc-100 dark:bg-zinc-800/60 rounded">
                      <div
                        className={`absolute top-0 h-5 rounded ${runStatusDot(r.status)} transition-all group-hover:brightness-110`}
                        style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                        title={`${r.table} ${r.startedAt.slice(11)} - ${r.finishedAt!.slice(11)} (${r.durationSec}s)`}
                      />
                      <span className="absolute right-1 top-0 leading-5 text-[10px] text-zinc-400 font-mono">{r.durationSec}s</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 成功</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> 失败</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-300" /> 跳过</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" /> 运行中</span>
              <span className="ml-auto text-zinc-400">日耗时 {todayStat.durationMin}min</span>
            </div>
          </CardContent>
        </Card>

        {/* 告警列表 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              待处理告警
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('lint')}>规范</Button>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px] pr-3">
              <div className="space-y-2">
                {ALERTS.map(a => (
                  <div key={a.id} className={`p-2.5 rounded-md border text-xs ${a.level === 'red' ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30' : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`h-2 w-2 rounded-full ${a.level === 'red' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                      <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{a.table}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] py-0 px-1.5">{a.type}</Badge>
                    </div>
                    <div className="text-zinc-600 dark:text-zinc-400 leading-relaxed">{a.message}</div>
                    <div className="text-[10px] text-zinc-400 mt-1 flex items-center gap-1"><Clock className="h-3 w-3" />{a.ts}</div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 第二行：成功率环形图 + 入库趋势 + Top 表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 7日成功率环形图 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-500" />
              {rangeLabel}执行成功率
              <Badge variant="outline" className="text-[10px] ml-1">{scaledStats.length} 天</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <DonutChart
                value={rangeRate}
                size={120}
                label={`${rangeRate}%`}
                subLabel={rangeLabel}
              />
              <div className="flex-1 space-y-1 text-xs max-h-[140px] overflow-y-auto pr-1">
                {scaledStats.slice().reverse().slice(0, timeRange === '7d' ? 7 : 12).map(d => (
                  <div key={d.date} className="flex items-center gap-2">
                    <span className="w-10 text-zinc-500 font-mono text-[10px] flex-shrink-0">{d.date}</span>
                    <div className="flex-1 h-2 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${d.total === 0 ? 'bg-zinc-200' : d.failed > 0 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                        style={{ width: d.total === 0 ? '0%' : `${(d.success / d.total) * 100}%` }}
                      />
                    </div>
                    <span className="w-16 text-right font-mono text-zinc-500 text-[10px]">
                      {d.total === 0 ? '—' : `${d.success}/${d.total}`}
                    </span>
                  </div>
                ))}
                {timeRange !== '7d' && (
                  <div className="text-[10px] text-zinc-400 text-center pt-1">显示最近 12 天 · 共 {scaledStats.length} 天</div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 入库行数趋势 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-fuchsia-500" />
              {rangeLabel}入座行数趋势
            </CardTitle>
          </CardHeader>
          <CardContent>
            <AreaChart data={scaledIngest} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">{rangeLabel}累计</div>
                <div className="font-mono font-semibold text-sm">{formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0))}</div>
              </div>
              <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">日均</div>
                <div className="font-mono font-semibold text-sm">{formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0) / (scaledIngest.filter(d => d.rows > 0).length || 1))}</div>
              </div>
              <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">峰值</div>
                <div className="font-mono font-semibold text-sm text-fuchsia-600">{formatRows(Math.max(...scaledIngest.map(d => d.rows)))}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top 大表 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Layers className="h-4 w-4 text-sky-500" />
              Top 6 大表
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topTables.map((t, i) => {
                const maxRows = topTables[0].rows
                const pct = (t.rows / maxRows) * 100
                return (
                  <button
                    key={t.table}
                    onClick={() => onNavigate('catalog')}
                    className="w-full text-left group"
                  >
                    <div className="flex items-center gap-2 text-xs mb-1">
                      <span className="text-zinc-400 font-mono w-4">#{i + 1}</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300 group-hover:text-sky-600 dark:group-hover:text-sky-400 truncate flex-1">{t.table}</span>
                      <span className="font-mono text-zinc-500 text-[11px]">{formatRows(t.rows)}</span>
                    </div>
                    <div className="ml-6 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${i === 0 ? 'bg-sky-500' : i === 1 ? 'bg-sky-400' : 'bg-sky-300 dark:bg-sky-700'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 第三行：行数趋势 Top + 脚本规模分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-fuchsia-500" />
              行数趋势 · 大表 Top
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {ROW_TREND.map(rt => {
                const max = Math.max(...rt.days.map(d => d.rows))
                const min = Math.min(...rt.days.map(d => d.rows))
                const range = max - min || 1
                return (
                  <div key={rt.table}>
                    <div className="flex items-baseline justify-between mb-2">
                      <span className="font-mono text-sm font-medium">{rt.table}</span>
                      <span className="text-xs text-zinc-500">{formatRows(max)}</span>
                    </div>
                    <div className="flex items-end gap-1 h-16">
                      {rt.days.map(d => {
                        const h = ((d.rows - min) / range) * 70 + 25
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group cursor-pointer">
                            <div className="w-full bg-fuchsia-200 dark:bg-fuchsia-900/50 rounded-t group-hover:bg-fuchsia-400 dark:group-hover:bg-fuchsia-600 transition-colors" style={{ height: `${h}%` }} title={`${formatRows(d.rows)} 行`} />
                            <span className="text-[9px] text-zinc-400">{d.date}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* 脚本规模分布 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Cpu className="h-4 w-4 text-amber-500" />
              脚本规模分布
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {SCRIPT_DISTRIBUTION.map(s => {
                const maxLines = Math.max(...SCRIPT_DISTRIBUTION.map(x => x.totalLines))
                const pct = (s.totalLines / maxLines) * 100
                return (
                  <div key={s.dir}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono">{s.dir}</span>
                      <span className="text-zinc-500">{s.tables} 表 · {s.totalLines} 行</span>
                    </div>
                    <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                      <div
                        className={`h-full rounded ${
                          s.dir === '1_入库' ? 'bg-sky-500' :
                          s.dir === '2_计算' ? 'bg-fuchsia-500' :
                          s.dir === '3_策略' ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-3 border-t grid grid-cols-2 gap-3 text-xs">
              <div className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-zinc-500">总行数</span>
                <span className="font-mono font-medium ml-auto">{SCRIPT_DISTRIBUTION.reduce((s, d) => s + d.totalLines, 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Database className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-zinc-500">总表数</span>
                <span className="font-mono font-medium ml-auto">{SCRIPT_DISTRIBUTION.reduce((s, d) => s + d.tables, 0)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 实时执行流 */}
      <LiveStreamCard onNavigate={onNavigate} />

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickAction icon={<Zap className="h-4 w-4" />} label="立即执行" desc="手动触发某表" onClick={() => onNavigate('orchestration')} />
        <QuickAction icon={<Activity className="h-4 w-4" />} label="健康度" desc="红绿灯矩阵" onClick={() => onNavigate('health')} />
        <QuickAction icon={<CheckCircle2 className="h-4 w-4" />} label="规范校验" desc="12 条规则" onClick={() => onNavigate('lint')} />
        <QuickAction icon={<Database className="h-4 w-4" />} label="数据字典" desc="字段级元数据" onClick={() => onNavigate('dictionary')} />
      </div>
    </div>
  )
}

// --- 子组件：实时执行流 ---
function LiveStreamCard({ onNavigate }: { onNavigate: (v: string) => void }) {
  const streamer = useLogStreamer()
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streamer.logs.length])

  const handleTrigger = (table: string) => {
    streamer.trigger(undefined, table)
    toast.success(`已触发：${table}`, { description: '观察实时日志流' })
  }

  return (
    <Card className="border-sky-200/50 dark:border-sky-900/40 overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Radio className={`h-4 w-4 ${streamer.currentRun?.status === 'running' ? 'text-rose-500 animate-pulse' : 'text-sky-500'}`} />
            实时执行流
            {streamer.connected && (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 ml-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" /> 已连接 :3003
              </Badge>
            )}
            {streamer.currentRun && (
              <Badge variant="outline" className={`text-[10px] ml-1 ${
                streamer.currentRun.status === 'running' ? 'text-sky-600 border-sky-300' :
                streamer.currentRun.status === 'success' ? 'text-emerald-600 border-emerald-300' :
                'text-rose-600 border-rose-300'
              }`}>
                {streamer.currentRun.status === 'running' && <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />}
                {streamer.currentRun.status === 'success' && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                {streamer.currentRun.status === 'failed' && <XCircle className="h-3 w-3 mr-0.5" />}
                {streamer.currentRun.table} · {streamer.currentRun.progress ?? 0}%
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {streamer.currentRun?.status === 'running' ? (
              <Button size="sm" variant="outline" className="h-7 text-xs text-rose-600 hover:text-rose-700" onClick={() => streamer.cancel()}>
                <Pause className="h-3 w-3 mr-1" /> 取消
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => streamer.triggerDaily()}
                disabled={!!streamer.currentRun}
                title="触发 daily 全量执行"
              >
                <Play className="h-3 w-3 mr-1" /> 触发 daily
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onNavigate('logs')}>
              <Terminal className="h-3 w-3 mr-1" /> 完整日志
            </Button>
          </div>
        </div>
        {/* 进度条 */}
        {streamer.currentRun?.status === 'running' && (
          <div className="mt-2 h-1 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-500 via-fuchsia-500 to-rose-500 transition-all duration-300"
              style={{ width: `${streamer.currentRun.progress ?? 0}%` }}
            />
          </div>
        )}
        {streamer.dailyProgress && (
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <Zap className="h-3 w-3 text-amber-500" />
            <span className="text-zinc-500">daily 全量</span>
            <div className="flex-1 max-w-[200px] h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
              <div className="h-full bg-amber-500 transition-all" style={{ width: `${(streamer.dailyProgress.completed / streamer.dailyProgress.total) * 100}%` }} />
            </div>
            <span className="font-mono text-zinc-400">{streamer.dailyProgress.completed}/{streamer.dailyProgress.total}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* 日志流 */}
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/40 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-100/50 dark:bg-zinc-900/50 flex items-center gap-2">
              <Terminal className="h-3 w-3 text-zinc-400" />
              <span className="text-[11px] font-mono text-zinc-500">logs/run_live.log</span>
              {streamer.logs.length > 0 && (
                <Badge variant="outline" className="ml-auto text-[9px] text-rose-600 border-rose-300 py-0">
                  <span className="h-1 w-1 rounded-full bg-rose-500 animate-pulse mr-1" /> LIVE · {streamer.logs.length}
                </Badge>
              )}
            </div>
            <div className="h-[240px] overflow-y-auto font-mono text-[11px] p-2 space-y-0">
              {streamer.logs.length === 0 && (
                <div className="py-12 text-center text-zinc-400">
                  <Terminal className="h-6 w-6 mx-auto opacity-40 mb-2" />
                  <div className="text-xs">点击右侧剧本触发实时执行</div>
                  <div className="text-[10px] mt-1">或点击「触发 daily」执行全量</div>
                </div>
              )}
              {streamer.logs.slice(-80).map(l => (
                <div
                  key={l.id}
                  className={`flex gap-2 px-1.5 py-0.5 rounded ${
                    l.level === 'ERROR' ? 'bg-rose-50 dark:bg-rose-950/30' :
                    l.level === 'WARNING' ? 'bg-amber-50 dark:bg-amber-950/20' :
                    l.level === 'INFO' && l.message.startsWith('✔') ? 'bg-emerald-50/50 dark:bg-emerald-950/20' :
                    ''
                  }`}
                >
                  <span className="text-zinc-400 flex-shrink-0">{l.ts.slice(11)}</span>
                  <span className={`flex-shrink-0 w-14 font-bold ${
                    l.level === 'ERROR' ? 'text-rose-600' :
                    l.level === 'WARNING' ? 'text-amber-600' :
                    l.level === 'INFO' ? 'text-emerald-600' :
                    'text-zinc-400'
                  }`}>{l.level}</span>
                  <span className="text-sky-600 dark:text-sky-400 flex-shrink-0 w-32 truncate">{l.table}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 flex-1">{l.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 可触发剧本 */}
          <div className="rounded-md border border-zinc-200 dark:border-zinc-800 p-2">
            <div className="text-[11px] text-zinc-500 mb-1.5 flex items-center gap-1">
              <Zap className="h-3 w-3" /> 可触发剧本 ({streamer.scripts.length})
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
              {streamer.scripts.map(s => {
                const isRunning = streamer.currentRun?.table === s.table
                return (
                  <button
                    key={s.idx}
                    onClick={() => handleTrigger(s.table)}
                    disabled={!!streamer.currentRun}
                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-mono border transition-all flex items-center gap-1.5 ${
                      isRunning
                        ? 'border-sky-400 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={`${s.cn} · ${s.steps} 步日志`}
                  >
                    {isRunning ? <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" /> : <Play className="h-3 w-3 flex-shrink-0 opacity-50" />}
                    <span className="truncate flex-1">{s.table}</span>
                    <span className="text-zinc-400 text-[10px]">{s.cn}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// --- 子组件：KPI 卡片 ---
function KpiCard({ icon, label, value, sub, tone, spark, onClick, popover, navigable }: {
  icon: React.ReactNode; label: string; value: string; sub: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'fuchsia'; spark?: React.ReactNode
  onClick?: () => void; popover?: ReactNode; navigable?: boolean
}) {
  const toneMap = {
    sky: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40',
    fuchsia: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/40',
  }
  const isClickable = !!onClick || !!popover

  const cardInner = (
    <Card className={`overflow-hidden group hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 animate-stagger-in ${
      isClickable ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-sky-200 dark:focus-visible:ring-sky-800 outline-none' : ''
    }`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1 flex-1 min-w-0">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="text-2xl font-semibold tracking-tight animate-count-up">{value}</div>
            <div className="text-[11px] text-zinc-400 truncate">{sub}</div>
          </div>
          <div className="flex items-center gap-1">
            {navigable && (
              <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            )}
            <div className={`p-2 rounded-lg ${toneMap[tone]} group-hover:scale-110 transition-transform`}>{icon}</div>
          </div>
        </div>
        {spark && <div className="mt-3 -mb-1">{spark}</div>}
      </CardContent>
    </Card>
  )

  // If popover is provided, wrap in Popover
  if (popover) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          {cardInner}
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0 animate-scale-fade-in" side="bottom" align="center">
          {popover}
        </PopoverContent>
      </Popover>
    )
  }

  // If onClick is provided, make clickable
  if (onClick) {
    return (
      <div onClick={onClick} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onClick() }}>
        {cardInner}
      </div>
    )
  }

  return cardInner
}

// --- 子组件：执行成功率 Popover ---
function SuccessRatePopover({ stats, onNavigate }: { stats: DailyRunStat[]; onNavigate: (v: string) => void }) {
  const last7 = stats.slice(-7)
  return (
    <div>
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-xs font-medium">每日执行成功率</span>
        <Badge variant="outline" className="text-[9px] ml-auto">近 7 天</Badge>
      </div>
      <div className="p-2">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
              <th className="py-1.5 px-2 text-left font-medium">日期</th>
              <th className="py-1.5 px-2 text-right font-medium">成功/总数</th>
              <th className="py-1.5 px-2 text-right font-medium">率%</th>
            </tr>
          </thead>
          <tbody>
            {last7.map(d => {
              const rate = d.total > 0 ? Math.round((d.success / d.total) * 100) : 0
              const colorClass = rate === 100 ? 'text-emerald-600 dark:text-emerald-400' : rate >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'
              return (
                <tr key={d.date} className="border-b border-zinc-50 dark:border-zinc-800/50 last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                  <td className="py-1.5 px-2 font-mono">{d.date}</td>
                  <td className="py-1.5 px-2 text-right font-mono">{d.total === 0 ? '—' : `${d.success}/${d.total}`}</td>
                  <td className={`py-1.5 px-2 text-right font-mono font-semibold ${d.total === 0 ? 'text-zinc-400' : colorClass}`}>
                    {d.total === 0 ? '—' : `${rate}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => onNavigate('orchestration')}
          className="text-[11px] text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 flex items-center gap-1 transition-colors"
        >
          点击查看更多 <ArrowRight className="h-3 w-3" /> 编排
        </button>
      </div>
    </div>
  )
}

// --- 子组件：入库行数 Popover ---
function IngestRowsPopover({ onNavigate }: { onNavigate: (v: string) => void }) {
  const top5 = [...TABLES].filter(t => t.rows > 0).sort((a, b) => b.rows - a.rows).slice(0, 5)
  const maxRows = top5[0]?.rows ?? 1
  return (
    <div>
      <div className="px-3 py-2 border-b border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-fuchsia-500" />
        <span className="text-xs font-medium">Top 5 大表</span>
        <Badge variant="outline" className="text-[9px] ml-auto">按行数</Badge>
      </div>
      <div className="p-2 space-y-2">
        {top5.map((t, i) => {
          const pct = (t.rows / maxRows) * 100
          return (
            <div key={t.table}>
              <div className="flex items-center justify-between text-[11px] mb-0.5">
                <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1">{t.table}</span>
                <span className="font-mono text-zinc-500 ml-2">{formatRows(t.rows)}</span>
              </div>
              <div className="h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded overflow-hidden">
                <div
                  className={`h-full rounded ${
                    i === 0 ? 'bg-fuchsia-500' : i === 1 ? 'bg-fuchsia-400' : 'bg-fuchsia-300 dark:bg-fuchsia-700'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => onNavigate('catalog')}
          className="text-[11px] text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 flex items-center gap-1 transition-colors"
        >
          点击查看更多 <ArrowRight className="h-3 w-3" /> 目录
        </button>
      </div>
    </div>
  )
}

// --- 子组件：Sparkline（小折线/柱线）---
function Sparkline({ data, color, suffix }: { data: number[]; color: 'sky' | 'emerald' | 'amber' | 'rose' | 'fuchsia'; suffix?: string }) {
  const colorMap = {
    sky: 'stroke-sky-500',
    emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500',
    rose: 'stroke-rose-500',
    fuchsia: 'stroke-fuchsia-500',
  }
  const fillMap = {
    sky: 'fill-sky-500/10',
    emerald: 'fill-emerald-500/10',
    amber: 'fill-amber-500/10',
    rose: 'fill-rose-500/10',
    fuchsia: 'fill-fuchsia-500/10',
  }
  const w = 200
  const h = 32
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const step = w / (data.length - 1)
  const points = data.map((v, i) => `${i * step},${h - ((v - min) / range) * (h - 4) - 2}`)
  const path = `M ${points.join(' L ')}`
  const areaPath = `${path} L ${w},${h} L 0,${h} Z`
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-8" preserveAspectRatio="none">
      <path d={areaPath} className={fillMap[color]} />
      <path d={path} fill="none" className={`${colorMap[color]} stroke-1.5`} strokeLinecap="round" strokeLinejoin="round" />
      {data.map((v, i) => (
        <circle key={i} cx={i * step} cy={h - ((v - min) / range) * (h - 4) - 2} r={i === data.length - 1 ? 2 : 0} className={colorMap[color].replace('stroke', 'fill')} />
      ))}
      {suffix && data[data.length - 1] > 0 && (
        <text x={w - 2} y={10} textAnchor="end" className="fill-zinc-400 text-[8px] font-mono">{data[data.length - 1]}{suffix}</text>
      )}
    </svg>
  )
}

// --- 子组件：环形图 ---
function DonutChart({ value, size, label, subLabel }: { value: number; size: number; label: string; subLabel: string }) {
  const radius = size / 2 - 8
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  const color = value >= 95 ? '#10b981' : value >= 80 ? '#f59e0b' : '#f43f5e'
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-800" strokeWidth={6} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-bold" style={{ color }}>{label}</div>
        <div className="text-[10px] text-zinc-400">{subLabel}</div>
      </div>
    </div>
  )
}

// --- 子组件：区域图 ---
function AreaChart({ data }: { data: { date: string; rows: number }[] }) {
  const w = 320
  const h = 100
  const padding = 4
  const max = Math.max(...data.map(d => d.rows), 1)
  const step = data.length > 1 ? (w - padding * 2) / (data.length - 1) : 0
  const points = data.map((d, i) => `${padding + i * step},${h - padding - (d.rows / max) * (h - padding * 2 - 16)}`)
  const linePath = `M ${points.join(' L ')}`
  const areaPath = `${linePath} L ${padding + (data.length - 1) * step},${h - padding} L ${padding},${h - padding} Z`
  // 大数据集时稀疏化标签和圆点
  const labelInterval = data.length > 60 ? 15 : data.length > 20 ? 7 : data.length > 10 ? 3 : 1
  const showDots = data.length <= 30
  const dotR = data.length > 15 ? 1.5 : 2.5
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-24" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ingest-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d946ef" stopOpacity={0.4} />
          <stop offset="100%" stopColor="#d946ef" stopOpacity={0.05} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill="url(#ingest-grad)" />
      <path d={linePath} fill="none" stroke="#d946ef" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          {showDots && d.rows > 0 && (
            <circle cx={padding + i * step} cy={h - padding - (d.rows / max) * (h - padding * 2 - 16)} r={dotR} fill="#d946ef" />
          )}
          {i % labelInterval === 0 && (
            <text x={padding + i * step} y={h - 2} textAnchor="middle" className="fill-zinc-400 text-[8px] font-mono">{d.date}</text>
          )}
        </g>
      ))}
    </svg>
  )
}

// --- 子组件：快捷入口 ---
function QuickAction({ icon, label, desc, onClick }: { icon: React.ReactNode; label: string; desc: string; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-auto py-3 justify-start text-left" onClick={onClick}>
      <div className="flex items-center gap-3">
        <div className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{icon}</div>
        <div>
          <div className="text-sm font-medium">{label}</div>
          <div className="text-[11px] text-zinc-400">{desc}</div>
        </div>
      </div>
    </Button>
  )
}
