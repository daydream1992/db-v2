'use client'
import { useState, useMemo, useCallback, useEffect } from 'react'
import { TABLES, ColumnDef } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Database, Search, BookOpen, Download, Copy, Hash, Type, AlertTriangle, Check, FileText, GitCompare, ArrowRight, Plus, Minus, Edit3, TableProperties, Github, Loader2, Rows3 } from 'lucide-react'
import { toast } from 'sonner'
import { APP_CONFIG } from '@/lib/dataops/config'

type GroupBy = 'table' | 'dir' | 'type'
type TopTab = 'fields' | 'diff'

// ---- Schema Diff mock 数据 ----
// 模拟 v0.9 (2026-05-20) → v1.0 (2026-06-25) 的 schema 演进
type DiffKind = 'added_table' | 'removed_table' | 'added_col' | 'removed_col' | 'renamed_col' | 'type_changed'
interface SchemaDiff {
  kind: DiffKind
  table: string
  field?: string
  oldField?: string
  newField?: string
  oldType?: string
  newType?: string
  detail: string
}

const SCHEMA_VERSIONS = [
  { version: 'v1.0', date: '2026-06-25', tables: TABLES.length, cols: TABLES.reduce((s, t) => s + t.columns.length, 0), author: 'dataops-bot', note: '完成 R004 列名英化 + 新增 capital_info 回补' },
  { version: 'v0.9', date: '2026-05-20', tables: 24, cols: 142, author: 'manual', note: '初始迁移版本，含中文列名' },
]

const SCHEMA_DIFFS: SchemaDiff[] = [
  { kind: 'added_table', table: 'capital_info', detail: '新增股本数据表（全量回补 298万行）' },
  { kind: 'added_table', table: 'stock_block_relation', detail: '新增板块成份股关系表' },
  { kind: 'added_col', table: 'stock_daily_kline', field: '换手率', detail: '新增换手率字段（DOUBLE, 可空）' },
  { kind: 'added_col', table: 'stock_daily_kline', field: '前复权因子', detail: '新增前复权因子字段（DOUBLE, 可空）' },
  { kind: 'renamed_col', table: 't_bk5_19', oldField: '涨跌数', newField: 'up_down_count', detail: '中文列名 → 英文 (R004 规范化)' },
  { kind: 'renamed_col', table: 't_bk5_19', oldField: '总市值', newField: 'total_mv', detail: '中文列名 → 英文 (R004 规范化)' },
  { kind: 'renamed_col', table: 'market_sc1_42', oldField: '涨跌数', newField: 'up_down_count', detail: '中文列名 → 英文 (R004 规范化)' },
  { kind: 'renamed_col', table: 'market_sc1_42', oldField: '总市值', newField: 'total_mv', detail: '中文列名 → 英文 (R004 规范化)' },
  { kind: 'renamed_col', table: 'stock_block_relation', oldField: '板块代码', newField: 'block_code', detail: '中文列名 → 英文' },
  { kind: 'renamed_col', table: 'stock_block_relation', oldField: '板块名称', newField: 'block_name', detail: '中文列名 → 英文' },
  { kind: 'renamed_col', table: 'stock_block_relation', oldField: '板块类型', newField: 'block_type', detail: '中文列名 → 英文' },
  { kind: 'renamed_col', table: 'stock_block_relation', oldField: '成分股数', newField: 'constituent_count', detail: '中文列名 → 英文' },
  { kind: 'renamed_col', table: 'stock_daily_kline', oldField: '涨跌幅', newField: 'change_pct', detail: '中文列名 → 英文' },
  { kind: 'removed_col', table: 'sector_stocks', field: '板块代码', detail: '删除冗余字段（与 block_code 重复）' },
  { kind: 'type_changed', table: 'stock_kline_1m', field: 'volume', oldType: 'INT', newType: 'BIGINT', detail: '类型扩大：1分钟K线 volume 超 INT 范围' },
]

const diffKindMeta: Record<DiffKind, { label: string; icon: typeof Plus; color: string; bg: string }> = {
  added_table: { label: '新增表', icon: TableProperties, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900' },
  removed_table: { label: '删除表', icon: Minus, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900' },
  added_col: { label: '新增字段', icon: Plus, color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900' },
  removed_col: { label: '删除字段', icon: Minus, color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900' },
  renamed_col: { label: '重命名', icon: ArrowRight, color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900' },
  type_changed: { label: '类型变更', icon: Edit3, color: 'text-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900' },
}

export function DictionaryView() {
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string>('stock_daily_kline')
  const [groupBy, setGroupBy] = useState<GroupBy>('table')
  const [colSearch, setColSearch] = useState('')
  const [topTab, setTopTab] = useState<TopTab>('fields')
  const [diffFilter, setDiffFilter] = useState<DiffKind | 'all'>('all')
  const [diffTableFilter, setDiffTableFilter] = useState<string>('all')

  // Real DuckDB dictionary: Map<table, {name,type,nullable}[]>.
  // nullable from DuckDB is "YES"/"NO". Falls back to mock columns while loading.
  type RealCol = { name: string; type: string; nullable: string }
  const [dictMap, setDictMap] = useState<Map<string, RealCol[]> | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/dataops?op=dictionary', { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<{ tables: { table: string; columns: RealCol[] }[] }> })
      .then(data => {
        if (cancelled) return
        const m = new Map<string, RealCol[]>()
        for (const t of data.tables || []) m.set(t.table, t.columns || [])
        setDictMap(m)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Build the effective columns for a table: real DuckDB name/type/nullable,
  // merged with mock Chinese descriptions (by column name) when available.
  const columnsFor = useCallback((tableName: string): ColumnDef[] => {
    const real = dictMap?.get(tableName)
    if (!real) {
      return TABLES.find(t => t.table === tableName)?.columns ?? []
    }
    const mockCols = TABLES.find(t => t.table === tableName)?.columns ?? []
    const mockByName = new Map(mockCols.map(c => [c.name, c.cn]))
    return real.map(rc => ({
      name: rc.name,
      type: rc.type,
      cn: mockByName.get(rc.name) ?? '',
      nullable: rc.nullable !== 'NO',
    }))
  }, [dictMap])

  const filteredTables = useMemo(() => {
    return TABLES.filter(t =>
      !search || t.table.includes(search.toLowerCase()) || t.cn.includes(search)
    ).sort((a, b) => a.dir.localeCompare(b.dir) || a.sort.localeCompare(b.sort))
  }, [search])

  // 分组结构
  const grouped = useMemo(() => {
    const m = new Map<string, typeof TABLES>()
    filteredTables.forEach(t => {
      const key = groupBy === 'table' ? t.table : groupBy === 'dir' ? t.dir : t.type
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(t)
    })
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filteredTables, groupBy])

  const selected = TABLES.find(t => t.table === selectedTable)

  // 字段过滤
  const filteredColumns = useMemo(() => {
    if (!selected) return []
    if (!colSearch) return selected.columns
    return selected.columns.filter(c =>
      c.name.toLowerCase().includes(colSearch.toLowerCase()) ||
      c.cn.includes(colSearch) ||
      c.type.toLowerCase().includes(colSearch.toLowerCase())
    )
  }, [selected, colSearch])

  // 统计
  const totalCols = TABLES.reduce((s, t) => s + t.columns.length, 0)
  const chineseCols = TABLES.reduce((s, t) => s + t.columns.filter(c => /[^\x00-\x7F]/.test(c.name)).length, 0)
  const nullableCols = TABLES.reduce((s, t) => s + t.columns.filter(c => c.nullable).length, 0)
  const typeDist = useMemo(() => {
    const m = new Map<string, number>()
    TABLES.forEach(t => t.columns.forEach(c => m.set(c.type, (m.get(c.type) || 0) + 1)))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [])

  const copyTable = (tableName: string) => {
    navigator.clipboard?.writeText(tableName)
    toast.success(`已复制表名：${tableName}`)
  }

  // Schema Diff 统计
  const diffStats = useMemo(() => {
    const byKind = SCHEMA_DIFFS.reduce((m, d) => { m[d.kind] = (m[d.kind] || 0) + 1; return m }, {} as Record<DiffKind, number>)
    const affectedTables = new Set(SCHEMA_DIFFS.map(d => d.table))
    return { byKind, affectedTables: affectedTables.size, total: SCHEMA_DIFFS.length }
  }, [])

  const filteredDiffs = useMemo(() => {
    return SCHEMA_DIFFS.filter(d => {
      if (diffFilter !== 'all' && d.kind !== diffFilter) return false
      if (diffTableFilter !== 'all' && d.table !== diffTableFilter) return false
      return true
    })
  }, [diffFilter, diffTableFilter])

  const diffTables = useMemo(() => Array.from(new Set(SCHEMA_DIFFS.map(d => d.table))).sort(), [])

  const [syncing, setSyncing] = useState(false)

  const exportDict = useCallback(async () => {
    try {
      toast.info('正在生成数据字典 Markdown...')
      const res = await fetch('/api/dictionary/export')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'data_dictionary.md'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('数据字典已导出 (data_dictionary.md)')
    } catch (err) {
      toast.error(`导出失败: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [])

  const syncToGitHub = useCallback(async () => {
    setSyncing(true)
    try {
      // Build dictionary payload matching data_dictionary.json format
      const dictPayload: Record<string, { cn: string; columns: Array<{ name: string; type: string; cn: string }> }> = {}
      TABLES.forEach(t => {
        dictPayload[t.table] = {
          cn: t.cn,
          columns: t.columns.map(c => ({ name: c.name, type: c.type, cn: c.cn })),
        }
      })

      // Build tables payload matching tables.json format
      const tablesPayload: Record<string, Record<string, unknown>> = {}
      TABLES.forEach(t => {
        tablesPayload[t.table] = {
          table: t.table,
          cn: t.cn,
          dir: t.dir,
          sort: t.sort,
          schedule: t.schedule,
          mode: t.mode,
          source: t.source,
          script: t.script,
          dependsOn: t.dependsOn,
          dedupKey: t.dedupKey,
        }
      })

      const res = await fetch('/api/github-sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tables: tablesPayload,
          dictionary: dictPayload,
          commitMessage: `dataops: sync data dictionary ${new Date().toISOString().slice(0, 19)}`,
        }),
      })

      const data = await res.json() as { success?: boolean; error?: string; results?: Record<string, { success?: boolean; error?: string }> }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Push failed')
      }

      const tablesOk = data.results?.tables?.success ?? false
      const dictOk = data.results?.dictionary?.success ?? false

      if (tablesOk && dictOk) {
        toast.success(`已同步到 GitHub: ${APP_CONFIG.gitHubRepo} (${APP_CONFIG.gitHubBranch})`)
      } else {
        const failedParts: string[] = []
        if (!tablesOk) failedParts.push(`tables.json: ${data.results?.tables?.error || 'failed'}`)
        if (!dictOk) failedParts.push(`data_dictionary.json: ${data.results?.dictionary?.error || 'failed'}`)
        toast.warning(`部分同步失败: ${failedParts.join('; ')}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      if (msg.includes('GITHUB_TOKEN')) {
        toast.error('同步失败: GITHUB_TOKEN 未配置，无法推送到 GitHub')
      } else {
        toast.error(`同步失败: ${msg}`)
      }
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={exportDict}
        >
          <Download className="h-3.5 w-3.5" />
          导出 Markdown
        </Button>
        <Button
          size="sm"
          variant={syncing ? 'secondary' : 'default'}
          className="h-8 text-xs gap-1.5"
          onClick={syncToGitHub}
          disabled={syncing}
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Github className="h-3.5 w-3.5" />
          )}
          {syncing ? '同步中...' : '同步到 GitHub'}
        </Button>
      </div>

      {/* 顶部 Tab 切换 */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTopTab('fields')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${topTab === 'fields' ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
        >
          <BookOpen className="h-3.5 w-3.5" /> 字段视图
        </button>
        <button
          onClick={() => setTopTab('diff')}
          className={`px-3 py-1.5 text-sm rounded-md transition-colors flex items-center gap-1.5 ${topTab === 'diff' ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}
        >
          <GitCompare className="h-3.5 w-3.5" /> Schema Diff
          <Badge variant="secondary" className="text-[10px] py-0 px-1.5 ml-0.5">{SCHEMA_DIFFS.length}</Badge>
        </button>
      </div>

      {topTab === 'fields' ? (
        <>
          {/* 顶部统计 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-600"><Database className="h-4 w-4" /></div>
            <div>
              <div className="text-2xl font-semibold leading-none">{TABLES.length}</div>
              <div className="text-[11px] text-zinc-500 mt-1">表总数</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-fuchsia-50 dark:bg-fuchsia-950/40 text-fuchsia-600"><Hash className="h-4 w-4" /></div>
            <div>
              <div className="text-2xl font-semibold leading-none">{totalCols}</div>
              <div className="text-[11px] text-zinc-500 mt-1">字段总数</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600"><AlertTriangle className="h-4 w-4" /></div>
            <div>
              <div className="text-2xl font-semibold leading-none">{chineseCols}</div>
              <div className="text-[11px] text-zinc-500 mt-1">中文列名 (待修)</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600"><Check className="h-4 w-4" /></div>
            <div>
              <div className="text-2xl font-semibold leading-none">{nullableCols}</div>
              <div className="text-[11px] text-zinc-500 mt-1">可空字段</div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-300px)]">
        {/* 左侧表树 */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2 space-y-2">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-fuchsia-500" />表清单</span>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={exportDict} title="导出 Markdown">
                <FileText className="h-3 w-3" />
              </Button>
            </CardTitle>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <Input placeholder="搜索表名..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>
            <Tabs value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
              <TabsList className="grid grid-cols-3 w-full h-7 text-[10px]">
                <TabsTrigger value="table" className="text-[10px] py-0">按表</TabsTrigger>
                <TabsTrigger value="dir" className="text-[10px] py-0">按目录</TabsTrigger>
                <TabsTrigger value="type" className="text-[10px] py-0">按类型</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="p-2 flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="space-y-2">
                {groupBy === 'table' ? (
                  // 按表分组：直接平铺
                  filteredTables.map(t => (
                    <TableListItem key={t.table} t={t} selected={selectedTable === t.table} onSelect={() => setSelectedTable(t.table)} />
                  ))
                ) : (
                  // 按目录/类型分组
                  grouped.map(([group, tables]) => (
                    <div key={group}>
                      <div className="text-[10px] font-medium text-zinc-400 px-2 py-1 sticky top-0 bg-card">
                        {group} <span className="text-zinc-300">({tables.length})</span>
                      </div>
                      {tables.map(t => (
                        <TableListItem key={t.table} t={t} selected={selectedTable === t.table} onSelect={() => setSelectedTable(t.table)} />
                      ))}
                    </div>
                  ))
                )}
                {filteredTables.length === 0 && <div className="text-center text-xs text-zinc-400 py-8">无匹配</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* 右侧字段表 */}
        <Card className="flex flex-col">
          <CardHeader className="pb-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="h-4 w-4 text-sky-500" />
                <button onClick={() => copyTable(selected?.table || '')} className="font-mono hover:text-sky-600 dark:hover:text-sky-400 flex items-center gap-1" title="点击复制表名">
                  {selected?.table}
                  <Copy className="h-3 w-3 opacity-50" />
                </button>
                <Badge variant="outline" className="ml-1">{selected?.columns.length} 列</Badge>
                {selected && (
                  <Badge variant="secondary" className="ml-1 text-[10px] gap-1">
                    <Rows3 className="h-2.5 w-2.5" />
                    {selected.rows.toLocaleString()} 行
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={exportDict}>
                  <FileText className="h-3 w-3 mr-1" />导出
                </Button>
              </div>
            </div>
            <p className="text-sm text-zinc-500 -mt-1">{selected?.cn} · 来源 {selected?.source}</p>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
              <Input placeholder="搜索字段名 / 中文 / 类型..." value={colSearch} onChange={e => setColSearch(e.target.value)} className="pl-8 h-8 text-sm" />
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[1fr_120px_1fr_60px_1fr_36px] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                  <div>列名</div><div>类型</div><div>中文名</div><div className="text-center">可空</div><div>备注</div><div></div>
                </div>
                {filteredColumns.map((c, idx) => {
                  const hasChinese = /[^\x00-\x7F]/.test(c.name)
                  const copyFieldName = () => {
                    navigator.clipboard?.writeText(c.name)
                    toast.success(`已复制: ${c.name}`)
                  }
                  return (
                    <div key={c.name} className={`grid grid-cols-[1fr_120px_1fr_60px_1fr_36px] gap-2 px-4 py-2 text-xs border-b last:border-0 items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40 ${idx % 2 === 0 ? 'bg-zinc-50/50 dark:bg-zinc-900/20' : ''}`}>
                      <div className="font-mono flex items-center gap-1.5">
                        <span className={hasChinese ? 'text-rose-600 dark:text-rose-400' : ''}>{c.name}</span>
                        {hasChinese && <span className="text-[9px] px-1 py-0 rounded bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">中文</span>}
                        {!c.nullable && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">NN</span>}
                      </div>
                      <div>
                        <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800">
                          {c.type}
                        </Badge>
                      </div>
                      <div className="text-zinc-600 dark:text-zinc-400">{c.cn}</div>
                      <div className="text-center">
                        {c.nullable ? <Check className="h-3.5 w-3.5 text-emerald-500 inline" /> : <span className="text-zinc-300">—</span>}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {hasChinese ? '建议改英文' : c.nullable ? '允许 NULL' : '主键/非空'}
                      </div>
                      <div className="flex justify-center">
                        <button
                          onClick={copyFieldName}
                          className="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                          title="复制字段名"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  )
                })}
                {filteredColumns.length === 0 && <div className="py-12 text-center text-zinc-400 text-sm">无匹配字段</div>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 底部：类型分布 + 饼图 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-4 w-4 text-emerald-500" />
            字段类型分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col md:flex-row items-start gap-6">
            {/* Donut chart */}
            <div className="flex-shrink-0">
              <svg width="160" height="160" viewBox="0 0 160 160">
                {(() => {
                  const total = typeDist.reduce((s, [, c]) => s + c, 0)
                  let cumulative = 0
                  const colors = ['#0ea5e9', '#f59e0b', '#10b981', '#f43f5e', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16']
                  return typeDist.map(([type, count], i) => {
                    const pct = count / total
                    const startAngle = cumulative * 360
                    cumulative += pct
                    const endAngle = cumulative * 360
                    const startRad = (startAngle - 90) * Math.PI / 180
                    const endRad = (endAngle - 90) * Math.PI / 180
                    const largeArc = pct > 0.5 ? 1 : 0
                    const outerR = 72
                    const innerR = 44
                    const x1o = 80 + outerR * Math.cos(startRad)
                    const y1o = 80 + outerR * Math.sin(startRad)
                    const x2o = 80 + outerR * Math.cos(endRad)
                    const y2o = 80 + outerR * Math.sin(endRad)
                    const x1i = 80 + innerR * Math.cos(endRad)
                    const y1i = 80 + innerR * Math.sin(endRad)
                    const x2i = 80 + innerR * Math.cos(startRad)
                    const y2i = 80 + innerR * Math.sin(startRad)
                    const d = `M ${x1o} ${y1o} A ${outerR} ${outerR} 0 ${largeArc} 1 ${x2o} ${y2o} L ${x1i} ${y1i} A ${innerR} ${innerR} 0 ${largeArc} 0 ${x2i} ${y2i} Z`
                    return (
                      <path key={type} d={d} fill={colors[i % colors.length]} opacity={0.85}>
                        <title>{type}: {count} ({Math.round(pct * 100)}%)</title>
                      </path>
                    )
                  })
                })()}
                <text x="80" y="76" textAnchor="middle" className="text-lg font-bold fill-zinc-700 dark:fill-zinc-200" style={{ fontSize: 18 }}>{totalCols}</text>
                <text x="80" y="92" textAnchor="middle" className="fill-zinc-400" style={{ fontSize: 10 }}>字段总数</text>
              </svg>
            </div>
            {/* Legend + stats */}
            <div className="flex-1">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {typeDist.map(([type, count], i) => {
                  const colors = ['bg-sky-500', 'bg-amber-500', 'bg-emerald-500', 'bg-rose-500', 'bg-violet-500', 'bg-pink-500', 'bg-teal-500', 'bg-orange-500', 'bg-indigo-500', 'bg-lime-500']
                  return (
                    <div key={type} className="px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs flex items-center gap-2 hover:border-sky-300 transition-colors">
                      <span className={`h-3 w-3 rounded-full flex-shrink-0 ${colors[i % colors.length]}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-mono font-medium truncate">{type}</div>
                        <div className="text-zinc-400 text-[10px]">{count} · {Math.round(count / totalCols * 100)}%</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </>
      ) : (
        <>
          {/* Schema Diff 视图 */}
          {/* 版本对比卡 */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
            {SCHEMA_VERSIONS.map((v, i) => (
              <Card key={v.version} className={i === 0 ? 'border-emerald-200 dark:border-emerald-900' : 'border-zinc-200 dark:border-zinc-800'}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={i === 0 ? 'default' : 'outline'} className={i === 0 ? 'bg-emerald-600' : ''}>{v.version}</Badge>
                      <span className="font-mono text-xs text-zinc-500">{v.date}</span>
                    </div>
                    <span className="text-[10px] text-zinc-400">{v.author}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-900/50">
                      <div className="text-[10px] text-zinc-400">表数</div>
                      <div className="font-mono font-semibold text-lg">{v.tables}</div>
                    </div>
                    <div className="p-2 rounded bg-zinc-50 dark:bg-zinc-900/50">
                      <div className="text-[10px] text-zinc-400">字段数</div>
                      <div className="font-mono font-semibold text-lg">{v.cols}</div>
                    </div>
                  </div>
                  <div className="text-xs text-zinc-500">{v.note}</div>
                </CardContent>
              </Card>
            ))}
            <div className="flex items-center justify-center">
              <div className="p-3 rounded-full bg-fuchsia-50 dark:bg-fuchsia-950/40 border border-fuchsia-200 dark:border-fuchsia-900">
                <ArrowRight className="h-5 w-5 text-fuchsia-600" />
              </div>
            </div>
            {SCHEMA_VERSIONS.length === 2 && (
              <Card className="border-fuchsia-200 dark:border-fuchsia-900 bg-fuchsia-50/30 dark:bg-fuchsia-950/10">
                <CardContent className="p-4">
                  <div className="text-[11px] font-medium text-fuchsia-700 dark:text-fuchsia-300 mb-2 flex items-center gap-1.5">
                    <GitCompare className="h-3.5 w-3.5" /> 变更摘要
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <div className="flex items-center gap-1.5"><TableProperties className="h-3 w-3 text-emerald-600" /><span className="text-zinc-600 dark:text-zinc-300">新增表</span><span className="font-mono font-semibold ml-auto">{diffStats.byKind.added_table || 0}</span></div>
                    <div className="flex items-center gap-1.5"><Plus className="h-3 w-3 text-emerald-600" /><span className="text-zinc-600 dark:text-zinc-300">新增字段</span><span className="font-mono font-semibold ml-auto">{diffStats.byKind.added_col || 0}</span></div>
                    <div className="flex items-center gap-1.5"><ArrowRight className="h-3 w-3 text-amber-600" /><span className="text-zinc-600 dark:text-zinc-300">重命名</span><span className="font-mono font-semibold ml-auto">{diffStats.byKind.renamed_col || 0}</span></div>
                    <div className="flex items-center gap-1.5"><Edit3 className="h-3 w-3 text-sky-600" /><span className="text-zinc-600 dark:text-zinc-300">类型变更</span><span className="font-mono font-semibold ml-auto">{diffStats.byKind.type_changed || 0}</span></div>
                    <div className="flex items-center gap-1.5"><Minus className="h-3 w-3 text-rose-600" /><span className="text-zinc-600 dark:text-zinc-300">删除字段</span><span className="font-mono font-semibold ml-auto">{diffStats.byKind.removed_col || 0}</span></div>
                    <div className="flex items-center gap-1.5"><Database className="h-3 w-3 text-zinc-400" /><span className="text-zinc-600 dark:text-zinc-300">影响表</span><span className="font-mono font-semibold ml-auto">{diffStats.affectedTables}</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-fuchsia-200 dark:border-fuchsia-900 text-[11px] text-fuchsia-700 dark:text-fuchsia-300">
                    共 {diffStats.total} 处变更
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* 筛选栏 */}
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-zinc-500 flex items-center gap-1"><GitCompare className="h-3.5 w-3.5" /> 类型:</span>
                <div className="flex items-center gap-1 flex-wrap">
                  <button
                    onClick={() => setDiffFilter('all')}
                    className={`px-2 py-1 rounded text-[11px] border transition-colors ${diffFilter === 'all' ? 'bg-fuchsia-100 dark:bg-fuchsia-950/40 border-fuchsia-400 text-fuchsia-700 dark:text-fuchsia-300' : 'border-zinc-200 dark:border-zinc-700 hover:border-fuchsia-300'}`}
                  >
                    全部 ({SCHEMA_DIFFS.length})
                  </button>
                  {(Object.keys(diffKindMeta) as DiffKind[]).map(k => {
                    const meta = diffKindMeta[k]
                    const Icon = meta.icon
                    const count = diffStats.byKind[k] || 0
                    if (count === 0) return null
                    return (
                      <button
                        key={k}
                        onClick={() => setDiffFilter(k)}
                        className={`px-2 py-1 rounded text-[11px] border transition-colors flex items-center gap-1 ${diffFilter === k ? `${meta.bg} border-current ${meta.color}` : 'border-zinc-200 dark:border-zinc-700 hover:border-fuchsia-300'}`}
                      >
                        <Icon className="h-3 w-3" />
                        {meta.label}
                        <span className="font-mono font-semibold ml-0.5">{count}</span>
                      </button>
                    )
                  })}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-xs text-zinc-500">表:</span>
                  <select
                    value={diffTableFilter}
                    onChange={e => setDiffTableFilter(e.target.value)}
                    className="text-xs h-7 rounded border border-zinc-200 dark:border-zinc-700 bg-background px-2"
                  >
                    <option value="all">全部表 ({diffTables.length})</option>
                    {diffTables.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Diff 列表 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-fuchsia-500" />
                变更明细
                <Badge variant="outline" className="text-[10px] ml-1">{filteredDiffs.length} / {SCHEMA_DIFFS.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="min-w-[700px]">
                <div className="grid grid-cols-[140px_200px_1fr_1fr] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                  <div>变更类型</div><div>表</div><div>字段变更</div><div>说明</div>
                </div>
                <ScrollArea className="h-[calc(100vh-480px)]">
                  {filteredDiffs.map((d, i) => {
                    const meta = diffKindMeta[d.kind]
                    const Icon = meta.icon
                    return (
                      <div key={i} className={`grid grid-cols-[140px_200px_1fr_1fr] gap-2 px-4 py-2.5 text-xs border-b last:border-0 items-center ${meta.bg}`}>
                        <div className="flex items-center gap-1.5">
                          <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                          <span className={`font-medium ${meta.color}`}>{meta.label}</span>
                        </div>
                        <div className="font-mono text-zinc-700 dark:text-zinc-300">{d.table}</div>
                        <div className="font-mono">
                          {d.kind === 'added_table' && <span className="text-emerald-600">+ 新表</span>}
                          {d.kind === 'removed_table' && <span className="text-rose-600 line-through">- 旧表</span>}
                          {d.kind === 'added_col' && <span className="text-emerald-600">+ {d.field}</span>}
                          {d.kind === 'removed_col' && <span className="text-rose-600 line-through">- {d.field}</span>}
                          {d.kind === 'renamed_col' && (
                            <span className="flex items-center gap-1.5">
                              <span className="text-rose-600 line-through">{d.oldField}</span>
                              <ArrowRight className="h-3 w-3 text-zinc-400" />
                              <span className="text-emerald-600">{d.newField}</span>
                            </span>
                          )}
                          {d.kind === 'type_changed' && (
                            <span className="flex items-center gap-1.5">
                              <Badge variant="outline" className="font-mono text-[10px] py-0 px-1 text-rose-600 border-rose-300 line-through">{d.oldType}</Badge>
                              <ArrowRight className="h-3 w-3 text-zinc-400" />
                              <Badge variant="outline" className="font-mono text-[10px] py-0 px-1 text-emerald-600 border-emerald-300">{d.newType}</Badge>
                              <span className="text-zinc-400 text-[10px]">({d.field})</span>
                            </span>
                          )}
                        </div>
                        <div className="text-zinc-600 dark:text-zinc-400">{d.detail}</div>
                      </div>
                    )
                  })}
                  {filteredDiffs.length === 0 && (
                    <div className="py-12 text-center text-zinc-400 text-sm">无匹配变更</div>
                  )}
                </ScrollArea>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function TableListItem({ t, selected, onSelect }: { t: typeof TABLES[number]; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selected ? 'bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
    >
      <div className="font-mono truncate flex items-center gap-1">
        {t.table}
        {t.health === 'red' && <span className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />}
      </div>
      <div className="text-[10px] text-zinc-400 truncate">{t.cn} · {t.columns.length}列</div>
    </button>
  )
}
