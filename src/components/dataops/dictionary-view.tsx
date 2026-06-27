'use client'
import { useState, useMemo } from 'react'
import { TABLES, ColumnDef } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Database, Search, BookOpen, Download, Copy, Hash, Type, AlertTriangle, Check, FileText } from 'lucide-react'
import { toast } from 'sonner'

type GroupBy = 'table' | 'dir' | 'type'

export function DictionaryView() {
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string>('stock_daily_kline')
  const [groupBy, setGroupBy] = useState<GroupBy>('table')
  const [colSearch, setColSearch] = useState('')

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

  const exportDict = () => {
    const lines = ['# 数据字典导出', '']
    TABLES.forEach(t => {
      lines.push(`## ${t.table} (${t.cn})`)
      lines.push(`- 目录: ${t.dir} · 调度: ${t.schedule} · mode: ${t.mode}`)
      lines.push(`- 行数: ${t.rows} · 最新日期: ${t.maxDate || '—'}`)
      lines.push('')
      lines.push('| 列名 | 类型 | 中文 | 可空 |')
      lines.push('|---|---|---|---|')
      t.columns.forEach(c => lines.push(`| ${c.name} | ${c.type} | ${c.cn} | ${c.nullable ? '✓' : '—'} |`))
      lines.push('')
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'data_dictionary.md'
    a.click()
    URL.revokeObjectURL(url)
    toast.success('数据字典已导出 (data_dictionary.md)')
  }

  return (
    <div className="space-y-4">
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
                <Download className="h-3 w-3" />
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
              </CardTitle>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => exportDict}>
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
                <div className="grid grid-cols-[1fr_120px_1fr_60px_1fr] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                  <div>列名</div><div>类型</div><div>中文名</div><div className="text-center">可空</div><div>备注</div>
                </div>
                {filteredColumns.map(c => {
                  const hasChinese = /[^\x00-\x7F]/.test(c.name)
                  return (
                    <div key={c.name} className="grid grid-cols-[1fr_120px_1fr_60px_1fr] gap-2 px-4 py-2 text-xs border-b last:border-0 items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
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
                        {hasChinese ? '建议改英文，中文含义放 FIELD_MAP' : c.nullable ? '允许 NULL' : '主键/非空'}
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

      {/* 底部：类型分布 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Type className="h-4 w-4 text-emerald-500" />
            字段类型分布
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {typeDist.map(([type, count]) => (
              <div key={type} className="px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs flex items-center gap-2 hover:border-sky-300 transition-colors">
                <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 text-sky-600 dark:text-sky-400 border-sky-200 dark:border-sky-800">{type}</Badge>
                <span className="font-mono text-zinc-600 dark:text-zinc-400">{count}</span>
                <span className="text-zinc-400 text-[10px]">{Math.round(count / totalCols * 100)}%</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
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
