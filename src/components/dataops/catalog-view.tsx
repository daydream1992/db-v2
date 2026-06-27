'use client'
import { useState, useMemo } from 'react'
import { TABLES, TableMeta } from '@/lib/dataops/mock-data'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Search, Filter, Play, RefreshCw, GitBranch, FileText, ListChecks, Database } from 'lucide-react'
import { formatRows, freshnessClass, healthColorClass, typeBadgeClass } from '@/lib/dataops/styles'

export function CatalogView({ onNavigate, onRunTable }: { onNavigate: (v: string) => void; onRunTable?: (t: string) => void }) {
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [selected, setSelected] = useState<TableMeta | null>(null)

  const filtered = useMemo(() => {
    return TABLES.filter(t => {
      if (search && !t.table.includes(search.toLowerCase()) && !t.cn.includes(search)) return false
      if (dirFilter !== 'all' && t.dir !== dirFilter) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      return true
    }).sort((a, b) => {
      if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
      return a.sort.localeCompare(b.sort)
    })
  }, [search, dirFilter, typeFilter])

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="搜索表名 / 中文名..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <FilterGroup label="目录" value={dirFilter} onChange={setDirFilter} options={[
              { v: 'all', l: '全部' }, { v: '1_入库', l: '1_入库' }, { v: '2_计算', l: '2_计算' },
            ]} />
            <FilterGroup label="类型" value={typeFilter} onChange={setTypeFilter} options={[
              { v: 'all', l: '全部' }, { v: '事实', l: '事实' }, { v: '维度', l: '维度' },
              { v: '多表', l: '多表' }, { v: '孤儿', l: '孤儿' },
            ]} />
            <Badge variant="secondary" className="ml-auto">{filtered.length} / {TABLES.length}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* 表格 */}
      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[44px_1fr_120px_80px_90px_70px_90px_100px_110px_110px] gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                <div>类型</div>
                <div>表名 / 中文名</div>
                <div>脚本</div>
                <div>sort</div>
                <div>目录</div>
                <div>schedule</div>
                <div>mode</div>
                <div className="text-right">行数</div>
                <div>最新日期</div>
                <div className="text-center">操作</div>
              </div>
              {filtered.map(t => (
                <button
                  key={t.table}
                  onClick={() => setSelected(t)}
                  className="w-full grid grid-cols-[44px_1fr_120px_80px_90px_70px_90px_100px_110px_110px] gap-2 px-3 py-2 text-xs items-center border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 text-left transition-colors"
                >
                  <div><span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${typeBadgeClass(t.type)}`}>{t.type}</span></div>
                  <div className="min-w-0">
                    <div className="font-mono font-medium truncate flex items-center gap-1.5">
                      {t.table}
                      {t.hasLintIssue && <span title="有 lint 违规" className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />}
                    </div>
                    <div className="text-[11px] text-zinc-500 truncate">{t.cn}</div>
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500 truncate" title={t.script}>{t.script}</div>
                  <div className="font-mono text-zinc-500">{t.sort}</div>
                  <div className="text-zinc-500">{t.dir}</div>
                  <div className="text-zinc-600 dark:text-zinc-400">{t.schedule}</div>
                  <div><Badge variant="outline" className="text-[10px] py-0 px-1.5">{t.mode}</Badge></div>
                  <div className="text-right font-mono text-zinc-600 dark:text-zinc-400">{formatRows(t.rows)}</div>
                  <div className={`font-mono text-[11px] ${freshnessClass(t.freshness)}`}>{t.maxDate || '—'}</div>
                  <div className="flex items-center justify-center gap-1">
                    <span className={`h-2.5 w-2.5 rounded-full ${healthColorClass(t.health).split(' ')[0]}`} title={t.freshness} />
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="py-16 text-center text-zinc-400 text-sm">无匹配表</div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 详情抽屉 */}
      <Sheet open={!!selected} onOpenChange={o => !o && setSelected(null)}>
        <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
          {selected && <TableDetail table={selected} onNavigate={onNavigate} onRunTable={onRunTable} />}
        </SheetContent>
      </Sheet>
    </div>
  )
}

function FilterGroup({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-zinc-400 flex items-center gap-1"><Filter className="h-3 w-3" />{label}</span>
      <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
        {options.map(o => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={`px-2 py-0.5 text-xs rounded transition-colors ${value === o.v ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
          >
            {o.l}
          </button>
        ))}
      </div>
    </div>
  )
}

function TableDetail({ table, onNavigate, onRunTable }: { table: TableMeta; onNavigate: (v: string) => void; onRunTable?: (t: string) => void }) {
  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${typeBadgeClass(table.type)}`}>{table.type}</span>
          <span className="font-mono">{table.table}</span>
        </SheetTitle>
        <p className="text-sm text-zinc-500 -mt-2">{table.cn}</p>
      </SheetHeader>

      <div className="space-y-5 px-4 pb-8">
        {/* 元数据 */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <Meta label="脚本" value={table.script} mono />
          <Meta label="sort" value={table.sort} mono />
          <Meta label="目录" value={table.dir} />
          <Meta label="数据源" value={table.source} />
          <Meta label="schedule" value={table.schedule} />
          <Meta label="mode" value={table.mode} />
          <Meta label="去重键" value={table.dedupKey.join(', ') || '—'} mono />
          <Meta label="重试" value={`${table.retryConfig.max}次 / ${table.retryConfig.backoff}s`} />
        </div>

        {/* 健康度 */}
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[11px] text-zinc-500">行数</div>
                <div className="text-lg font-mono font-semibold">{formatRows(table.rows)}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">最新日期</div>
                <div className={`text-sm font-mono ${freshnessClass(table.freshness)}`}>{table.maxDate || '—'}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">新鲜度</div>
                <div className={`text-sm font-medium ${freshnessClass(table.freshness)}`}>{table.freshness}</div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500">健康度</div>
                <div className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${healthColorClass(table.health)}`}>{table.health === 'green' ? '正常' : table.health === 'red' ? '异常' : '—'}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 操作 */}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => onRunTable?.(table.table)}><Play className="h-3.5 w-3.5 mr-1" />立即执行</Button>
          <Button size="sm" variant="outline" onClick={() => onRunTable?.(table.table)}><RefreshCw className="h-3.5 w-3.5 mr-1" />强制重跑</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate('lineage')}><GitBranch className="h-3.5 w-3.5 mr-1" />查血缘</Button>
          <Button size="sm" variant="outline" onClick={() => onNavigate('logs')}><FileText className="h-3.5 w-3.5 mr-1" />查日志</Button>
        </div>

        {/* Schema */}
        <div>
          <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" />Schema ({table.columns.length} 列)</div>
          <div className="rounded-md border overflow-hidden">
            <div className="grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-[10px] font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50">
              <div>列名</div><div>类型</div><div>中文</div><div className="text-center">可空</div>
            </div>
            {table.columns.map(c => (
              <div key={c.name} className="grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-xs border-t font-mono">
                <div className="truncate" title={c.name}>
                  {c.name}
                  {/[^\x00-\x7F]/.test(c.name) && <span className="ml-1 text-[9px] text-rose-500">⚠中文</span>}
                </div>
                <div className="text-sky-600 dark:text-sky-400">{c.type}</div>
                <div className="text-zinc-500 font-sans truncate">{c.cn}</div>
                <div className="text-center text-zinc-400">{c.nullable ? '✓' : '—'}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 依赖关系 */}
        <div>
          <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />依赖关系</div>
          <div className="space-y-2">
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">上游（依赖的库内表）</div>
              <div className="flex flex-wrap gap-1">
                {table.dependsOn.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.dependsOn.map(d => <Badge key={d} variant="secondary" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">外部数据源</div>
              <div className="flex flex-wrap gap-1">
                {table.sourceDeps.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.sourceDeps.map(d => <Badge key={d} variant="outline" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">下游（被依赖的表）</div>
              <div className="flex flex-wrap gap-1">
                {table.downstream.length === 0 ? <span className="text-xs text-zinc-400">无</span> :
                  table.downstream.map(d => <Badge key={d} variant="secondary" className="font-mono text-[10px]">{d}</Badge>)}
              </div>
            </div>
          </div>
        </div>

        {table.hasLintIssue && (
          <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
            <div className="text-xs font-medium text-rose-700 dark:text-rose-300 flex items-center gap-1.5 mb-1">
              <ListChecks className="h-3.5 w-3.5" />该表有规范违规
            </div>
            <Button size="sm" variant="link" className="h-auto p-0 text-xs text-rose-600" onClick={() => onNavigate('lint')}>查看 lint 详情 →</Button>
          </div>
        )}
      </div>
    </>
  )
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-zinc-400">{label}</div>
      <div className={`text-xs ${mono ? 'font-mono' : ''} text-zinc-700 dark:text-zinc-300 truncate`} title={value}>{value}</div>
    </div>
  )
}
