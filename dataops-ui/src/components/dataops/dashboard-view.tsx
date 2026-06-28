'use client'
import { TableMeta, DailyRunStat } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { AlertTriangle, Activity, Database, CheckCircle2, Clock, TrendingUp, Zap, ArrowRight, Layers, Gauge, Cpu, HardDrive, Radio, Loader2, XCircle, Play, Pause, Terminal, Calendar, ArrowUpRight, RefreshCw, Download, X, ChevronUp, ChevronDown, Info } from 'lucide-react'
import { ALERTS, PIPELINE_RUNS, ROW_TREND, TABLES, DAILY_STATS, INGEST_TREND, SCRIPT_DISTRIBUTION, isTradingDay, getLastTradingDay, TRADING_CALENDAR } from '@/lib/dataops/mock-data'
import { APP_CONFIG } from '@/lib/dataops/config'
import { formatRows, runStatusClass, runStatusDot } from '@/lib/dataops/styles'
import { useLogStreamer } from '@/hooks/use-log-streamer'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useGitHubSync } from '@/hooks/use-github-sync'
import { motion } from 'framer-motion'

type TimeRange = '7d' | '30d' | '90d'

// 根据时间范围生成缩放的 mock 数据
function genScaledStats(range: TimeRange): DailyRunStat[] {
  if (range === '7d') return DAILY_STATS
  const days = range === '30d' ? 30 : 90
  const result: DailyRunStat[] = []
  const baseDate = new Date()
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
  const baseDate = new Date()
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

// Format number with commas (e.g., 19,800,000)
function formatNumberComma(n: number): string {
  return n.toLocaleString('en-US')
}

export function DashboardView({ onNavigate }: { onNavigate: (v: string) => void }) {
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [runningElapsed, setRunningElapsed] = useState(0)
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set())

  const totalTables = TABLES.length
  const greenTables = TABLES.filter(t => t.health === 'green').length
  const redTables = TABLES.filter(t => t.health === 'red').length
  const yellowTables = TABLES.filter(t => t.health === 'yellow').length
  const todayStr = new Date().toISOString().slice(0, 10)
  const lastTradingDay = getLastTradingDay()
  const isTodayTradingDay = isTradingDay()
  const todayRuns = PIPELINE_RUNS.filter(r => r.startedAt.startsWith(todayStr))
  const successRate = todayRuns.length > 0
    ? Math.round((todayRuns.filter(r => r.status === 'success').length / todayRuns.length) * 100)
    : 0
  const totalRows = TABLES.reduce((s, t) => s + t.rows, 0)
  const runningRun = PIPELINE_RUNS.find(r => r.status === 'running')
  const todayStat = DAILY_STATS[DAILY_STATS.length - 1]

  // 实时运行计时器 — 避免 render 期 Date.now() 导致 hydration 不匹配
  useEffect(() => {
    if (!runningRun) return
    const startedAtMs = new Date(runningRun.startedAt).getTime()
    const tick = () => setRunningElapsed(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [runningRun])

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
  const maxEnd = Math.max(...timelineRuns.map(r => r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()))
  const totalSpan = maxEnd - minStart || 1

  // Top 大表
  const topTables = [...TABLES].filter(t => t.rows > 0).sort((a, b) => b.rows - a.rows).slice(0, 6)

  // Active alerts (not dismissed)
  const activeAlerts = ALERTS.filter(a => !dismissedAlerts.has(a.id))

  const { refetch: refetchGitHub, loading: syncLoading } = useGitHubSync()

  // Trend calculations for KPI cards
  const kpiTrends = useMemo(() => {
    const lastHalf = Math.floor(scaledStats.length / 2)
    const firstHalfStats = scaledStats.slice(0, lastHalf)
    const secondHalfStats = scaledStats.slice(lastHalf)
    const firstRate = firstHalfStats.length > 0 ? firstHalfStats.reduce((s, d) => s + d.success, 0) / Math.max(firstHalfStats.reduce((s, d) => s + d.total, 0), 1) * 100 : 0
    const secondRate = secondHalfStats.length > 0 ? secondHalfStats.reduce((s, d) => s + d.success, 0) / Math.max(secondHalfStats.reduce((s, d) => s + d.total, 0), 1) * 100 : 0
    const successTrend = Math.round(secondRate - firstRate)

    const firstIngest = firstHalfStats.reduce((s, d) => s + (scaledIngest[firstHalfStats.indexOf(d)]?.rows ?? 0), 0)
    const secondIngest = secondHalfStats.reduce((s, d) => s + (scaledIngest[lastHalf + secondHalfStats.indexOf(d)]?.rows ?? 0), 0)
    const ingestTrend = firstIngest > 0 ? Math.round(((secondIngest - firstIngest) / firstIngest) * 100) : 0

    const alertTrend = ALERTS.length > 5 ? 1 : -1 // mock trend

    return { successTrend, ingestTrend, alertTrend }
  }, [scaledStats, scaledIngest])

  // 导出 PNG 报表
  const handleExportReport = () => {
    const canvas = document.createElement('canvas')
    canvas.width = 1400
    canvas.height = 1200
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = 1400
    const PAD = 32

    // Background
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, 1200)

    // Header gradient
    const headerGrad = ctx.createLinearGradient(0, 0, W, 0)
    headerGrad.addColorStop(0, '#0ea5e9')
    headerGrad.addColorStop(0.5, '#8b5cf6')
    headerGrad.addColorStop(1, '#d946ef')
    ctx.fillStyle = headerGrad
    ctx.fillRect(0, 0, W, 80)

    // Header text
    ctx.fillStyle = '#ffffff'
    ctx.font = 'bold 28px system-ui, -apple-system, sans-serif'
    ctx.fillText('DataOps 运维报表', PAD, 46)
    ctx.font = '14px system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.8)'
    const dateStr = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
    ctx.fillText(`生成时间: ${dateStr} · 统计区间: ${rangeLabel}`, PAD, 66)

    // Version badge
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText(`v${APP_CONFIG.version}`, W - PAD, 46)
    ctx.textAlign = 'left'

    // ─── Section 1: KPI Cards ───
    const kpis = [
      { label: '数据表总数', value: totalTables.toString(), sub: `${greenTables} 健康 · ${redTables} 异常`, color: '#0ea5e9' },
      { label: `${rangeLabel}执行成功率`, value: `${rangeRate}%`, sub: `${rangeSuccess}/${rangeTotal} 成功`, color: '#10b981' },
      { label: `${rangeLabel}入库行数`, value: formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0)), sub: `日均 ${formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0) / (scaledIngest.filter(d => d.rows > 0).length || 1))}`, color: '#d946ef' },
      { label: '待处理告警', value: ALERTS.length.toString(), sub: `${ALERTS.filter(a => a.level === 'red').length} 红 · ${ALERTS.filter(a => a.level === 'yellow').length} 黄`, color: '#f43f5e' },
    ]
    const cardW = 310
    const cardH = 100
    const cardGap = 16
    const cardStartX = (W - (cardW * 4 + cardGap * 3)) / 2
    const cardY = 100

    kpis.forEach((kpi, i) => {
      const x = cardStartX + i * (cardW + cardGap)
      ctx.fillStyle = '#f8fafc'
      ctx.strokeStyle = '#e2e8f0'
      ctx.lineWidth = 1
      roundRect(ctx, x, cardY, cardW, cardH, 8)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = kpi.color
      ctx.fillRect(x, cardY, 4, cardH)
      ctx.fillStyle = '#64748b'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText(kpi.label, x + 16, cardY + 28)
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 28px system-ui, sans-serif'
      ctx.fillText(kpi.value, x + 16, cardY + 64)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(kpi.sub, x + 16, cardY + 84)
    })

    // ─── Section 2: 入库趋势图 ───
    const chartY = 230
    const chartH = 220
    const chartW = W - PAD * 2 - 420
    ctx.fillStyle = '#f8fafc'
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    roundRect(ctx, PAD, chartY, chartW, chartH, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText(`${rangeLabel}入库行数趋势`, PAD + 16, chartY + 28)
    // Bar chart
    const barData = scaledIngest.slice(-14)
    const barMax = Math.max(...barData.map(d => d.rows), 1)
    const barAreaX = PAD + 40
    const barAreaY = chartY + 44
    const barAreaW = chartW - 80
    const barAreaH = chartH - 72
    barData.forEach((d, i) => {
      const bw = Math.max(1, (barAreaW / barData.length) - 6)
      const bx = barAreaX + i * (barAreaW / barData.length) + 3
      const bh = (d.rows / barMax) * (barAreaH - 10)
      const by = barAreaY + barAreaH - bh
      const barGrad = ctx.createLinearGradient(bx, by, bx, barAreaY + barAreaH)
      barGrad.addColorStop(0, '#d946ef')
      barGrad.addColorStop(1, 'rgba(217,70,239,0.2)')
      ctx.fillStyle = barGrad
      ctx.fillRect(bx, by, bw, bh)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(d.date, bx + bw / 2, barAreaY + barAreaH + 12)
      ctx.textAlign = 'left'
    })

    // ─── Section 2b: 告警面板 ───
    const alertX = W - PAD - 400
    ctx.fillStyle = '#f8fafc'
    ctx.strokeStyle = '#e2e8f0'
    roundRect(ctx, alertX, chartY, 400, chartH, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText('告警摘要', alertX + 16, chartY + 28)
    // Alert stats summary
    const redAlerts = ALERTS.filter(a => a.level === 'red')
    const yellowAlerts = ALERTS.filter(a => a.level === 'yellow')
    ctx.font = '11px system-ui, sans-serif'
    ctx.fillStyle = '#f43f5e'
    ctx.fillText(`🔴 严重: ${redAlerts.length} 条`, alertX + 16, chartY + 50)
    ctx.fillStyle = '#f59e0b'
    ctx.fillText(`🟡 警告: ${yellowAlerts.length} 条`, alertX + 130, chartY + 50)
    // Individual alerts
    ALERTS.slice(0, 6).forEach((a, i) => {
      const ay = chartY + 68 + i * 26
      ctx.fillStyle = a.level === 'red' ? '#f43f5e' : '#f59e0b'
      ctx.beginPath()
      ctx.arc(alertX + 24, ay + 4, 4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#334155'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText(`${a.table} · ${a.type}`, alertX + 36, ay + 2)
      ctx.fillStyle = '#94a3b8'
      ctx.font = '10px system-ui, sans-serif'
      ctx.fillText(a.message.slice(0, 36), alertX + 36, ay + 18)
    })

    // ─── Section 3: 执行时间线 (Gantt) ───
    const ganttY = chartY + chartH + 20
    const ganttH = Math.max(40 + timelineRuns.length * 28 + 40, 120)
    ctx.fillStyle = '#f8fafc'
    ctx.strokeStyle = '#e2e8f0'
    roundRect(ctx, PAD, ganttY, W - PAD * 2, ganttH, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText('今日执行时间线 (Gantt)', PAD + 16, ganttY + 28)

    if (timelineRuns.length > 0) {
      const ganttAreaX = PAD + 160
      const ganttAreaW = W - PAD * 2 - 200
      // Time axis
      ctx.fillStyle = '#94a3b8'
      ctx.font = '9px system-ui, sans-serif'
      for (let i = 0; i <= 4; i++) {
        const t = new Date(minStart + (maxEnd - minStart) * (i / 4))
        const tx = ganttAreaX + (i / 4) * ganttAreaW
        ctx.textAlign = 'center'
        ctx.fillText(t.toTimeString().slice(0, 5), tx, ganttY + 40)
        ctx.textAlign = 'left'
        // Grid line
        ctx.strokeStyle = '#f1f5f9'
        ctx.lineWidth = 0.5
        ctx.beginPath()
        ctx.moveTo(tx, ganttY + 46)
        ctx.lineTo(tx, ganttY + 46 + timelineRuns.length * 28)
        ctx.stroke()
      }
      // Bars
      const statusColorMap: Record<string, string> = {
        success: '#10b981',
        failed: '#f43f5e',
        skipped: '#cbd5e1',
        running: '#0ea5e9',
      }
      timelineRuns.forEach((r, i) => {
        const ry = ganttY + 48 + i * 28
        const start = new Date(r.startedAt).getTime()
        const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()
        const left = ((start - minStart) / totalSpan) * ganttAreaW
        const width = Math.max(((end - start) / totalSpan) * ganttAreaW, 4)
        // Table name
        ctx.fillStyle = '#64748b'
        ctx.font = '10px monospace'
        ctx.textAlign = 'right'
        ctx.fillText(r.table.length > 14 ? r.table.slice(0, 14) + '…' : r.table, ganttAreaX - 10, ry + 12)
        ctx.textAlign = 'left'
        // Bar
        ctx.fillStyle = statusColorMap[r.status] || '#94a3b8'
        roundRect(ctx, ganttAreaX + left, ry + 2, width, 18, 4)
        ctx.fill()
        // Duration label
        ctx.fillStyle = '#64748b'
        ctx.font = '9px system-ui, sans-serif'
        ctx.fillText(`${r.durationSec}s`, ganttAreaX + left + width + 4, ry + 14)
      })
    } else {
      ctx.fillStyle = '#94a3b8'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText('今日暂无执行记录', PAD + 16, ganttY + 60)
    }

    // ─── Section 4: Top 大表排行 ───
    const bottomY = ganttY + ganttH + 20
    const bottomH = 40 + topTables.length * 32 + 20
    ctx.fillStyle = '#f8fafc'
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1
    roundRect(ctx, PAD, bottomY, W - PAD * 2, bottomH, 8)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#334155'
    ctx.font = 'bold 14px system-ui, sans-serif'
    ctx.fillText('Top 大表排行', PAD + 16, bottomY + 28)
    topTables.forEach((t, i) => {
      const ty = bottomY + 48 + i * 32
      ctx.fillStyle = '#64748b'
      ctx.font = '12px monospace'
      ctx.fillText(`#${i + 1}`, PAD + 24, ty + 4)
      ctx.fillStyle = '#0f172a'
      ctx.font = '13px monospace'
      ctx.fillText(t.table, PAD + 56, ty + 4)
      const maxR = topTables[0].rows
      const barPct = (t.rows / maxR) * 400
      const barGrad2 = ctx.createLinearGradient(PAD + 250, ty, PAD + 250 + barPct, ty)
      barGrad2.addColorStop(0, '#0ea5e9')
      barGrad2.addColorStop(1, '#38bdf8')
      ctx.fillStyle = barGrad2
      roundRect(ctx, PAD + 250, ty - 6, barPct, 16, 3)
      ctx.fill()
      ctx.fillStyle = '#64748b'
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillText(formatRows(t.rows), PAD + 250 + barPct + 8, ty + 4)
    })

    // ─── Footer ───
    // Calculate actual height needed
    const actualHeight = bottomY + bottomH + 60

    // Copy to final canvas with proper height
    const finalCanvas = document.createElement('canvas')
    finalCanvas.width = W
    finalCanvas.height = actualHeight
    const fctx = finalCanvas.getContext('2d')
    if (!fctx) return
    // White background
    fctx.fillStyle = '#ffffff'
    fctx.fillRect(0, 0, W, actualHeight)
    // Draw original onto final
    fctx.drawImage(canvas, 0, 0)
    // Footer
    fctx.fillStyle = '#e2e8f0'
    fctx.fillRect(PAD, actualHeight - 30, W - PAD * 2, 1)
    fctx.fillStyle = '#94a3b8'
    fctx.font = '10px system-ui, sans-serif'
    const now = new Date()
    const tsStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${now.toTimeString().slice(0, 8)}`
    fctx.fillText(`DataOps 管理台 v${APP_CONFIG.version} · 自动生成报表 · 仅供内部参考 · ${tsStr}`, PAD, actualHeight - 14)

    // Download
    finalCanvas.toBlob(blob => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `DataOps_Report_${new Date().toISOString().slice(0, 10)}.png`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('报表已导出', { description: `PNG 报表已下载 (${W}×${actualHeight}px)` })
    }, 'image/png')
  }

  // Helper: rounded rect path
  function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.lineTo(x + w - r, y)
    ctx.quadraticCurveTo(x + w, y, x + w, y + r)
    ctx.lineTo(x + w, y + h - r)
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    ctx.lineTo(x + r, y + h)
    ctx.quadraticCurveTo(x, y + h, x, y + h - r)
    ctx.lineTo(x, y + r)
    ctx.quadraticCurveTo(x, y, x + r, y)
    ctx.closePath()
  }

  const handleSyncGitHub = async () => {
    try {
      const result = await refetchGitHub()
      if (result.error) {
        toast.error('GitHub 同步失败', {
          description: result.error.message || '未知错误',
        })
      } else {
        const data = result.data
        const tableCount = Array.isArray(data?.tables) ? data.tables.length : 0
        const dictEntries = Array.isArray(data?.dictionary) ? data.dictionary.length : 0
        toast.success('GitHub 同步成功', {
          description: `已同步 ${tableCount} 个表定义 · ${dictEntries} 个字段定义`,
        })
      }
    } catch {
      toast.error('GitHub 同步失败', {
        description: '网络错误或服务不可用',
      })
    }
  }

  const dismissAlert = (id: string) => {
    setDismissedAlerts(prev => new Set(prev).add(id))
    toast.success('已忽略该告警')
  }

  return (
    <div className="space-y-6">
      {/* 非交易日提示 */}
      {!isTodayTradingDay && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-sm">
          <Info className="h-4 w-4 text-sky-500 flex-shrink-0" />
          <span className="text-sky-700 dark:text-sky-300 font-medium">当前为非交易日</span>
          <span className="text-sky-600 dark:text-sky-400">，部分数据指标可能不更新。最近交易日: {lastTradingDay}，下一交易日: {TRADING_CALENDAR.nextTradingDay}</span>
        </div>
      )}

      {/* 交易日指示器 + 时间范围选择器 + GitHub 同步按钮 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />
            <span>统计区间</span>
          </div>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium ${
            isTodayTradingDay
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
              : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border border-zinc-200 dark:border-zinc-700'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${isTodayTradingDay ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
            {isTodayTradingDay ? '交易日' : '休市'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportReport}
            className="h-7 gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            导出报表
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSyncGitHub}
            disabled={syncLoading}
            className="h-7 gap-1.5 text-xs"
          >
            {syncLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            同步 GitHub
          </Button>
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
      </div>

      {/* KPI 卡片 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
        <KpiCard
          icon={<Database className="h-5 w-5" />}
          label="数据表总数"
          value={totalTables.toString()}
          sub={`${greenTables} 健康 · ${redTables} 异常 · ${yellowTables} 待查`}
          tone="sky"
          trend={{ value: 2, direction: 'up' }}
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
          trend={{ value: Math.abs(kpiTrends.successTrend), direction: kpiTrends.successTrend >= 0 ? 'up' : 'down' }}
          spark={<Sparkline data={scaledStats.slice(-7).map(d => d.total > 0 ? Math.round((d.success / d.total) * 100) : 0)} color={rangeRate >= 90 ? 'emerald' : 'amber'} />}
          popover={<SuccessRatePopover stats={scaledStats} onNavigate={onNavigate} />}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label={`${rangeLabel}入库行数`}
          value={formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0))}
          sub={`日均 ${formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0) / scaledIngest.filter(d => d.rows > 0).length || 1)}`}
          tone="fuchsia"
          trend={{ value: Math.abs(kpiTrends.ingestTrend), direction: kpiTrends.ingestTrend >= 0 ? 'up' : 'down' }}
          spark={<Sparkline data={scaledIngest.slice(-7).map(d => Math.round(d.rows / 1000000 * 10) / 10)} color="fuchsia" suffix="M" />}
          popover={<IngestRowsPopover onNavigate={onNavigate} />}
        />
        <KpiCard
          icon={<AlertTriangle className="h-5 w-5" />}
          label="待处理告警"
          value={activeAlerts.length.toString()}
          sub={`${ALERTS.filter(a => a.level === 'red').length} 红 · ${ALERTS.filter(a => a.level === 'yellow').length} 黄`}
          tone={ALERTS.filter(a => a.level === 'red').length > 0 ? 'rose' : 'amber'}
          trend={{ value: ALERTS.length, direction: kpiTrends.alertTrend >= 0 ? 'up' : 'down' }}
          spark={<Sparkline data={[3, 4, 5, 6, 7, 8, 8]} color="rose" />}
          onClick={() => onNavigate('lint')}
          navigable
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 执行时间线 */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              今日执行时间线
              <Badge variant="outline" className="text-[10px] ml-1">{todayRuns.length} 次</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('orchestration')}>
              查看全部 <ArrowRight className="ml-1 h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            {runningRun && (
              <div className="mb-3 p-3 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sm flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
                <span className="font-medium text-sky-700 dark:text-sky-300">运行中：</span>
                <span className="text-sky-700 dark:text-sky-300 font-mono">{runningRun.table}</span>
                <span className="text-zinc-500 ml-auto text-xs">force={String(runningRun.force)} · 已运行 {runningElapsed}s</span>
              </div>
            )}
            <div className="space-y-1.5">
              {timelineRuns.map(r => {
                const start = new Date(r.startedAt).getTime()
                const end = r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()
                const left = ((start - minStart) / totalSpan) * 100
                const width = ((end - start) / totalSpan) * 100
                return (
                  <div key={r.id} className="flex items-center gap-2 text-sm group">
                    <div className="w-32 truncate text-zinc-600 dark:text-zinc-400 font-mono text-xs">{r.table}</div>
                    <div className="flex-1 relative h-5 bg-zinc-100 dark:bg-zinc-800/60 rounded">
                      <div
                        className={`absolute top-0 h-5 rounded ${runStatusDot(r.status)} transition-all group-hover:brightness-110`}
                        style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}
                        title={`${r.table} ${r.startedAt.slice(11)} - ${r.finishedAt ? r.finishedAt.slice(11) : '...'} (${r.durationSec}s)`}
                      />
                      <span className="absolute right-1 top-0 leading-5 text-[10px] text-zinc-400 font-mono">{r.durationSec}s</span>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> 成功</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> 失败</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-zinc-300" /> 跳过</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" /> 运行中</span>
              <span className="ml-auto text-zinc-400">日耗时 {todayStat.durationMin}min</span>
            </div>
          </CardContent>
        </Card>

        {/* 告警列表 - Redesigned */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              待处理告警
              <Badge variant="outline" className="text-[10px] ml-1">{activeAlerts.length} 条</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('lint')}>规范</Button>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <ScrollArea className="h-[320px] pr-1">
              <div className="space-y-3">
                {activeAlerts.map(a => (
                  <motion.div
                    key={a.id}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    className={`relative rounded-lg border-l-4 p-4 text-sm ${
                      a.level === 'red'
                        ? 'border-l-rose-500 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60'
                        : 'border-l-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`h-2 w-2 rounded-full flex-shrink-0 ${a.level === 'red' ? 'bg-rose-500' : 'bg-amber-400'}`} />
                          <span className="font-mono font-semibold text-zinc-700 dark:text-zinc-300 truncate">{a.table}</span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 flex-shrink-0">{a.type}</Badge>
                          <Badge variant="secondary" className="text-[9px] py-0 px-1.5 flex-shrink-0 ml-auto">
                            <Clock className="h-2.5 w-2.5 mr-0.5" />{a.ts.slice(11)}
                          </Badge>
                        </div>
                        <div className="text-zinc-600 dark:text-zinc-400 leading-relaxed text-xs pl-4">{a.message}</div>
                      </div>
                      <button
                        onClick={() => dismissAlert(a.id)}
                        className="flex-shrink-0 p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                        title="忽略此告警"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
                {activeAlerts.length === 0 && (
                  <div className="py-8 text-center text-zinc-400">
                    <CheckCircle2 className="h-8 w-8 mx-auto opacity-40 mb-2 text-emerald-500" />
                    <div className="text-sm">所有告警已处理</div>
                    <div className="text-xs mt-1">暂无待处理告警</div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 第二行：成功率环形图 + 入库趋势 + Top 表 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 7日成功率环形图 */}
        <Card>
          <CardHeader className="pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-500" />
              {rangeLabel}执行成功率
              <Badge variant="outline" className="text-[10px] ml-1">{scaledStats.length} 天</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="flex items-center gap-4">
              <DonutChart
                value={rangeRate}
                size={120}
                label={`${rangeRate}%`}
                subLabel={rangeLabel}
              />
              <div className="flex-1 space-y-1 text-sm max-h-[140px] overflow-y-auto pr-1">
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
          <CardHeader className="pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-fuchsia-500" />
              {rangeLabel}入座行数趋势
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <AreaChart data={scaledIngest} />
            <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">{rangeLabel}累计</div>
                <div className="font-mono font-semibold text-lg">{formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0))}</div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">日均</div>
                <div className="font-mono font-semibold text-lg">{formatRows(scaledIngest.reduce((s, d) => s + d.rows, 0) / (scaledIngest.filter(d => d.rows > 0).length || 1))}</div>
              </div>
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900/50">
                <div className="text-[10px] text-zinc-400">峰值</div>
                <div className="font-mono font-semibold text-lg text-fuchsia-600 dark:text-fuchsia-400">{formatRows(Math.max(...scaledIngest.map(d => d.rows)))}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Top 大表 - Enhanced with alternating rows & hover */}
        <Card>
          <CardHeader className="pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-500" />
              Top 6 大表
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-1">
              {topTables.map((t, i) => {
                const maxRows = topTables[0].rows
                const pct = (t.rows / maxRows) * 100
                return (
                  <button
                    key={t.table}
                    onClick={() => onNavigate('catalog')}
                    className={`w-full text-left group rounded-md px-3 py-2 transition-colors ${
                      i % 2 === 0
                        ? 'bg-zinc-50/50 dark:bg-zinc-900/30 hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                        : 'hover:bg-zinc-100 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2 text-sm mb-1">
                      <span className="text-zinc-400 font-mono w-5 text-xs">#{i + 1}</span>
                      <span className="font-mono text-zinc-700 dark:text-zinc-300 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 truncate flex-1 transition-colors">{t.table}</span>
                      <span className="font-mono text-zinc-500 text-xs">{formatNumberComma(t.rows)}</span>
                    </div>
                    <div className="ml-5 h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, delay: i * 0.08, ease: 'easeOut' }}
                        className={`h-full rounded-full ${
                          i === 0 ? 'bg-emerald-500' : i === 1 ? 'bg-emerald-400' : 'bg-emerald-300 dark:bg-emerald-700'
                        }`}
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
          <CardHeader className="pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-fuchsia-500" />
              行数趋势 · 大表 Top
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
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
                            <motion.div
                              initial={{ height: 0 }}
                              animate={{ height: `${h}%` }}
                              transition={{ duration: 0.5, ease: 'easeOut' }}
                              className="w-full bg-fuchsia-200 dark:bg-fuchsia-900/50 rounded-t group-hover:bg-fuchsia-400 dark:group-hover:bg-fuchsia-600 transition-colors"
                              title={`${formatNumberComma(d.rows)} 行`}
                            />
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

        {/* 脚本规模分布 - Enhanced with percentage labels */}
        <Card>
          <CardHeader className="pb-3 px-6 pt-6">
            <CardTitle className="text-lg flex items-center gap-2">
              <Cpu className="h-4 w-4 text-amber-500" />
              脚本规模分布
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6 pb-6">
            <div className="space-y-4">
              {SCRIPT_DISTRIBUTION.map(s => {
                const maxLines = Math.max(...SCRIPT_DISTRIBUTION.map(x => x.totalLines))
                const pct = (s.totalLines / maxLines) * 100
                const totalAllLines = SCRIPT_DISTRIBUTION.reduce((sum, x) => sum + x.totalLines, 0)
                const pctOfTotal = Math.round((s.totalLines / totalAllLines) * 100)
                return (
                  <div key={s.dir}>
                    <div className="flex items-center justify-between text-sm mb-1.5">
                      <span className="font-mono font-medium">{s.dir}</span>
                      <span className="text-zinc-500 text-xs">{s.tables} 表 · {formatNumberComma(s.totalLines)} 行</span>
                    </div>
                    <div className="h-6 bg-zinc-100 dark:bg-zinc-800 rounded-md overflow-hidden relative">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                        className={`h-full rounded-md flex items-center ${
                          s.dir === '1_入库' ? 'bg-emerald-500' :
                          s.dir === '2_计算' ? 'bg-fuchsia-500' :
                          s.dir === '3_策略' ? 'bg-amber-500' : 'bg-sky-500'
                        }`}
                      >
                        <span className="text-white text-xs font-semibold px-2 whitespace-nowrap drop-shadow-sm">
                          {pctOfTotal}%
                        </span>
                      </motion.div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-4 pt-3 border-t grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <HardDrive className="h-3.5 w-3.5 text-zinc-400" />
                <span className="text-zinc-500">总行数</span>
                <span className="font-mono font-medium ml-auto">{formatNumberComma(SCRIPT_DISTRIBUTION.reduce((s, d) => s + d.totalLines, 0))}</span>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

  // 18 daily 表列表（用于可触发剧本面板）
  const dailyScripts = useMemo(() => TABLES.filter(t => t.schedule === 'daily').map((t, i) => ({
    idx: i, table: t.table, cn: t.cn,
  })), [])

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [streamer.logs.length])

  const handleTrigger = (_table: string) => {
    streamer.startExecution('daily')
    toast.success('已触发 daily 全量执行', { description: '观察实时日志流' })
  }

  const isRunning = streamer.progress.status === 'running'
  const isCompleted = streamer.progress.status === 'completed'

  return (
    <Card className="border-emerald-200/60 dark:border-emerald-900/40 overflow-hidden">
      <CardHeader className="pb-3 px-6 pt-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Radio className={`h-4 w-4 ${isRunning ? 'text-rose-500 animate-pulse' : 'text-emerald-500'}`} />
            实时执行流
            {/* Blinking LIVE indicator */}
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">Live</span>
            </span>
            {streamer.connected && (
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 ml-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse mr-1" /> WS 已连接
              </Badge>
            )}
            {(isRunning || isCompleted) && (
              <Badge variant="outline" className={`text-[10px] ml-1 ${
                isRunning ? 'text-amber-600 border-amber-300' :
                isCompleted ? 'text-emerald-600 border-emerald-300' :
                'text-rose-600 border-rose-300'
              }`}>
                {isRunning && <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />}
                {isCompleted && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                {isRunning ? `${streamer.progress.currentTable}` : ''}
                {isCompleted ? '完成' : ''}
                {isRunning ? ` · ${streamer.progress.percent}%` : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-1.5">
            {/* Prominent CTA button */}
            {isRunning ? (
              <Button size="sm" variant="outline" className="h-8 text-xs text-rose-600 hover:text-rose-700 border-rose-200 dark:border-rose-800" onClick={() => streamer.cancelExecution()}>
                <Pause className="h-3.5 w-3.5 mr-1" /> 取消
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5 shadow-sm"
                onClick={() => streamer.startExecution('daily')}
                disabled={isRunning}
                title="触发 daily 全量执行"
              >
                <Play className="h-3.5 w-3.5" /> 触发执行
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onNavigate('logs')}>
              <Terminal className="h-3.5 w-3.5 mr-1" /> 完整日志
            </Button>
          </div>
        </div>
        {/* 进度条 */}
        {isRunning && (
          <div className="mt-3 h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${streamer.progress.percent}%` }}
              className="h-full bg-gradient-to-r from-emerald-500 via-sky-500 to-fuchsia-500 transition-all duration-300"
            />
          </div>
        )}
        {(isRunning || isCompleted) && streamer.progress.tablesTotal > 0 && (
          <div className="mt-2 flex items-center gap-2 text-xs">
            <Zap className="h-3 w-3 text-amber-500" />
            <span className="text-zinc-500">daily 全量</span>
            <div className="flex-1 max-w-[200px] h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-amber-500 transition-all rounded-full" style={{ width: `${streamer.progress.percent}%` }} />
            </div>
            <span className="font-mono text-zinc-400">{streamer.progress.tablesCompleted}/{streamer.progress.tablesTotal}</span>
          </div>
        )}
      </CardHeader>
      <CardContent className="pt-0 px-6 pb-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* 日志流 - Enhanced terminal style */}
          <div className="rounded-lg border border-zinc-300 dark:border-zinc-700 bg-zinc-900 dark:bg-zinc-950 overflow-hidden shadow-inner">
            <div className="px-4 py-2 border-b border-zinc-700 bg-zinc-800 dark:bg-zinc-900 flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </div>
              <Terminal className="h-3 w-3 text-zinc-500 ml-1" />
              <span className="text-[11px] font-mono text-zinc-400">logs/run_live.log</span>
              {streamer.logs.length > 0 && (
                <Badge variant="outline" className="ml-auto text-[9px] text-rose-400 border-rose-600/50 bg-rose-950/30 py-0">
                  <span className="relative flex h-1.5 w-1.5 mr-1">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500" />
                  </span>
                  LIVE · {streamer.logs.length}
                </Badge>
              )}
            </div>
            <div className="h-[240px] overflow-y-auto font-mono text-xs p-3 space-y-0.5 custom-scrollbar">

              {streamer.logs.length === 0 && (
                <div className="py-12 text-center text-zinc-500">
                  <Terminal className="h-6 w-6 mx-auto opacity-40 mb-2" />
                  <div className="text-sm text-zinc-400">点击右侧剧本触发实时执行</div>
                  <div className="text-[11px] mt-1">或点击「触发执行」执行全量</div>
                </div>
              )}
              {streamer.logs.slice(-80).map((l, i) => (
                <div
                  key={i}
                  className={`flex gap-2 px-1.5 py-0.5 rounded ${
                    l.level === 'ERROR' ? 'bg-rose-950/50' :
                    l.level === 'WARNING' ? 'bg-amber-950/30' :
                    l.level === 'SUCCESS' ? 'bg-emerald-950/30' :
                    l.level === 'INFO' && l.message.startsWith('✔') ? 'bg-emerald-950/30' :
                    ''
                  }`}
                >
                  <span className="text-zinc-500 flex-shrink-0">{l.timestamp.slice(11)}</span>
                  <span className={`flex-shrink-0 w-14 font-bold ${
                    l.level === 'ERROR' ? 'text-rose-400' :
                    l.level === 'WARNING' ? 'text-amber-400' :
                    l.level === 'SUCCESS' ? 'text-emerald-400' :
                    l.level === 'INFO' ? 'text-emerald-400' :
                    'text-zinc-500'
                  }`}>{l.level}</span>
                  {l.table && <span className="text-sky-400 flex-shrink-0 w-32 truncate">{l.table}</span>}
                  <span className="text-zinc-300 flex-1">{l.message}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>

          {/* 可触发剧本 */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 bg-zinc-50 dark:bg-zinc-900/50">
            <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1 font-medium">
              <Zap className="h-3.5 w-3.5" /> Daily 表 ({dailyScripts.length})
            </div>
            <div className="space-y-1 max-h-[260px] overflow-y-auto pr-1">
              {dailyScripts.map((s, i) => {
                const isCurrent = isRunning && streamer.progress.currentTable === s.table
                const isDone = streamer.progress.tablesCompleted > i
                return (
                  <button
                    key={s.table}
                    onClick={() => handleTrigger(s.table)}
                    disabled={isRunning}
                    className={`w-full text-left px-3 py-2 rounded-md text-xs font-mono border transition-all flex items-center gap-1.5 ${
                      isCurrent
                        ? 'border-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                        : isDone
                        ? 'border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                        : 'border-zinc-200 dark:border-zinc-600 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                    title={`${s.cn}`}
                  >
                    {isCurrent ? <Loader2 className="h-3 w-3 animate-spin flex-shrink-0" /> :
                     isDone ? <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-500" /> :
                     <Play className="h-3 w-3 flex-shrink-0 opacity-50" />}
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

// --- 子组件：KPI 卡片 - Enhanced with gradient bg, motion, trend arrows ---
function KpiCard({ icon, label, value, sub, tone, spark, onClick, popover, navigable, trend }: {
  icon: React.ReactNode; label: string; value: string; sub: string; tone: 'sky' | 'emerald' | 'amber' | 'rose' | 'fuchsia'; spark?: React.ReactNode
  onClick?: () => void; popover?: ReactNode; navigable?: boolean; trend?: { value: number; direction: 'up' | 'down' }
}) {
  const toneMap = {
    sky: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40',
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40',
    fuchsia: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-950/40',
  }
  const gradientMap = {
    sky: 'from-sky-50/80 to-white dark:from-sky-950/20 dark:to-zinc-950',
    emerald: 'from-emerald-50/80 to-white dark:from-emerald-950/20 dark:to-zinc-950',
    amber: 'from-amber-50/80 to-white dark:from-amber-950/20 dark:to-zinc-950',
    rose: 'from-rose-50/80 to-white dark:from-rose-950/20 dark:to-zinc-950',
    fuchsia: 'from-fuchsia-50/80 to-white dark:from-fuchsia-950/20 dark:to-zinc-950',
  }
  const isClickable = !!onClick || !!popover

  const cardInner = (
    <motion.div
      whileHover={{ scale: 1.02, y: -2 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
    >
      <Card className={`overflow-hidden group hover:shadow-lg transition-shadow duration-200 bg-gradient-to-br ${gradientMap[tone]} ${
        isClickable ? 'cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-200 dark:focus-visible:ring-emerald-800 outline-none' : ''
      }`}>
        <CardContent className="p-6">
          <div className="flex items-start justify-between">
            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="text-sm text-zinc-500">{label}</div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold tracking-tight">{value}</span>
                {trend && (
                  <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${
                    trend.direction === 'up'
                      ? (tone === 'rose' ? 'text-rose-500' : 'text-emerald-500')
                      : (tone === 'rose' ? 'text-emerald-500' : 'text-rose-500')
                  }`}>
                    {trend.direction === 'up' ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {trend.value}{tone === 'rose' && trend.direction === 'down' ? '' : '%'}
                  </span>
                )}
              </div>
              <div className="text-xs text-zinc-400 truncate">{sub}</div>
            </div>
            <div className="flex items-center gap-1">
              {navigable && (
                <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
              )}
              <div className={`p-2.5 rounded-xl ${toneMap[tone]} group-hover:scale-110 transition-transform duration-200`}>{icon}</div>
            </div>
          </div>
          {spark && <div className="mt-4 -mb-1">{spark}</div>}
        </CardContent>
      </Card>
    </motion.div>
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
        <table className="w-full text-xs">
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
          className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors"
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
              <div className="flex items-center justify-between text-xs mb-0.5">
                <span className="font-mono text-zinc-700 dark:text-zinc-300 truncate flex-1">{t.table}</span>
                <span className="font-mono text-zinc-500 ml-2">{formatRows(t.rows)}</span>
              </div>
              <div className="h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.5, delay: i * 0.05 }}
                  className={`h-full rounded-full ${
                    i === 0 ? 'bg-fuchsia-500' : i === 1 ? 'bg-fuchsia-400' : 'bg-fuchsia-300 dark:bg-fuchsia-700'
                  }`}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div className="px-3 py-2 border-t border-zinc-100 dark:border-zinc-800">
        <button
          onClick={() => onNavigate('catalog')}
          className="text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex items-center gap-1 transition-colors"
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
        <circle key={i} cx={i * step} cy={h - ((v - min) / range) * (h - 4) - 2} r={i === data.length - 1 ? 2.5 : 0} className={colorMap[color].replace('stroke', 'fill')} />
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
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} fill="none"
          stroke={color} strokeWidth={6} strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
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
    <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
      <Button variant="outline" className="h-auto py-3 justify-start text-left w-full" onClick={onClick}>
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">{icon}</div>
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-xs text-zinc-400">{desc}</div>
          </div>
        </div>
      </Button>
    </motion.div>
  )
}
