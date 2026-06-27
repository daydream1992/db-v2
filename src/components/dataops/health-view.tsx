'use client'
import { useState, useMemo } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench, Activity, TrendingUp, BarChart3, Filter } from 'lucide-react'
import { HEALTH_MATRIX } from '@/lib/dataops/mock-data'
import { freshnessClass, healthColorClass } from '@/lib/dataops/styles'

export function HealthView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirFilter, setDirFilter] = useState<string>('all')
  const redTables = TABLES.filter(t => t.health === 'red')
  const yellowTables = TABLES.filter(t => t.health === 'yellow')
  const greenTables = TABLES.filter(t => t.health === 'green')
  const whiteTables = TABLES.filter(t => t.health === 'white')

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
    const days = ['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25']
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
        green: tables.filter(t => t.health === 'green').length,
        yellow: tables.filter(t => t.health === 'yellow').length,
        red: tables.filter(t => t.health === 'red').length,
        white: tables.filter(t => t.health === 'white').length,
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
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="text-[9px] text-zinc-500 font-mono">{d.rate}%</div>
                    <div className="w-full flex flex-col-reverse rounded overflow-hidden" style={{ height: `${(d.total / maxTotal) * 140}px` }}>
                      <div className="bg-emerald-500 group-hover:bg-emerald-600 transition-colors" style={{ height: `${d.success * unit}px` }} title={`成功 ${d.success}`} />
                      <div className="bg-rose-500 group-hover:bg-rose-600 transition-colors" style={{ height: `${d.failed * unit}px` }} title={`失败 ${d.failed}`} />
                      <div className="bg-zinc-300 dark:bg-zinc-600 group-hover:bg-zinc-400 transition-colors" style={{ height: `${d.skipped * unit}px` }} title={`跳过 ${d.skipped}`} />
                      <div className="bg-zinc-100 dark:bg-zinc-800 group-hover:bg-zinc-200 transition-colors" style={{ height: `${d.pending * unit}px` }} title={`待执行 ${d.pending}`} />
                    </div>
                    <div className="text-[10px] text-zinc-400">{d.date}</div>
                  </div>
                )
              })}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> 成功</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" /> 失败</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-300" /> 跳过</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-100 dark:bg-zinc-800 border border-zinc-200" /> 待执行</span>
              <span className="ml-auto text-zinc-400">7 日均成功率 {Math.round(dailyTrend.reduce((s, d) => s + d.rate, 0) / dailyTrend.length)}%</span>
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
            <Badge variant="outline" className="text-[10px]">最后交易日 2026-06-25</Badge>
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
                {['06-19', '06-20', '06-21', '06-22', '06-23', '06-24', '06-25'].map(d => <div key={d} className="text-center">{d}</div>)}
                <div className="text-center">操作</div>
              </div>
              {filteredMatrix.map(row => {
                const t = TABLES.find(x => x.table === row.table)!
                const isRed = t.health === 'red'
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
                    </div>
                    {row.days.map(d => (
                      <div key={d.date} className="flex justify-center">
                        <span className={`h-5 w-5 rounded flex items-center justify-center text-[9px] ${dayStatusClass(d.status)}`}>
                          {d.status === 'success' ? '✓' : d.status === 'failed' ? '✗' : d.status === 'skipped' ? '–' : ''}
                        </span>
                      </div>
                    ))}
                    <div className="flex justify-center">
                      {isRed ? (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => onRunTable?.(row.table)}>
                          <RefreshCw className="h-3 w-3 mr-0.5" />补数
                        </Button>
                      ) : (
                        <span className={`text-[10px] ${healthColorClass(t.health).split(' ')[0].replace('bg-', 'text-')}`}>●</span>
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
              <AlertTriangle className="h-4 w-4" />异常表自动归因 ({redTables.length})
              <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-300 ml-1">ROOT CAUSE</Badge>
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
                    <span className="flex items-center gap-1"><Activity className="h-3 w-3" />最后出错: {attribution.lastError}</span>
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
  const map: Record<string, Attribution> = {
    sector_stocks: {
      severity: 'warning',
      category: '实现缺失',
      cause: '脚本未实现：ensure_table 里表名字面量写着「表名」，未真正建表也未灌数。',
      fix: '删除该脚本，或正确实现 ensure_table + fetch_data + save_data。',
      steps: ['定位脚本', '修复字面量', '本地验证', '重新入库'],
      lastError: '2026-06-25 18:42:12',
      retries: 0,
      estimatedFix: '15min',
    },
    t_bk5_19: {
      severity: 'critical',
      category: '配置矛盾',
      cause: '@meta mode=increment 与代码 MODE="full" 矛盾，DELETE 逻辑错乱导致数据滞后 1 天。',
      fix: '统一 @meta 与代码 MODE 为 full（全量重灌语义），并补跑昨日数据。',
      steps: ['改 YAML @meta', '改代码常量', 'lint 校验', 'force 补数'],
      lastError: '2026-06-25 18:42:10',
      retries: 3,
      estimatedFix: '30min',
    },
  }
  return map[table] || {
    severity: 'warning',
    category: '未知',
    cause: '未配置归因规则，请检查脚本日志确认根因。',
    fix: '查看 logs/run_YYYYMMDD.log 定位异常堆栈。',
    steps: ['查日志', '定位异常', '修复', '重跑'],
    lastError: '—',
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
