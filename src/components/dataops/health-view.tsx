'use client'
import { useState } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle2, RefreshCw, Wrench, Activity } from 'lucide-react'
import { HEALTH_MATRIX } from '@/lib/dataops/mock-data'
import { freshnessClass, healthColorClass } from '@/lib/dataops/styles'

export function HealthView({ onRunTable }: { onRunTable?: (t: string) => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
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

  return (
    <div className="space-y-5">
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="健康" value={greenTables.length} color="emerald" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="异常/滞后" value={redTables.length} color="rose" />
        <StatCard icon={<AlertTriangle className="h-4 w-4" />} label="待查" value={yellowTables.length} color="amber" />
        <StatCard icon={<Activity className="h-4 w-4" />} label="不适用(once)" value={whiteTables.length} color="zinc" />
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
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base">健康度矩阵 · 近 7 天</CardTitle>
          <div className="flex items-center gap-2">
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
              {HEALTH_MATRIX.map(row => {
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

      {/* 红表示例详情 */}
      {redTables.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-rose-600">
              <AlertTriangle className="h-4 w-4" />异常表详情 ({redTables.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {redTables.map(t => (
              <div key={t.table} className="p-3 rounded-md border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20">
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="font-mono font-medium text-sm">{t.table}</span>
                    <span className="text-xs text-zinc-500 ml-2">{t.cn}</span>
                  </div>
                  <Button size="sm" variant="destructive" onClick={() => onRunTable?.(t.table)}>
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />强制重跑
                  </Button>
                </div>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {t.table === 'sector_stocks' && '空表：脚本未实现，ensure_table 里表名字面量写着「表名」。建议删除或实现。'}
                  {t.table === 't_bk5_19' && '滞后：最新数据 2026-06-24 < 最后交易日 2026-06-25。@meta mode=increment 与代码 MODE="full" 矛盾导致 DELETE 逻辑错乱。'}
                </div>
              </div>
            ))}
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
