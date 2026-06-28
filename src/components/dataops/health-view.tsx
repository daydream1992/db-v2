'use client'
import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench, Activity, TrendingUp, BarChart3, Filter } from 'lucide-react'
import { TABLES, HEALTH_MATRIX, TRADING_CALENDAR_QUERY, LAST_TRADING_DATE, isTradingDay, DATE_WINDOW, deriveHealthFromScan, getScanSQL } from '@/lib/dataops/mock-data'
import { freshnessClass, healthColorClass } from '@/lib/dataops/styles'

export function HealthView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirFilter, setDirFilter] = useState<string>('all')
  const redTables = TABLES.filter(t => deriveHealthFromScan(t) === 'red')
  const yellowTables = TABLES.filter(t => deriveHealthFromScan(t) === 'yellow')
  const greenTables = TABLES.filter(t => deriveHealthFromScan(t) === 'green')
  const whiteTables = TABLES.filter(t => deriveHealthFromScan(t) === 'white')

  const toggle = (table: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(table)) next.delete(table)
      else next.add(table)
      return next
    })
  }

  // 7 日健康度趋势（每日 success/failed/skipped 堆叠）
  const dailyTrend = useMemo(() => {
    const days = DATE_WINDOW
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
        green: tables.filter(t => deriveHealthFromScan(t) === 'green').length,
        yellow: tables.filter(t => deriveHealthFromScan(t) === 'yellow').length,
        red: tables.filter(t => deriveHealthFromScan(t) === 'red').length,
        white: tables.filter(t => deriveHealthFromScan(t) === 'white').length,
      }
    })
  }, [])

  // 过滤后的矩阵
  const filteredMatrix = useMemo(() => {
    if (dirFilter === 'all') return HEALTH_MATRIX
    return HEALTH_MATRIX.filter(row => {
      const t = TABLES.find(x => x.table === row.table)
      return t?.dir === dirFilter
    })
  }, [dirFilter])

  return (
    <div className="space-y-5">
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="健康" value={greenTables.length} color="emerald" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="异常/滞后" value={redTables.length} color="rose" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="待查" value={yellowTables.length} color="amber" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="不适用(once)" value={whiteTables.length} color="zinc" />
      </div>

      {/* 数据库扫描校验说明 */}
      <Card className="border-sky-200 dark:border-sky-900 bg-sky-50/50 dark:bg-sky-950/20">
        <CardContent className="p-3 flex items-center gap-3 text-xs">
          <Activity className="h-4 w-4 text-sky-500 shrink-0" />
          <div>
            <span className="font-medium text-sky-700 dark:text-sky-300">数据库表扫描校验</span>
            <span className="text-zinc-600 dark:text-zinc-400 ml-1">
              对每张表执行 <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-[11px] font-mono">SELECT COUNT(*) AS rows, MAX(date_col) AS max_date</code>，
              对照 <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded text-[11px] font-mono">trading_calendar.is_trading</code> 判定数据覆盖：
              交易日 <strong>max_date ≥ 当日</strong>→有数据，<strong>max_date ＜ 当日</strong>→缺数据，<strong>非交易日</strong>→跳过。
              不依赖脚本执行日志。当前窗口 <strong>{TRADING_CALENDAR_QUERY.filter(r => r.isTrading).length}</strong> 交易日、
              <strong>{TRADING_CALENDAR_QUERY.filter(r => !r.isTrading).length}</strong> 休市日。
            </span>
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
            <div className="flex items-end gap-2 h-40 mb-3">
              {dailyTrend.map(d => {
                const maxTotal = Math.max(...dailyTrend.map(x => x.total), 1)
                const unit = 140 / maxTotal
                const nonTrading = !isTradingDay(d.date)
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className={`text-[9px] font-mono ${nonTrading ? 'text-zinc-300' : 'text-zinc-500'}`}>{nonTrading ? '休' : `${d.rate}%`}</div>
                    <div className={`w-full flex flex-col-reverse rounded overflow-hidden ${nonTrading ? 'border border-dashed border-zinc-200 dark:border-zinc-700' : ''}`} style={{ height: nonTrading ? '16px' : `${(d.total / maxTotal) * 140}px` }}>
                      {!nonTrading && (
                        <>
                          <div className="bg-emerald-500 group-hover:bg-emerald-600 transition-colors" style={{ height: `${d.success * unit}px` }} title={`有数据 ${d.success}`} />
                          <div className="bg-rose-500 group-hover:bg-rose-600 transition-colors" style={{ height: `${d.failed * unit}px` }} title={`缺数据 ${d.failed}`} />
                          <div className="bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 transition-colors" style={{ height: `${d.skipped * unit}px` }} title={`跳过 ${d.skipped}`} />
                          <div className="bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-200 transition-colors" style={{ height: `${d.pending * unit}px` }} title={`不适用 ${d.pending}`} />
                        </>
                      )}
                    </div>
                    <div className={`text-[10px] ${nonTrading ? 'text-zinc-300' : 'text-zinc-400'}`}>{d.date}</div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> 有数据</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> 缺数据</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-300" /> 跳过</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200" /> 不适用</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm border border-dashed border-zinc-300" /> 非交易日</span>
              <span className="ml-auto text-zinc-400">7 日数据覆盖率 {Math.round(dailyTrend.reduce((s, d) => s + d.rate, 0) / dailyTrend.length)}%</span>
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
            <div className="space-y-3">
              {dirHealth.map(d => {
                const total = d.total || 1
                return (
                  <div key={d.dir}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-mono">{d.dir}</span>
                      <span className="text-zinc-500">{d.total} 表</span>
                    </div>
                    <div className="flex h-3 rounded overflow-hidden">
                      <div className="bg-emerald-500" style={{ width: `${(d.green / total) * 100}%` }} title={`健康 ${d.green}`} />
                      <div className="bg-amber-400" style={{ width: `${(d.yellow / total) * 100}%` }} title={`待查 ${d.yellow}`} />
                      <div className="bg-rose-500" style={{ width: `${(d.red / total) * 100}%` }} title={`异常 ${d.red}`} />
                      <div className="bg-zinc-300 dark:bg-zinc-700" style={{ width: `${(d.white / total) * 100}%` }} title={`once ${d.white}`} />
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-400">
                      <span className="text-emerald-600">{d.green}</span>
                      <span className="text-amber-600">{d.yellow}</span>
                      <span className="text-rose-600">{d.red}</span>
                      <span>{d.white}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 一致性栏 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">一致性总览</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-[11px] text-zinc-400">孤儿表（有表无脚本）</div>
              <div className="text-lg font-mono font-semibold text-rose-600">0</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">死脚本（有脚本无表）</div>
              <div className="text-lg font-mono font-semibold text-rose-600">2</div>
              <div className="text-[10px] text-zinc-400">sector_stocks / t_bk5_19</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">字段中文 TODO</div>
              <div className="text-lg font-mono font-semibold text-amber-600">3</div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400">lint 通过率</div>
              <div className="text-lg font-mono font-semibold text-amber-600">68%</div>
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
            <Badge variant="outline" className="text-[10px]">最后交易日 {LAST_TRADING_DATE}（数据库扫描校验）</Badge>
            {selected.size > 0 && (
              <Button size="sm" variant="destructive" onClick={() => {
                selected.forEach(t => onRunTable?.(t))
                setSelected(new Set())
              }}>
                <Wrench className="h-3.5 w-3.5 mr-1" />补数 ({selected.size})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-[1fr_180px_repeat(7,60px)_90px] gap-1 px-3 py-2 text-[10px] font-medium text-zinc-500 border-b">
                <div>表名</div>
                <div>类型</div>
                {DATE_WINDOW.map(d => (
                  <div key={d} className={`text-center ${!isTradingDay(d) ? 'text-zinc-300 dark:text-zinc-600' : ''}`}>
                    {d}
                    {!isTradingDay(d) && <div className="text-[8px]">休</div>}
                  </div>
                ))}
                <div className="text-center">操作</div>
              </div>
              {filteredMatrix.map(row => {
                const t = TABLES.find(x => x.table === row.table)!
                const isRed = deriveHealthFromScan(t) === 'red'
                return (
                  <div key={row.table} className={`grid grid-cols-[1fr_180px_repeat(7,60px)_90px] gap-1 px-3 py-1.5 text-xs items-center border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 ${selected.has(row.table) ? 'bg-rose-50 dark:bg-rose-950/20' : ''}`}>
                    <div className="min-w-0">
                      <div className="font-mono truncate flex items-center gap-1.5">
                        {row.table}
                        {isRed && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />}
                      </div>
                      <div className="text-[10px] text-zinc-400 truncate">{t.cn}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-zinc-500">{t.rows > 0 ? `${(t.rows / 10000).toFixed(1)}万行` : '0行'}</div>
                      <div className={`text-[11px] font-medium ${freshnessClass(t.freshness)}`}>{t.freshness}</div>
                      <div className="text-[9px] text-zinc-400 font-mono truncate" title={getScanSQL(t)}>{t.maxDate ? `→${t.maxDate!.slice(5)}` : '无日期'}</div>
                    </div>
                    {row.days.map(d => (
                      <div key={d.date} className="flex justify-center">
                        <span className={`h-5 w-5 rounded flex items-center justify-center text-[9px] ${dayStatusClass(d.status)}`}>
                          {d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : d.status === 'skipped' ? '–' : d.status === 'none' ? '·' : ''}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-center">
                      {isRed ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onRunTable?.(row.table)}>
                          <RefreshCw className="h-3 w-3 mr-0.5" />补数
                        </Button>
                      ) : (
                        <span className={`text-[10px] ${healthColorClass(deriveHealthFromScan(t)).split(' ')[0].replace('bg-', 'text-')}`}>●</span>
                      )}
                    </div>
                  </div>
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
            <CardTitle className="text-base flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-4 w-4" />数据异常自动归因 ({redTables.length})
              <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300 ml-1">SCAN ROOT CAUSE</Badge>
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
                      <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${attribution.severity === 'critical' ? 'text-rose-600 border-rose-400 bg-rose-100/50 dark:bg-rose-950/40' : 'text-amber-600 border-amber-400'}`}>
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
                      <div className="text-[10px] font-medium text-rose-700 dark:text-rose-300 mb-1 flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />根因
                      </div>
                      <div className="text-zinc-700 dark:text-zinc-300 leading-relaxed">{attribution.cause}</div>
                    </div>
                    {/* 影响 */}
                    <div className="p-2 rounded bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900">
                      <div className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1 flex items-center gap-1">
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
                      <div className="text-[10px] font-medium text-emerald-700 dark:text-emerald-300 mb-1 flex items-center gap-1">
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
                    <span className="flex items-center gap-1"><Activity className="h-3 w-3" />扫描结果: {attribution.lastError}</span>
                    <span>·</span>
                    <span>重试次数: {attribution.retries}/3</span>
                    <span>·</span>
                    <span className={attribution.estimatedFix !== '5min' ? 'text-amber-600' : 'text-emerald-600'}>预计修复: {attribution.estimatedFix}</span>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function dayStatusClass(s: string): string {
  switch (s) {
    case 'success': return 'bg-emerald-500 text-white'
    case 'failed': return 'bg-rose-500 text-white'
    case 'skipped': return 'bg-zinc-300 text-zinc-600'
    default: return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400'
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
  const t = TABLES.find(x => x.table === table)
  const scanInfo = t ? `SCAN: rows=${t.rows.toLocaleString()}, max_date=${t.maxDate ?? 'NULL'}` : ''
  const map: Record<string, Attribution> = {
    sector_stocks: {
      severity: 'warning',
      category: '空表（数据扫描）',
      cause: `数据库扫描结果：rows=0, max_date=NULL。表存在但无数据，疑似入库脚本未实现。`,
      fix: '实现入库脚本或删除该空表，重新灌数后再次扫描确认。',
      steps: ['定位脚本', '实现入库逻辑', '灌数验证', '重新扫描'],
      lastError: scanInfo,
      retries: 0,
      estimatedFix: '15min',
    },
    t_bk5_19: {
      severity: 'critical',
      category: '数据滞后（扫描检测）',
      cause: `数据库扫描结果：max_date=2026-06-24 < 最后交易日 2026-06-25，数据滞后1天。疑似入库模式矛盾导致 DELETE 逻辑错乱。`,
      fix: '排查入库模式矛盾（@meta mode vs 代码 MODE），修复后补跑缺失日期数据，再次扫描确认。',
      steps: ['扫描确认滞后', '排查模式矛盾', '修复并补数', '重新扫描'],
      lastError: scanInfo,
      retries: 3,
      estimatedFix: '30min',
    },
  }
  return map[table] || {
    severity: 'warning',
    category: '数据异常（扫描检测）',
    cause: t ? `数据库扫描结果：rows=${t.rows.toLocaleString()}, max_date=${t.maxDate ?? 'NULL'}。数据覆盖不满足要求。` : '未找到该表的扫描结果。',
    fix: '重新扫描数据库确认数据状态，排查入库流程。',
    steps: ['重新扫描', '定位异常', '修复', '验证'],
    lastError: scanInfo || '—',
    retries: 0,
    estimatedFix: '—',
  }
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: 'emerald' | 'rose' | 'amber' | 'zinc' }) {
  const map = {
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40',
    zinc: 'text-zinc-600 bg-zinc-100 dark:bg-zinc-800',
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
