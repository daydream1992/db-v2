'use client'
import { TableMeta } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle, Activity, Database, CheckCircle2, Clock, TrendingUp, Zap, ArrowRight } from 'lucide-react'
import { ALERTS, PIPELINE_RUNS, ROW_TREND, TABLES } from '@/lib/dataops/mock-data'
import { formatRows, runStatusClass, runStatusDot } from '@/lib/dataops/styles'

export function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const totalTables = TABLES.length
  const greenTables = TABLES.filter(t => t.health === 'green').length
  const redTables = TABLES.filter(t => t.health === 'red').length
  const todayRuns = PIPELINE_RUNS.filter(r => r.startedAt.startsWith('2026-06-25'))
  const successRate = todayRuns.length > 0
    ? Math.round((todayRuns.filter(r => r.status === 'success').length / todayRuns.length) * 100)
    : 0
  const totalRows = TABLES.reduce((s, t) => s + t.rows, 0)
  const runningRun = PIPELINE_RUNS.find(r => r.status === 'running')

  // 执行时间线 (gantt)
  const timelineRuns = todayRuns.filter(r => r.durationSec && r.durationSec > 0).slice(0, 12)
  const minStart = Math.min(...timelineRuns.map(r => new Date(r.startedAt).getTime()))
  const maxEnd = Math.max(...timelineRuns.map(r => new Date(r.finishedAt!).getTime()))
  const totalSpan = maxEnd - minStart || 1

  return (
    <div className="space-y-6">
      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Database className="h-5 w-5" />}
          label="数据表总数"
          value={totalTables.toString()}
          sub={`${greenTables} 健康 · ${redTables} 异常`}
          tone="sky"
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          label="今日执行成功率"
          value={`${successRate}%`}
          sub={`${todayRuns.filter(r => r.status === 'success').length}/${todayRuns.length} 成功`}
          tone={successRate >= 90 ? 'emerald' : 'amber'}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="总行数"
          value={formatRows(totalRows)}
          sub="26 张表合计"
          tone="fuchsia"
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="待处理告警"
          value={ALERTS.length.toString()}
          sub={`${ALERTS.filter(a => a.level === 'red').length} 红 · ${ALERTS.filter(a => a.level === 'yellow').length} 黄`}
          tone={ALERTS.filter(a => a.level === 'red').length > 0 ? 'rose' : 'amber'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 执行时间线 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="h-4 w-4 text-sky-500" />
              今日执行时间线
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
                <span className="text-sky-700 dark:text-sky-300">{runningRun.table}</span>
                <span className="text-zinc-500 ml-auto">force={String(runningRun.force)}</span>
              </div>
            )}
            <div className="space-y-1.5">
              {timelineRuns.map(r => {
                const start = new Date(r.startedAt).getTime()
                const end = new Date(r.finishedAt!).getTime()
                const left = ((start - minStart) / totalSpan) * 100
                const width = ((end - start) / totalSpan) * 100
                return (
                  <div key={r.id} className="flex items-center gap-2 text-xs">
                    <div className="w-32 truncate text-zinc-600 dark:text-zinc-400">{r.table}</div>
                    <div className="flex-1 relative h-5 bg-zinc-100 dark:bg-zinc-800/60 rounded">
                      <div
                        className={`absolute top-0 h-5 rounded ${runStatusDot(r.status)}`}
                        style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                        title={`${r.table} ${r.startedAt.slice(11)} - ${r.finishedAt!.slice(11)} (${r.durationSec}s)`}
                      />
                      <span className="absolute right-1 top-0 leading-5 text-[10px] text-zinc-400">{r.durationSec}s</span>
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

      {/* 行数趋势 Top 表 */}
      <Card>
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
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full bg-fuchsia-200 dark:bg-fuchsia-900/50 rounded-t" style={{ height: `${h}%` }} />
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

function KpiCard({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: string; sub: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'fuchsia' }) {
  const toneMap = {
    sky: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40',
    fuchsia: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/40',
  }
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="text-xs text-zinc-500">{label}</div>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <div className="text-[11px] text-zinc-400">{sub}</div>
          </div>
          <div className={`p-2 rounded-lg ${toneMap[tone]}`}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  )
}

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
