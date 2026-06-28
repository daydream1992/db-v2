'use client'
import { useState, useMemo, useCallback } from 'react'
import { PIPELINE_RUNS, SCHEDULES, TABLES, PipelineRun } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RunDetailSheet } from './run-detail-sheet'
import { Play, Clock, CheckCircle2, XCircle, SkipForward, Loader2, Calendar, GitBranch, ChevronRight, ArrowDown, Activity } from 'lucide-react'
import { formatDuration, formatRows, runStatusClass, triggerClass } from '@/lib/dataops/styles'

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

const STATUS_BAR_COLOR: Record<string, { fill: string; stroke: string; text: string }> = {
  success: { fill: '#10b981', stroke: '#059669', text: '#fff' },
  failed:  { fill: '#f43f5e', stroke: '#e11d48', text: '#fff' },
  running: { fill: '#38bdf8', stroke: '#0ea5e9', text: '#fff' },
  skipped: { fill: '#a1a1aa', stroke: '#71717a', text: '#fff' },
  pending: { fill: '#d4d4d8', stroke: '#a1a1aa', text: '#71717a' },
}

interface GanttTooltip {
  run: PipelineRun
  x: number
  y: number
}

export function OrchestrationView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [tab, setTab] = useState<'history' | 'dag' | 'schedules'>('history')
  const [selectedRun, setSelectedRun] = useState<PipelineRun | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const openDetail = (run: PipelineRun) => {
    setSelectedRun(run)
    setDetailOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 w-fit">
        {([['history', '执行历史'], ['dag', 'DAG 依赖图'], ['schedules', '调度计划']] as const).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${tab === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === 'history' && <HistoryView onRunTable={onRunTable} onOpenDetail={openDetail} />}
      {tab === 'dag' && <DagView />}
      {tab === 'schedules' && <SchedulesView />}

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

  const { runs, minTs, maxTs, totalSpan, timeLabels } = useMemo(() => {
    // Filter today's runs (all PIPELINE_RUNS are from today in mock)
    const runs = [...PIPELINE_RUNS]

    // Calculate time range
    const starts = runs.map(r => parseTs(r.startedAt))
    const ends = runs.map(r => r.finishedAt ? parseTs(r.finishedAt) : parseTs(r.startedAt) + 30 * 60 * 1000) // running: +30min estimate
    const rawMin = Math.min(...starts)
    const rawMax = Math.max(...ends)
    const span = rawMax - rawMin
    const padding = span * 0.05
    const minTs = rawMin - padding
    const maxTs = rawMax + padding
    const totalSpan = maxTs - minTs

    // Generate time labels every 10 minutes
    const labels: { ts: number; label: string }[] = []
    const interval = 10 * 60 * 1000 // 10 min
    const firstTick = Math.ceil(minTs / interval) * interval
    for (let t = firstTick; t <= maxTs; t += interval) {
      labels.push({ ts: t, label: fmtTime(t) })
    }

    return { runs, minTs, maxTs, totalSpan, timeLabels: labels }
  }, [])

  // SVG layout constants
  const LABEL_W = 140
  const CHART_RIGHT = 40
  const ROW_H = 28
  const BAR_H = 20
  const BAR_Y_OFFSET = (ROW_H - BAR_H) / 2
  const HEADER_H = 24
  const SVG_W = 1100
  const CHART_W = SVG_W - LABEL_W - CHART_RIGHT
  const SVG_H = HEADER_H + runs.length * ROW_H + 8

  const toX = useCallback((ts: number) => ((ts - minTs) / totalSpan) * CHART_W, [minTs, totalSpan, CHART_W])

  const handleBarClick = (run: PipelineRun) => {
    setTooltip(null)
    onOpenDetail(run)
  }

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
              {fmtTime(minTs + (maxTs - minTs) * 0.05)} → {fmtTime(maxTs - (maxTs - minTs) * 0.05)} · {runs.length} 次执行
            </span>
            <span className="flex items-center gap-1.5 ml-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" /> success
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500 ml-1.5" /> failed
              <span className="inline-block h-2 w-2 rounded-full bg-sky-400 ml-1.5" /> running
              <span className="inline-block h-2 w-2 rounded-full bg-zinc-400 ml-1.5" /> skipped
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
          <svg
            viewBox={`0 0 ${SVG_W} ${SVG_H}`}
            className="w-full min-w-[700px]"
            style={{ height: Math.max(SVG_H, 100) }}
          >
            {/* Grid lines */}
            {timeLabels.map(tl => {
              const x = LABEL_W + toX(tl.ts)
              return (
                <line
                  key={tl.ts}
                  x1={x} y1={HEADER_H}
                  x2={x} y2={SVG_H - 4}
                  stroke="currentColor"
                  className="text-zinc-200 dark:text-zinc-800"
                  strokeWidth={1}
                  strokeDasharray="3,3"
                />
              )
            })}

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
                >
                  {tl.label}
                </text>
              )
            })}

            {/* Rows */}
            {runs.map((run, i) => {
              const startTs = parseTs(run.startedAt)
              const endTs = run.finishedAt
                ? parseTs(run.finishedAt)
                : parseTs(run.startedAt) + Math.max((run.durationSec ?? 30) * 1000, 30 * 60 * 1000)
              const barX = LABEL_W + toX(startTs)
              const rawBarW = ((endTs - startTs) / totalSpan) * CHART_W
              const barW = Math.max(rawBarW, CHART_W * 0.02) // min 2% for visibility
              const barY = HEADER_H + i * ROW_H + BAR_Y_OFFSET
              const isRunning = run.status === 'running'
              const isFailed = run.status === 'failed'
              const colors = STATUS_BAR_COLOR[run.status] || STATUS_BAR_COLOR.pending
              const isHovered = hoveredId === run.id
              const durLabel = run.durationSec !== null ? formatDuration(run.durationSec) : '…'
              const showLabelInside = barW > 80

              return (
                <g
                  key={run.id}
                  onMouseEnter={() => setHoveredId(run.id)}
                  onMouseLeave={() => { setHoveredId(null); setTooltip(null) }}
                  onMouseMove={(e) => {
                    const rect = (e.currentTarget as SVGGElement).closest('svg')?.getBoundingClientRect()
                    if (rect) {
                      setTooltip({
                        run,
                        x: e.clientX - rect.left,
                        y: e.clientY - rect.top,
                      })
                    }
                  }}
                  onClick={() => handleBarClick(run)}
                  className="cursor-pointer"
                >
                  {/* Row background on hover */}
                  {isHovered && (
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
                  {isHovered && (
                    <rect
                      x={barX + 1} y={barY + 1}
                      width={barW} height={BAR_H}
                      className="fill-black/10 dark:fill-black/30"
                      rx={5}
                    />
                  )}

                  {/* Bar */}
                  <rect
                    x={barX} y={barY}
                    width={barW} height={BAR_H}
                    fill={isRunning ? 'url(#runningGrad)' : colors.fill}
                    stroke={colors.stroke}
                    strokeWidth={isHovered ? 1.5 : 0.5}
                    rx={4}
                    opacity={isHovered ? 1 : 0.9}
                    style={{ filter: isHovered ? 'brightness(1.15)' : undefined, transition: 'filter 0.15s' }}
                  />

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
                <stop offset="0%" stopColor="#38bdf8" />
                <stop offset="100%" stopColor="#0ea5e9" />
              </linearGradient>
              <linearGradient id="runningPulse" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.8} />
                <stop offset="50%" stopColor="#38bdf8" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.8} />
                <animate attributeName="x1" values="0%;100%;0%" dur="2s" repeatCount="indefinite" />
              </linearGradient>
            </defs>
          </svg>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="absolute z-50 pointer-events-none rounded-lg border bg-card p-2.5 shadow-lg text-[11px] max-w-[260px]"
              style={{ left: Math.min(tooltip.x + 12, 600), top: tooltip.y + 12 }}
            >
              <div className="font-medium font-mono text-xs mb-1">{tooltip.run.table}</div>
              <div className="flex items-center gap-1 mb-1">
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${tooltip.run.status === 'success' ? 'bg-emerald-500' : tooltip.run.status === 'failed' ? 'bg-rose-500' : tooltip.run.status === 'running' ? 'bg-sky-400' : 'bg-zinc-400'}`} />
                <span className="capitalize">{tooltip.run.status}</span>
              </div>
              <div className="text-zinc-500 font-mono">
                {fmtTimeFull(parseTs(tooltip.run.startedAt))} → {tooltip.run.finishedAt ? fmtTimeFull(parseTs(tooltip.run.finishedAt)) : '…'}
              </div>
              <div className="text-zinc-500">耗时: {tooltip.run.durationSec !== null ? formatDuration(tooltip.run.durationSec) : '运行中'}</div>
              {tooltip.run.rowsIn !== null && <div className="text-zinc-500">行数: {formatRows(tooltip.run.rowsIn)}</div>}
              {tooltip.run.error && <div className="text-rose-500 mt-0.5">⚠ {tooltip.run.error}</div>}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function HistoryView({ onRunTable, onOpenDetail }: { onRunTable?: (t: string) => void; onOpenDetail: (r: PipelineRun) => void }) {
  return (
    <div className="space-y-4">
      <GanttTimeline onOpenDetail={onOpenDetail} />
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
              <div className="grid grid-cols-[50px_1fr_90px_90px_140px_70px_90px_1fr_30px] gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
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
              {PIPELINE_RUNS.map(r => (
                <button
                  key={r.id}
                  onClick={() => onOpenDetail(r)}
                  className="w-full grid grid-cols-[50px_1fr_90px_90px_140px_70px_90px_1fr_30px] gap-2 px-3 py-2 text-xs items-center border-b last:border-0 hover:bg-sky-50/50 dark:hover:bg-sky-950/20 text-left transition-colors group"
                >
                  <div className="font-mono text-zinc-400">{r.id}</div>
                  <div className="font-mono truncate" title={r.table}>{r.table}</div>
                  <div><Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${triggerClass(r.trigger)}`}>{r.trigger}</Badge></div>
                  <div><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${runStatusClass(r.status)}`}>
                    {r.status === 'success' && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                    {r.status === 'failed' && <XCircle className="h-3 w-3 mr-0.5" />}
                    {r.status === 'skipped' && <SkipForward className="h-3 w-3 mr-0.5" />}
                    {r.status === 'running' && <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />}
                    {r.status}
                  </span></div>
                  <div className="font-mono text-[11px] text-zinc-500">{r.startedAt.slice(5)}</div>
                  <div className="text-right font-mono text-zinc-500">{formatDuration(r.durationSec)}</div>
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

  const layers: { name: string; desc: string; tables: string[] }[] = [
    { name: '外部数据源', desc: 'TQ API / TDX 二进制 / 文本', tables: ['TQ API', 'TDX .day', 'TDX .lc5', 'TDX .lc1', 'TDX gpsz', 'TDX signals'] },
    { name: 'L1 基础入库', desc: '17 个采集脚本，外部源 → DuckDB', tables: ['trading_calendar', 'stock_daily_kline', 'stock_kline_5m', 'stock_kline_1m', 'capital_info', 'stock_financial_data', 'sjb_api_plhqL2kz_88zd', 'stock_block_relation', 'market_sc1_42', 'stock_gp1_46_indicators', 'stock_signals_20001_20011', 'stock_industry_3level'] },
    { name: 'L2 派生计算', desc: '9 个 SQL 派生脚本', tables: ['stock_kline_15m', 'stock_kline_30m', 'stock_kline_60m', 'stock_kline_weekly', 'stock_kline_monthly', 'stock_daily_turnover', 'dim_security_type', 'dim_industry_code', 'pianpao_daily'] },
    { name: 'L3 聚合视图', desc: '多表产物 / 汇总', tables: ['pianpao_daily_summary', 'dim_gp_indicator'] },
  ]
  const healthOf = (name: string) => TABLES.find(t => t.table === name)?.health || 'external'

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-fuchsia-500" />
          DAG 依赖图（拓扑分层 · 可悬停查看）
        </CardTitle>
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
                </div>
                <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                  {layer.tables.map(t => {
                    const h = healthOf(t)
                    const isExternal = h === 'external'
                    const isHovered = hovered === t
                    return (
                      <div
                        key={t}
                        onMouseEnter={() => setHovered(t)}
                        onMouseLeave={() => setHovered(null)}
                        className={`px-2.5 py-1.5 rounded-md border text-xs font-mono cursor-default transition-all ${
                          h === 'green' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300' :
                          h === 'red' ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 text-rose-700 dark:text-rose-300' :
                          h === 'white' ? 'border-zinc-200 bg-zinc-50 dark:bg-zinc-800/50 dark:border-zinc-700 text-zinc-500' :
                          isExternal ? 'border-dashed border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800 text-sky-700 dark:text-sky-300' :
                          'border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                        } ${isHovered ? 'scale-105 shadow-md ring-2 ring-offset-1 ring-zinc-300 dark:ring-zinc-600' : ''}`}
                        title={isExternal ? `外部源: ${t}` : `${t} (${TABLES.find(x => x.table === t)?.cn || ''})`}
                      >
                        {t}
                        {h === 'red' && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-rose-500" />}
                      </div>
                    )
                  })}
                </div>
              </div>
              {i < layers.length - 1 && (
                <div className="ml-32 flex items-center gap-2 text-zinc-300 dark:text-zinc-700 py-1">
                  <div className="h-4 w-px bg-current ml-2" />
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
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-zinc-300 bg-zinc-50" /> once/不适用</span>
          <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded border border-dashed border-sky-300 bg-sky-50" /> 外部数据源</span>
          <span className="ml-auto text-zinc-400">悬停节点查看详情 · 拓扑排序自动决定执行顺序</span>
        </div>
      </CardContent>
    </Card>
  )
}

function SchedulesView() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="h-4 w-4 text-fuchsia-500" />
          调度计划 (schedules.yaml)
        </CardTitle>
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
