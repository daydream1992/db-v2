'use client'
import { useState, useMemo } from 'react'
import { TABLES, TableMeta, PIPELINE_RUNS, genSampleData, getColumnLintIssues, LINT_RULES } from '@/lib/dataops/mock-data'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Search, Filter, Play, RefreshCw, GitBranch, FileText, ListChecks, Database, Table2, History, AlertTriangle, CheckCircle2, XCircle, SkipForward, Copy } from 'lucide-react'
import { formatRows, freshnessClass, healthColorClass, typeBadgeClass, runStatusClass, triggerClass, formatDuration } from '@/lib/dataops/styles'
import { toast } from 'sonner'

export function CatalogView({ onNavigate, onRunTable }: { onNavigate: (v: string) => void; onRunTable?: (t: string) => void }) {
  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [healthFilter, setHealthFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'dir' | 'rows' | 'freshness' | 'table'>('dir')
  const [selected, setSelected] = useState<TableMeta | null>(null)

  const filtered = useMemo(() => {
    const result = TABLES.filter(t => {
      if (search && !t.table.includes(search.toLowerCase()) && !t.cn.includes(search)) return false
      if (dirFilter !== 'all' && t.dir !== dirFilter) return false
      if (typeFilter !== 'all' && t.type !== typeFilter) return false
      if (healthFilter !== 'all' && t.health !== healthFilter) return false
      return true
    })
    result.sort((a, b) => {
      if (sortBy === 'rows') return b.rows - a.rows
      if (sortBy === 'table') return a.table.localeCompare(b.table)
      if (sortBy === 'freshness') {
        const order = { '最新': 0, '滞后': 1, '无日期列': 2, '空表': 3, '—': 4 }
        return (order[a.freshness as keyof typeof order] ?? 5) - (order[b.freshness as keyof typeof order] ?? 5)
      }
      // default: dir
      if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
      return a.sort.localeCompare(b.sort)
    })
    return result
  }, [search, dirFilter, typeFilter, healthFilter, sortBy])

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
            <FilterGroup label="健康度" value={healthFilter} onChange={setHealthFilter} options={[
              { v: 'all', l: '全部' }, { v: 'green', l: '正常' }, { v: 'yellow', l: '待查' }, { v: 'red', l: '异常' }, { v: 'white', l: 'once' },
            ]} />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400 flex items-center gap-1"><Filter className="h-3 w-3" />排序</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {([['dir', '目录'], ['rows', '行数'], ['freshness', '新鲜度'], ['table', '表名']] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setSortBy(k)} className={`px-2 py-0.5 text-xs rounded transition-colors ${sortBy === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{l}</button>
                ))}
              </div>
            </div>
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
  const [activeTab, setActiveTab] = useState<'schema' | 'sample' | 'history' | 'lint'>('schema')
  const sampleData = useMemo(() => genSampleData(table), [table])
  const columnIssues = useMemo(() => getColumnLintIssues(table), [table])
  const tableRuns = useMemo(() => PIPELINE_RUNS.filter(r => r.table === table.table), [table])
  const tableLintRules = useMemo(() => LINT_RULES.filter(r => r.violations.some(v => v.table === table.table)), [table])

  const copyTableName = () => {
    navigator.clipboard?.writeText(table.table)
    toast.success(`已复制表名：${table.table}`)
  }

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${typeBadgeClass(table.type)}`}>{table.type}</span>
          <span className="font-mono">{table.table}</span>
          <button onClick={copyTableName} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-400" title="复制表名">
            <Copy className="h-3 w-3" />
          </button>
          {table.hasLintIssue && <Badge variant="outline" className="text-rose-600 border-rose-300 text-[10px]"><AlertTriangle className="h-3 w-3 mr-0.5" />lint</Badge>}
        </SheetTitle>
        <p className="text-sm text-zinc-500 -mt-2">{table.cn}</p>
      </SheetHeader>

      <div className="space-y-4 px-4 pb-8">
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

        {/* Tabs: Schema / Sample Data / Run History / Lint */}
        <Tabs value={activeTab} onValueChange={v => setActiveTab(v as 'schema' | 'sample' | 'history' | 'lint')}>
          <TabsList className="grid grid-cols-4 w-full">
            <TabsTrigger value="schema" className="text-xs gap-1">
              <Database className="h-3 w-3" /> Schema
              <span className="text-[10px] text-zinc-400">{table.columns.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sample" className="text-xs gap-1">
              <Table2 className="h-3 w-3" /> 样例
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs gap-1">
              <History className="h-3 w-3" /> 历史
              <span className="text-[10px] text-zinc-400">{tableRuns.length}</span>
            </TabsTrigger>
            <TabsTrigger value="lint" className="text-xs gap-1">
              <ListChecks className="h-3 w-3" /> Lint
              {tableLintRules.length > 0 && <span className="text-[10px] text-rose-500">{tableLintRules.length}</span>}
            </TabsTrigger>
          </TabsList>

          {/* Schema Tab */}
          <TabsContent value="schema" className="mt-3">
            <div className="rounded-md border overflow-hidden">
              <div className="grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-[10px] font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50">
                <div>列名</div><div>类型</div><div>中文</div><div className="text-center">可空</div>
              </div>
              {table.columns.map(c => {
                const hasIssue = columnIssues.some(i => i.column === c.name)
                return (
                  <div key={c.name} className={`grid grid-cols-[1fr_90px_1fr_50px] gap-2 px-2 py-1.5 text-xs border-t font-mono ${hasIssue ? 'bg-rose-50/50 dark:bg-rose-950/20' : ''}`}>
                    <div className="truncate flex items-center gap-1" title={c.name}>
                      <span className={hasIssue ? 'text-rose-600 dark:text-rose-400' : ''}>{c.name}</span>
                      {hasIssue && <AlertTriangle className="h-3 w-3 text-rose-500 flex-shrink-0" />}
                    </div>
                    <div className="text-sky-600 dark:text-sky-400">{c.type}</div>
                    <div className="text-zinc-500 font-sans truncate">{c.cn}</div>
                    <div className="text-center text-zinc-400">{c.nullable ? '✓' : '—'}</div>
                  </div>
                )
              })}
            </div>
          </TabsContent>

          {/* Sample Data Tab */}
          <TabsContent value="sample" className="mt-3">
            <div className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
              <Table2 className="h-3 w-3" /> 前 {sampleData.rows.length} 行样例数据（mock）
            </div>
            <div className="rounded-md border overflow-x-auto">
              <div className="min-w-full">
                <div className="grid auto-cols-min grid-flow-col gap-0 bg-zinc-50 dark:bg-zinc-900/50 border-b">
                  {sampleData.columns.map(c => (
                    <div key={c} className="px-2 py-1.5 text-[10px] font-medium text-zinc-500 font-mono whitespace-nowrap border-r">{c}</div>
                  ))}
                </div>
                {sampleData.rows.map((row, i) => (
                  <div key={i} className="grid auto-cols-min grid-flow-col gap-0 text-xs border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 font-mono">
                    {row.map((cell, j) => (
                      <div key={j} className={`px-2 py-1 whitespace-nowrap border-r ${typeof cell === 'number' ? 'text-sky-600 dark:text-sky-400 text-right' : 'text-zinc-700 dark:text-zinc-300'}`}>
                        {String(cell)}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-2 text-[10px] text-zinc-400 flex items-center gap-2">
              <Database className="h-3 w-3" />
              <span>共 {formatRows(table.rows)} 行 · 显示前 {sampleData.rows.length} 行样例</span>
            </div>
          </TabsContent>

          {/* Run History Tab */}
          <TabsContent value="history" className="mt-3">
            {tableRuns.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">该表暂无执行记录</div>
            ) : (
              <div className="space-y-1.5">
                {tableRuns.map(r => (
                  <div key={r.id} className="p-2 rounded border border-zinc-200 dark:border-zinc-700 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] text-zinc-400">#{r.id}</span>
                      <Badge variant="outline" className={`text-[9px] py-0 px-1.5 ${triggerClass(r.trigger)}`}>{r.trigger}</Badge>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${runStatusClass(r.status)}`}>
                        {r.status === 'success' && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
                        {r.status === 'failed' && <XCircle className="h-3 w-3 mr-0.5" />}
                        {r.status === 'skipped' && <SkipForward className="h-3 w-3 mr-0.5" />}
                        {r.status}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-zinc-400">{r.startedAt.slice(5)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-zinc-500">
                      <span>耗时 {formatDuration(r.durationSec)}</span>
                      <span>·</span>
                      <span>入库 {r.rowsIn ? formatRows(r.rowsIn) : '—'} 行</span>
                      {r.force && <Badge variant="outline" className="text-[9px] py-0 px-1 text-amber-600 border-amber-300">force</Badge>}
                    </div>
                    {r.error && (
                      <div className="mt-1 p-1.5 rounded bg-rose-50 dark:bg-rose-950/30 text-[10px] text-rose-700 dark:text-rose-300 font-mono">
                        {r.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Lint Tab */}
          <TabsContent value="lint" className="mt-3">
            {tableLintRules.length === 0 && columnIssues.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400 flex flex-col items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                <span>该表无 lint 违规</span>
              </div>
            ) : (
              <div className="space-y-2">
                {/* 表级 lint 违规 */}
                {tableLintRules.map(rule => {
                  const violations = rule.violations.filter(v => v.table === table.table)
                  return violations.map((v, i) => (
                    <div key={`${rule.id}-${i}`} className="p-2.5 rounded border border-zinc-200 dark:border-zinc-700 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={`text-[9px] py-0 px-1.5 font-mono ${rule.level === 'RED' ? 'text-rose-600 border-rose-300' : rule.level === 'YELLOW' ? 'text-amber-600 border-amber-300' : 'text-sky-600 border-sky-300'}`}>
                          {rule.level}
                        </Badge>
                        <span className="font-mono font-medium">{rule.id}</span>
                        <span className="text-zinc-600 dark:text-zinc-400">{rule.name}</span>
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400 mb-1.5">{v.detail}</div>
                      <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-start gap-1">
                        <RefreshCw className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{v.fix}</span>
                      </div>
                    </div>
                  ))
                })}
                {/* 列级 lint 违规 */}
                {columnIssues.length > 0 && (
                  <div className="p-2.5 rounded border border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20 text-xs">
                    <div className="font-medium text-rose-700 dark:text-rose-300 mb-1.5 flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5" /> R004: 中文列名 ({columnIssues.length})
                    </div>
                    <div className="space-y-1">
                      {columnIssues.map((issue, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-rose-600 dark:text-rose-400">{issue.column}</span>
                          <span className="text-zinc-400">→</span>
                          <span className="text-emerald-600 dark:text-emerald-400">{issue.fix}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Button size="sm" variant="link" className="h-auto p-0 text-xs text-sky-600" onClick={() => onNavigate('lint')}>查看全部 lint 规则 →</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* 依赖关系（始终展示） */}
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
