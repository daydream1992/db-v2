'use client'
import { useState, useMemo } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Play, Save, History, Database, Clock, CheckCircle2, Table2, Terminal, BookOpen, ChevronRight, Trash2 } from 'lucide-react'

interface SavedQuery { id: string; name: string; sql: string }
interface QueryHistory { id: string; sql: string; ts: string; rows: number; durationMs: number; ok: boolean }

const SAMPLE_QUERIES: SavedQuery[] = [
  { id: 'q1', name: '今日涨停股', sql: "SELECT code, close, volume\nFROM stock_daily_kline\nWHERE date = '2026-06-25'\n  AND close / LAG(close) OVER (PARTITION BY code ORDER BY date) >= 1.095\nLIMIT 20" },
  { id: 'q2', name: '板块成分股数 Top', sql: "SELECT block_name, constituent_count\nFROM stock_block_relation\nWHERE fetch_time::DATE = CURRENT_DATE\nORDER BY constituent_count DESC\nLIMIT 10" },
  { id: 'q3', name: 'K线行数统计', sql: "SELECT 'stock_daily_kline' AS table_name, COUNT(*) AS rows\nFROM stock_daily_kline\nUNION ALL\nSELECT 'stock_kline_5m', COUNT(*)\nFROM stock_kline_5m" },
  { id: 'q4', name: '骗炮A级候选', sql: "SELECT code, trade_date, score\nFROM pianpao_daily\nWHERE trade_date = '2026-06-25'\nORDER BY score DESC\nLIMIT 30" },
]

// mock 结果生成器：根据 SQL 关键字返回不同 mock 结果
function mockExecute(sql: string): { columns: string[]; rows: (string | number)[][]; rowsAffected: number } {
  const lower = sql.toLowerCase()
  if (lower.includes('count')) {
    return { columns: ['table_name', 'rows'], rows: [['stock_daily_kline', 9840000], ['stock_kline_5m', 39600000], ['stock_kline_1m', 198000000]], rowsAffected: 3 }
  }
  if (lower.includes('stock_block_relation')) {
    return {
      columns: ['block_name', 'constituent_count'],
      rows: [['人工智能', 187], ['芯片', 156], ['新能源车', 142], ['光伏', 128], ['医药', 119], ['白酒', 76], ['军工', 98], ['稀土', 45]],
      rowsAffected: 8,
    }
  }
  if (lower.includes('pianpao')) {
    return {
      columns: ['code', 'trade_date', 'score'],
      rows: [['600519.SH', '2026-06-25', 95.2], ['000858.SZ', '2026-06-25', 91.8], ['300750.SZ', '2026-06-25', 88.5], ['601318.SH', '2026-06-25', 85.1], ['000333.SZ', '2026-06-25', 82.7]],
      rowsAffected: 5,
    }
  }
  if (lower.includes('stock_daily_kline')) {
    return {
      columns: ['code', 'date', 'open', 'high', 'low', 'close', 'volume'],
      rows: [
        ['600519.SH', '2026-06-25', 1685.20, 1702.50, 1678.80, 1698.30, 2456789],
        ['000858.SZ', '2026-06-25', 168.50, 171.20, 167.30, 170.45, 15678234],
        ['300750.SZ', '2026-06-25', 245.80, 248.60, 244.10, 247.20, 8923456],
        ['601318.SH', '2026-06-25', 52.30, 52.85, 51.92, 52.68, 23456789],
        ['000333.SZ', '2026-06-25', 78.45, 79.20, 77.80, 78.95, 12345678],
      ],
      rowsAffected: 5,
    }
  }
  return { columns: ['result'], rows: [['(空结果集)']], rowsAffected: 0 }
}

export function SqlPlaygroundView() {
  const [sql, setSql] = useState(SAMPLE_QUERIES[0].sql)
  const [result, setResult] = useState<{ columns: string[]; rows: (string | number)[][]; rowsAffected: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [history, setHistory] = useState<QueryHistory[]>([
    { id: 'h1', sql: 'SELECT COUNT(*) FROM stock_daily_kline', ts: '2026-06-25 19:32:01', rows: 1, durationMs: 45, ok: true },
    { id: 'h2', sql: 'SELECT * FROM dim_security_type WHERE type = "ETF"', ts: '2026-06-25 19:30:15', rows: 124, durationMs: 82, ok: true },
    { id: 'h3', sql: 'SELECT code FROM stock_kline_1m LIMIT 1000000', ts: '2026-06-25 19:28:44', rows: 0, durationMs: 3200, ok: false },
  ])
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(SAMPLE_QUERIES)
  const [selectedTable, setSelectedTable] = useState<string>('stock_daily_kline')

  const run = () => {
    if (!sql.trim()) return
    setRunning(true)
    setResult(null)
    setDurationMs(null)
    setTimeout(() => {
      const r = mockExecute(sql)
      const ms = Math.floor(Math.random() * 200) + 30
      setResult(r)
      setDurationMs(ms)
      setRunning(false)
      setHistory(prev => [{
        id: `h${Date.now()}`,
        sql: sql.length > 80 ? sql.slice(0, 80) + '...' : sql,
        ts: new Date().toLocaleString('zh-CN', { hour12: false }),
        rows: r.rowsAffected,
        durationMs: ms,
        ok: true,
      }, ...prev].slice(0, 20))
    }, 500 + Math.random() * 400)
  }

  const insertTable = (tableName: string) => {
    setSql(prev => prev + (prev && !prev.endsWith('\n') ? '\n' : '') + `${tableName} `)
  }

  const insertColumn = (col: string) => {
    setSql(prev => prev + col + ' ')
  }

  const currentTable = TABLES.find(t => t.table === selectedTable)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_280px] gap-4 h-[calc(100vh-180px)]">
      {/* 左：表清单 */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2 px-3">
          <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500"><Database className="h-3.5 w-3.5" /> 表清单</CardTitle>
        </CardHeader>
        <CardContent className="p-2 flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="space-y-0.5">
              {TABLES.map(t => (
                <button
                  key={t.table}
                  onClick={() => setSelectedTable(t.table)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedTable === t.table ? 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                >
                  <div className="font-mono truncate">{t.table}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{t.columns.length} 列</div>
                </button>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 中：编辑器 + 结果 */}
      <div className="flex flex-col gap-3 min-h-0">
        {/* 编辑器 */}
        <Card className="flex flex-col flex-shrink-0">
          <CardHeader className="pb-2 px-3 py-2.5 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500"><Terminal className="h-3.5 w-3.5" /> SQL 编辑器</CardTitle>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSql('')} title="清空">
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { const n = prompt('查询名称'); if (n) setSavedQueries(prev => [...prev, { id: `q${Date.now()}`, name: n, sql }]) }}>
                <Save className="h-3 w-3 mr-1" />保存
              </Button>
              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={run} disabled={running}>
                <Play className="h-3 w-3 mr-1" />{running ? '执行中...' : '执行'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <textarea
              value={sql}
              onChange={e => setSql(e.target.value)}
              onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() } }}
              spellCheck={false}
              className="w-full h-40 px-3 py-2 font-mono text-sm bg-zinc-50 dark:bg-zinc-900/60 border-t outline-none resize-none leading-relaxed text-zinc-800 dark:text-zinc-200"
              placeholder="-- 输入 SQL，Ctrl+Enter 执行&#10;SELECT * FROM stock_daily_kline LIMIT 10;"
            />
            <div className="px-3 py-1.5 text-[10px] text-zinc-400 border-t flex items-center gap-3 bg-card">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Ctrl+Enter 执行</span>
              <span>·</span>
              <span>DuckDB SQL 方言</span>
              <span>·</span>
              <span>只读模式</span>
            </div>
          </CardContent>
        </Card>

        {/* 结果 */}
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2 px-3 py-2.5 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500">
              <Table2 className="h-3.5 w-3.5" /> 结果
            </CardTitle>
            {result && durationMs !== null && (
              <div className="flex items-center gap-2 text-[11px]">
                <Badge variant="outline" className="text-emerald-600 border-emerald-300 py-0"><CheckCircle2 className="h-3 w-3 mr-0.5" />成功</Badge>
                <span className="text-zinc-500">{result.rowsAffected} 行</span>
                <span className="text-zinc-400">·</span>
                <span className="text-zinc-500 font-mono">{durationMs}ms</span>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0 flex-1 min-h-0">
            <ScrollArea className="h-full">
              {!result && !running && (
                <div className="h-full flex flex-col items-center justify-center text-zinc-400 text-sm py-16 gap-2">
                  <Terminal className="h-8 w-8 opacity-40" />
                  <div>点击「执行」运行 SQL</div>
                  <div className="text-xs text-zinc-300">或从右侧选择保存的查询</div>
                </div>
              )}
              {running && (
                <div className="h-full flex flex-col items-center justify-center text-sky-500 text-sm py-16 gap-2">
                  <div className="h-6 w-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  <div>执行中...</div>
                </div>
              )}
              {result && !running && (
                <div className="min-w-full">
                  <div className="grid auto-cols-min grid-flow-col gap-2 px-3 py-2 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card">
                    {result.columns.map(c => <div key={c} className="font-mono whitespace-nowrap">{c}</div>)}
                  </div>
                  {result.rows.map((row, i) => (
                    <div key={i} className="grid auto-cols-min grid-flow-col gap-2 px-3 py-1.5 text-xs border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 font-mono">
                      {row.map((cell, j) => (
                        <div key={j} className={`whitespace-nowrap ${typeof cell === 'number' ? 'text-sky-600 dark:text-sky-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {String(cell)}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* 右：保存的查询 + 历史 + 当前表 schema */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2 px-3">
          <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500"><BookOpen className="h-3.5 w-3.5" /> 参考</CardTitle>
        </CardHeader>
        <CardContent className="p-2 flex-1 min-h-0">
          <Tabs defaultValue="saved" className="h-full flex flex-col">
            <TabsList className="grid grid-cols-3 w-full h-7 text-[11px]">
              <TabsTrigger value="saved" className="text-[11px]">保存</TabsTrigger>
              <TabsTrigger value="history" className="text-[11px]">历史</TabsTrigger>
              <TabsTrigger value="schema" className="text-[11px]">字段</TabsTrigger>
            </TabsList>
            <TabsContent value="saved" className="flex-1 min-h-0 mt-2">
              <ScrollArea className="h-[calc(100vh-260px)]">
                <div className="space-y-1">
                  {savedQueries.map(q => (
                    <div key={q.id} className="group p-2 rounded border border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 cursor-pointer" onClick={() => setSql(q.sql)}>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-zinc-400" />
                        <span className="text-xs font-medium">{q.name}</span>
                      </div>
                      <div className="text-[10px] text-zinc-400 font-mono mt-0.5 truncate pl-4">{q.sql.split('\n')[0]}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="history" className="flex-1 min-h-0 mt-2">
              <ScrollArea className="h-[calc(100vh-260px)]">
                <div className="space-y-1">
                  {history.map(h => (
                    <div key={h.id} className={`p-2 rounded border text-xs ${h.ok ? 'border-zinc-200 dark:border-zinc-700' : 'border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20'}`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <History className="h-3 w-3 text-zinc-400" />
                        <span className="text-[10px] text-zinc-400 font-mono">{h.ts.slice(5)}</span>
                        <span className="ml-auto text-[10px] text-zinc-400">{h.rows}行 · {h.durationMs}ms</span>
                      </div>
                      <div className="font-mono text-[10px] text-zinc-600 dark:text-zinc-400 truncate">{h.sql}</div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="schema" className="flex-1 min-h-0 mt-2">
              <ScrollArea className="h-[calc(100vh-260px)]">
                {currentTable && (
                  <div>
                    <div className="px-2 py-1.5 mb-1 rounded bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900">
                      <button onClick={() => insertTable(currentTable.table)} className="font-mono text-xs font-medium text-sky-700 dark:text-sky-300 hover:underline">
                        {currentTable.table} +
                      </button>
                      <div className="text-[10px] text-zinc-500">{currentTable.cn}</div>
                    </div>
                    <div className="space-y-0.5">
                      {currentTable.columns.map(c => (
                        <button
                          key={c.name}
                          onClick={() => insertColumn(c.name)}
                          className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs group"
                        >
                          <span className="font-mono flex-1 truncate group-hover:text-sky-600 dark:group-hover:text-sky-400">{c.name}</span>
                          <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">{c.type}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
