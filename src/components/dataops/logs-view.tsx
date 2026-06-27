'use client'
import { useState, useMemo } from 'react'
import { LOGS } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, FileText } from 'lucide-react'

export function LogsView() {
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<string>('all')
  const [table, setTable] = useState<string>('all')

  const tables = useMemo(() => [...new Set(LOGS.map(l => l.table))].sort(), [])

  const filtered = useMemo(() => {
    return LOGS.filter(l => {
      if (level !== 'all' && l.level !== level) return false
      if (table !== 'all' && l.table !== table) return false
      if (search && !l.message.toLowerCase().includes(search.toLowerCase()) && !l.table.includes(search)) return false
      return true
    })
  }, [search, level, table])

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input placeholder="搜索日志内容..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 font-mono text-sm" />
            </div>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-32 h-9"><SelectValue placeholder="级别" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部级别</SelectItem>
                <SelectItem value="ERROR">ERROR</SelectItem>
                <SelectItem value="WARNING">WARNING</SelectItem>
                <SelectItem value="INFO">INFO</SelectItem>
                <SelectItem value="DEBUG">DEBUG</SelectItem>
              </SelectContent>
            </Select>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger className="w-48 h-9"><SelectValue placeholder="表" /></SelectTrigger>
              <SelectContent className="max-h-80">
                <SelectItem value="all">全部表</SelectItem>
                {tables.map(t => <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="ml-auto">{filtered.length} / {LOGS.length}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4 text-zinc-500" />
            日志流 · logs/run_20260625.log
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[calc(100vh-280px)] font-mono">
            <div className="px-3 py-2 text-xs space-y-0.5">
              {filtered.map((l, i) => (
                <div key={i} className={`flex gap-2 py-0.5 px-2 rounded ${l.level === 'ERROR' ? 'bg-rose-50 dark:bg-rose-950/30' : l.level === 'WARNING' ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'}`}>
                  <span className="text-zinc-400 flex-shrink-0">{l.ts.slice(5)}</span>
                  <span className={`flex-shrink-0 w-16 font-bold ${levelColor(l.level)}`}>{l.level}</span>
                  <span className="text-sky-600 dark:text-sky-400 flex-shrink-0 w-40 truncate">{l.table}</span>
                  <span className="text-zinc-700 dark:text-zinc-300 flex-1">{l.message}</span>
                </div>
              ))}
              {filtered.length === 0 && <div className="py-10 text-center text-zinc-400">无匹配日志</div>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}

function levelColor(l: string): string {
  switch (l) {
    case 'ERROR': return 'text-rose-600'
    case 'WARNING': return 'text-amber-600'
    case 'INFO': return 'text-emerald-600'
    case 'DEBUG': return 'text-zinc-400'
    default: return 'text-zinc-500'
  }
}
