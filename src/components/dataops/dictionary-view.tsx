'use client'
import { useState, useMemo } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Database, Search, BookOpen } from 'lucide-react'

export function DictionaryView() {
  const [search, setSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState<string>('stock_daily_kline')

  const filteredTables = useMemo(() => {
    return TABLES.filter(t =>
      !search || t.table.includes(search.toLowerCase()) || t.cn.includes(search)
    ).sort((a, b) => a.dir.localeCompare(b.dir) || a.sort.localeCompare(b.sort))
  }, [search])

  const selected = TABLES.find(t => t.table === selectedTable)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 h-[calc(100vh-180px)]">
      {/* 左侧表树 */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><BookOpen className="h-4 w-4 text-fuchsia-500" />表清单</CardTitle>
        </CardHeader>
        <CardContent className="p-2 flex-1 flex flex-col gap-2 min-h-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
            <Input placeholder="搜索..." value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-0.5">
              {filteredTables.map(t => (
                <button
                  key={t.table}
                  onClick={() => setSelectedTable(t.table)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedTable === t.table ? 'bg-fuchsia-100 dark:bg-fuchsia-950/40 text-fuchsia-700 dark:text-fuchsia-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                >
                  <div className="font-mono truncate">{t.table}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{t.cn} · {t.columns.length}列</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 右侧字段表 */}
      <Card className="flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Database className="h-4 w-4 text-sky-500" />
            <span className="font-mono">{selected?.table}</span>
            <Badge variant="outline" className="ml-2">{selected?.columns.length} 列</Badge>
          </CardTitle>
          <p className="text-sm text-zinc-500 -mt-1">{selected?.cn} · 来源 {selected?.source}</p>
        </CardHeader>
        <CardContent className="p-0 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="min-w-[600px]">
              <div className="grid grid-cols-[1fr_120px_1fr_60px_1fr] gap-2 px-4 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card">
                <div>列名</div><div>类型</div><div>中文名</div><div className="text-center">可空</div><div>备注</div>
              </div>
              {selected?.columns.map(c => {
                const hasChinese = /[^\x00-\x7F]/.test(c.name)
                return (
                  <div key={c.name} className="grid grid-cols-[1fr_120px_1fr_60px_1fr] gap-2 px-4 py-2 text-xs border-b last:border-0 items-center hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <div className="font-mono flex items-center gap-1.5">
                      {c.name}
                      {hasChinese && <span className="text-[9px] px-1 py-0 rounded bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">中文</span>}
                    </div>
                    <div className="font-mono text-sky-600 dark:text-sky-400 text-[11px]">{c.type}</div>
                    <div className="text-zinc-600 dark:text-zinc-400">{c.cn}</div>
                    <div className="text-center text-zinc-400">{c.nullable ? '✓' : '—'}</div>
                    <div className="text-[11px] text-zinc-400">
                      {hasChinese ? '建议改英文，中文含义放 FIELD_MAP' : c.nullable ? '允许 NULL' : '主键/非空'}
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
