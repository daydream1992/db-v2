'use client'
import { useState, useMemo, useRef, useEffect } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Play, Save, History, Database, Clock, CheckCircle2, Table2, Terminal, BookOpen, ChevronRight, Trash2, Search, ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight as ChevR, X, FileDown, Plus } from 'lucide-react'

interface SavedQuery { id: string; name: string; sql: string; desc?: string }
interface QueryHistory { id: string; sql: string; ts: string; rows: number; durationMs: number; ok: boolean }
interface QueryResult { columns: string[]; rows: (string | number)[][]; rowsAffected: number }

// 多 Tab 查询状态
interface QueryTab {
  id: string
  name: string
  sql: string
  result: QueryResult | null
  running: boolean
  durationMs: number | null
  sortCol: number | null
  sortDir: 'asc' | 'desc' | null
  page: number
}

const SAMPLE_QUERIES: SavedQuery[] = [
  { id: 'q1', name: '今日涨停股', desc: '涨幅 ≥ 9.5% 的股票', sql: "SELECT code, close, volume\nFROM stock_daily_kline\nWHERE date = '2026-06-25'\n  AND close / LAG(close) OVER (PARTITION BY code ORDER BY date) >= 1.095\nLIMIT 20" },
  { id: 'q2', name: '板块成分股数 Top', desc: '按成分股数排序', sql: "SELECT block_name, constituent_count\nFROM stock_block_relation\nWHERE fetch_time::DATE = CURRENT_DATE\nORDER BY constituent_count DESC\nLIMIT 10" },
  { id: 'q3', name: 'K线行数统计', desc: '各周期 K 线表行数', sql: "SELECT 'stock_daily_kline' AS table_name, COUNT(*) AS rows\nFROM stock_daily_kline\nUNION ALL\nSELECT 'stock_kline_5m', COUNT(*)\nFROM stock_kline_5m" },
  { id: 'q4', name: '骗炮A级候选', desc: '评分 ≥ 80 的骗炮候选', sql: "SELECT code, trade_date, score\nFROM pianpao_daily\nWHERE trade_date = '2026-06-25'\nORDER BY score DESC\nLIMIT 30" },
  { id: 'q5', name: '行业分类树', desc: '三级行业展开', sql: "SELECT level1_name, level2_name, level3_name\nFROM stock_industry_3level\nORDER BY level1_name, level2_name" },
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
      rows: [['人工智能', 187], ['芯片', 156], ['新能源车', 142], ['光伏', 128], ['医药', 119], ['白酒', 76], ['军工', 98], ['稀土', 45], ['锂电池', 102], ['5G', 89], ['半导体', 134], ['消费电子', 67]],
      rowsAffected: 12,
    }
  }
  if (lower.includes('pianpao')) {
    return {
      columns: ['code', 'trade_date', 'score'],
      rows: [
        ['600519.SH', '2026-06-25', 95.2], ['000858.SZ', '2026-06-25', 91.8], ['300750.SZ', '2026-06-25', 88.5],
        ['601318.SH', '2026-06-25', 85.1], ['000333.SZ', '2026-06-25', 82.7], ['600036.SH', '2026-06-25', 79.4],
        ['002594.SZ', '2026-06-25', 76.8], ['601012.SH', '2026-06-25', 73.5], ['000001.SZ', '2026-06-25', 70.2],
        ['600276.SH', '2026-06-25', 68.9], ['300760.SZ', '2026-06-25', 65.4], ['002475.SZ', '2026-06-25', 62.1],
      ],
      rowsAffected: 12,
    }
  }
  if (lower.includes('industry_3level')) {
    return {
      columns: ['level1_name', 'level2_name', 'level3_name'],
      rows: [
        ['信息技术', '半导体', '集成电路设计'],
        ['信息技术', '半导体', '集成电路制造'],
        ['信息技术', '软件', '工业软件'],
        ['医药生物', '化学制药', '创新药'],
        ['医药生物', '医疗器械', '体外诊断'],
        ['金融', '银行', '国有大型银行'],
        ['金融', '保险', '人寿保险'],
        ['消费', '食品饮料', '白酒'],
        ['消费', '家电', '白电'],
        ['能源', '电力', '火电'],
      ],
      rowsAffected: 10,
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
        ['600036.SH', '2026-06-25', 38.90, 39.15, 38.62, 39.05, 34567890],
        ['002594.SZ', '2026-06-25', 245.00, 248.50, 243.80, 247.80, 5678901],
        ['601012.SH', '2026-06-25', 8.95, 9.08, 8.88, 9.02, 89012345],
      ],
      rowsAffected: 8,
    }
  }
  return { columns: ['result'], rows: [['(空结果集)']], rowsAffected: 0 }
}

// SQL 关键字 + 函数高亮
const SQL_KEYWORDS = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'LIKE', 'BETWEEN', 'IS', 'NULL', 'AS', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE', 'VIEW', 'INDEX', 'DISTINCT', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'OVER', 'PARTITION BY', 'LAG', 'LEAD', 'CURRENT_DATE', 'DATE', 'TIMESTAMP']

function highlightSql(sql: string): React.ReactNode {
  // 分行处理，每行用 token 切分
  const lines = sql.split('\n')
  return lines.map((line, lineIdx) => {
    // 注释行
    if (line.trim().startsWith('--')) {
      return <div key={lineIdx} className="text-zinc-400 italic">{line || ' '}</div>
    }
    // 用正则把字符串、数字、关键字、表名分开
    const tokens: { text: string; type: 'kw' | 'str' | 'num' | 'op' | 'text' }[] = []
    let i = 0
    while (i < line.length) {
      const ch = line[i]
      // 字符串
      if (ch === "'" || ch === '"') {
        let j = i + 1
        while (j < line.length && line[j] !== ch) j++
        tokens.push({ text: line.slice(i, j + 1), type: 'str' })
        i = j + 1
        continue
      }
      // 数字
      if (/[0-9]/.test(ch)) {
        let j = i
        while (j < line.length && /[0-9.]/.test(line[j])) j++
        tokens.push({ text: line.slice(i, j), type: 'num' })
        i = j
        continue
      }
      // 标识符
      if (/[a-zA-Z_]/.test(ch)) {
        let j = i
        while (j < line.length && /[a-zA-Z_0-9 ]/.test(line[j]) && (line[j] !== ' ' || (j + 1 < line.length && /[a-zA-Z]/.test(line[j + 1])))) j++
        // 关键字匹配（考虑多词如 ORDER BY）
        const word = line.slice(i, j)
        const upper = word.toUpperCase()
        if (SQL_KEYWORDS.includes(upper)) {
          tokens.push({ text: word, type: 'kw' })
        } else {
          tokens.push({ text: word, type: 'text' })
        }
        i = j
        continue
      }
      // 操作符
      if (/[=<>!(),.;*+\-/]/.test(ch)) {
        tokens.push({ text: ch, type: 'op' })
        i++
        continue
      }
      // 空格等其他
      let j = i
      while (j < line.length && /\s/.test(line[j])) j++
      tokens.push({ text: line.slice(i, j), type: 'text' })
      i = j
    }
    return (
      <div key={lineIdx}>
        {tokens.map((t, idx) => {
          if (t.type === 'kw') return <span key={idx} className="text-fuchsia-600 dark:text-fuchsia-400 font-semibold">{t.text}</span>
          if (t.type === 'str') return <span key={idx} className="text-emerald-600 dark:text-emerald-400">{t.text}</span>
          if (t.type === 'num') return <span key={idx} className="text-amber-600 dark:text-amber-400">{t.text}</span>
          if (t.type === 'op') return <span key={idx} className="text-sky-600 dark:text-sky-400">{t.text}</span>
          return <span key={idx} className="text-zinc-700 dark:text-zinc-300">{t.text}</span>
        })}
      </div>
    )
  })
}

const PAGE_SIZE = 8

export function SqlPlaygroundView() {
  // 多 Tab 查询
  const [tabs, setTabs] = useState<QueryTab[]>([
    { id: 't1', name: '查询 1', sql: SAMPLE_QUERIES[0].sql, result: null, running: false, durationMs: null, sortCol: null, sortDir: null, page: 0 },
  ])
  const [activeTabId, setActiveTabId] = useState<string>('t1')
  const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0]

  const [history, setHistory] = useState<QueryHistory[]>([
    { id: 'h1', sql: 'SELECT COUNT(*) FROM stock_daily_kline', ts: '2026-06-25 19:32:01', rows: 1, durationMs: 45, ok: true },
    { id: 'h2', sql: 'SELECT * FROM dim_security_type WHERE type = "ETF"', ts: '2026-06-25 19:30:15', rows: 124, durationMs: 82, ok: true },
    { id: 'h3', sql: 'SELECT code FROM stock_kline_1m LIMIT 1000000', ts: '2026-06-25 19:28:44', rows: 0, durationMs: 3200, ok: false },
  ])
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(SAMPLE_QUERIES)
  const [selectedTable, setSelectedTable] = useState<string>('stock_daily_kline')
  const [tableSearch, setTableSearch] = useState('')
  const [saveName, setSaveName] = useState('')
  const [showSaveDialog, setShowSaveDialog] = useState(false)
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const tabCounter = useRef(1)

  const filteredTables = useMemo(() => {
    if (!tableSearch) return TABLES
    return TABLES.filter(t => t.table.includes(tableSearch.toLowerCase()) || t.cn.includes(tableSearch))
  }, [tableSearch])

  // 更新当前 tab 的辅助函数
  const updateTab = (id: string, patch: Partial<QueryTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }

  const run = () => {
    if (!activeTab.sql.trim()) return
    const tabId = activeTab.id
    updateTab(tabId, { running: true, result: null, durationMs: null, sortCol: null, sortDir: null, page: 0 })
    setTimeout(() => {
      const r = mockExecute(activeTab.sql)
      const ms = Math.floor(Math.random() * 200) + 30
      updateTab(tabId, { result: r, durationMs: ms, running: false })
      setHistory(prev => [{
        id: `h${Date.now()}`,
        sql: activeTab.sql.length > 80 ? activeTab.sql.slice(0, 80) + '...' : activeTab.sql,
        ts: new Date().toLocaleString('zh-CN', { hour12: false }),
        rows: r.rowsAffected,
        durationMs: ms,
        ok: true,
      }, ...prev].slice(0, 20))
    }, 500 + Math.random() * 400)
  }

  // Tab 操作
  const addTab = () => {
    tabCounter.current += 1
    const newTab: QueryTab = {
      id: `t${Date.now()}`,
      name: `查询 ${tabCounter.current}`,
      sql: '-- 新查询\nSELECT ',
      result: null, running: false, durationMs: null, sortCol: null, sortDir: null, page: 0,
    }
    setTabs(prev => [...prev, newTab])
    setActiveTabId(newTab.id)
  }

  const closeTab = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === id)
      if (prev.length === 1) return prev // 至少保留一个 tab
      const next = prev.filter(t => t.id !== id)
      if (activeTabId === id) {
        const newActive = next[Math.max(0, idx - 1)]
        setActiveTabId(newActive.id)
      }
      return next
    })
  }

  const startRenameTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const t = tabs.find(x => x.id === id)
    if (t) {
      setRenamingTabId(id)
      setRenameValue(t.name)
    }
  }

  const commitRename = () => {
    if (renamingTabId && renameValue.trim()) {
      updateTab(renamingTabId, { name: renameValue.trim() })
    }
    setRenamingTabId(null)
    setRenameValue('')
  }

  const insertTable = (tableName: string) => {
    updateTab(activeTab.id, { sql: activeTab.sql + (activeTab.sql && !activeTab.sql.endsWith('\n') ? '\n' : '') + `${tableName} ` })
    textareaRef.current?.focus()
  }

  const insertColumn = (col: string) => {
    updateTab(activeTab.id, { sql: activeTab.sql + col + ' ' })
    textareaRef.current?.focus()
  }

  const toggleSort = (colIdx: number) => {
    const t = activeTab
    let newSortCol = t.sortCol
    let newSortDir = t.sortDir
    if (t.sortCol === colIdx) {
      newSortDir = t.sortDir === 'asc' ? 'desc' : t.sortDir === 'desc' ? null : 'asc'
      if (t.sortDir === 'desc') newSortCol = null
    } else {
      newSortCol = colIdx
      newSortDir = 'asc'
    }
    updateTab(t.id, { sortCol: newSortCol, sortDir: newSortDir, page: 0 })
  }

  const sortedRows = useMemo(() => {
    if (!activeTab.result || activeTab.sortCol === null || !activeTab.sortDir) return activeTab.result?.rows || []
    const rows = [...activeTab.result.rows]
    rows.sort((a, b) => {
      const av = a[activeTab.sortCol!]
      const bv = b[activeTab.sortCol!]
      if (typeof av === 'number' && typeof bv === 'number') {
        return activeTab.sortDir === 'asc' ? av - bv : bv - av
      }
      return activeTab.sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return rows
  }, [activeTab.result, activeTab.sortCol, activeTab.sortDir])

  const totalPages = activeTab.result ? Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE)) : 0
  const pagedRows = sortedRows.slice(activeTab.page * PAGE_SIZE, (activeTab.page + 1) * PAGE_SIZE)

  const currentTable = TABLES.find(t => t.table === selectedTable)
  const sqlLines = activeTab.sql.split('\n')

  const handleSave = () => {
    if (!saveName.trim()) return
    setSavedQueries(prev => [...prev, { id: `q${Date.now()}`, name: saveName, sql: activeTab.sql, desc: '用户保存' }])
    setSaveName('')
    setShowSaveDialog(false)
  }

  const loadQuery = (sql: string) => {
    updateTab(activeTab.id, { sql })
  }

  const exportCsv = () => {
    if (!activeTab.result) return
    const csv = [activeTab.result.columns.join(','), ...activeTab.result.rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `query_result_${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 简化变量名用于下方 JSX
  const sql = activeTab.sql
  const result = activeTab.result
  const running = activeTab.running
  const durationMs = activeTab.durationMs
  const sortCol = activeTab.sortCol
  const sortDir = activeTab.sortDir
  const page = activeTab.page
  const setPage = (p: number) => updateTab(activeTab.id, { page: p })
  const setSql = (s: string) => updateTab(activeTab.id, { sql: s })

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr_280px] gap-4 h-[calc(100vh-180px)]">
      {/* 左：表清单 */}
      <Card className="flex flex-col">
        <CardHeader className="pb-2 px-3">
          <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500"><Database className="h-3.5 w-3.5" /> 表清单 ({filteredTables.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-2 flex-1 min-h-0 flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-400" />
            <Input
              placeholder="搜索表名..."
              value={tableSearch}
              onChange={e => setTableSearch(e.target.value)}
              className="pl-7 h-7 text-xs"
            />
            {tableSearch && (
              <button onClick={() => setTableSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <ScrollArea className="flex-1 min-h-0">
            <div className="space-y-0.5">
              {filteredTables.map(t => (
                <button
                  key={t.table}
                  onClick={() => setSelectedTable(t.table)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${selectedTable === t.table ? 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800'}`}
                >
                  <div className="font-mono truncate">{t.table}</div>
                  <div className="text-[10px] text-zinc-400 truncate">{t.columns.length} 列 · {(t.rows / 10000).toFixed(0)}万行</div>
                </button>
              ))}
              {filteredTables.length === 0 && <div className="text-center text-xs text-zinc-400 py-4">无匹配</div>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* 中：编辑器 + 结果 */}
      <div className="flex flex-col gap-3 min-h-0">
        {/* 多 Tab 栏 */}
        <div className="flex items-center gap-0.5 overflow-x-auto bg-zinc-100 dark:bg-zinc-800/60 rounded-t-lg p-1 pb-0">
          {tabs.map(t => {
            const isActive = t.id === activeTabId
            const isRenaming = renamingTabId === t.id
            return (
              <div
                key={t.id}
                onClick={() => setActiveTabId(t.id)}
                className={`group flex items-center gap-1 px-3 py-1.5 rounded-t-md text-xs cursor-pointer transition-colors flex-shrink-0 ${
                  isActive
                    ? 'bg-background text-zinc-800 dark:text-zinc-200 border-t-2 border-sky-500 -mb-px'
                    : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-background/50'
                }`}
              >
                {t.running && <div className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />}
                {t.result && !t.running && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onClick={e => e.stopPropagation()}
                    onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenamingTabId(null); setRenameValue('') } }}
                    onBlur={commitRename}
                    className="bg-transparent outline-none border-b border-sky-500 text-xs w-24"
                  />
                ) : (
                  <span
                    onDoubleClick={e => startRenameTab(t.id, e)}
                    className="font-medium truncate max-w-[120px]"
                    title={t.name + '（双击重命名）'}
                  >
                    {t.name}
                  </span>
                )}
                {tabs.length > 1 && (
                  <button
                    onClick={e => closeTab(t.id, e)}
                    className="ml-1 p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="关闭 Tab"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )
          })}
          <button
            onClick={addTab}
            className="ml-1 p-1.5 rounded text-zinc-500 hover:text-sky-600 hover:bg-background transition-colors flex-shrink-0"
            title="新建查询 Tab (Ctrl+T)"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <div className="ml-auto px-2 text-[10px] text-zinc-400 flex items-center gap-2">
            <span>{tabs.length} 个查询</span>
            <span>·</span>
            <span className="hidden sm:inline">Ctrl+T 新建 / 双击重命名</span>
          </div>
        </div>

        {/* 编辑器 */}
        <Card className="flex flex-col flex-shrink-0 -mt-px rounded-tl-none">
          <CardHeader className="pb-2 px-3 py-2.5 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500">
              <Terminal className="h-3.5 w-3.5" /> SQL 编辑器
              <span className="text-zinc-400 ml-1">·</span>
              <span className="font-mono text-zinc-600 dark:text-zinc-300">{activeTab.name}</span>
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setSql('')} title="清空">
                <Trash2 className="h-3 w-3" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowSaveDialog(true)}>
                <Save className="h-3 w-3 mr-1" />保存
              </Button>
              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={run} disabled={running}>
                <Play className="h-3 w-3 mr-1" />{running ? '执行中...' : '执行'}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* 高亮显示层 */}
            <div className="relative h-40 overflow-hidden">
              {/* 行号 */}
              <div className="absolute left-0 top-0 bottom-0 w-10 bg-zinc-50 dark:bg-zinc-900/60 border-r text-right pr-2 py-2 select-none">
                {sqlLines.map((_, i) => (
                  <div key={i} className="font-mono text-sm leading-relaxed text-zinc-400">{i + 1}</div>
                ))}
              </div>
              {/* 高亮层（背景） */}
              <pre className="absolute left-10 top-0 right-0 bottom-0 px-3 py-2 font-mono text-sm leading-relaxed pointer-events-none whitespace-pre-wrap overflow-hidden text-transparent">
                {highlightSql(sql)}
              </pre>
              {/* textarea 透明覆盖 */}
              <textarea
                ref={textareaRef}
                value={sql}
                onChange={e => setSql(e.target.value)}
                onKeyDown={e => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run() }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') { e.preventDefault(); addTab() }
                  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(activeTabId) }
                }}
                spellCheck={false}
                className="absolute left-10 top-0 right-0 bottom-0 px-3 py-2 font-mono text-sm leading-relaxed bg-transparent outline-none resize-none text-transparent caret-zinc-700 dark:caret-zinc-200"
                style={{ caretColor: 'currentColor' }}
                placeholder="-- 输入 SQL，Ctrl+Enter 执行"
              />
            </div>
            <div className="px-3 py-1.5 text-[10px] text-zinc-400 border-t flex items-center gap-3 bg-card">
              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />Ctrl+Enter 执行</span>
              <span>·</span>
              <span>Ctrl+T 新建 Tab</span>
              <span>·</span>
              <span>Ctrl+W 关闭 Tab</span>
              <span className="ml-auto">{sql.length} 字符 · {sqlLines.length} 行</span>
            </div>
          </CardContent>
        </Card>

        {/* 结果 */}
        <Card className="flex-1 min-h-0 flex flex-col">
          <CardHeader className="pb-2 px-3 py-2.5 flex flex-row items-center justify-between">
            <CardTitle className="text-xs flex items-center gap-1.5 text-zinc-500">
              <Table2 className="h-3.5 w-3.5" /> 结果
              <span className="text-zinc-400">·</span>
              <span className="font-mono text-zinc-600 dark:text-zinc-300">{activeTab.name}</span>
              {result && sortCol !== null && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 ml-1">排序: {result.columns[sortCol]} {sortDir}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2 text-[11px]">
              {result && durationMs !== null && (
                <>
                  <Badge variant="outline" className="text-emerald-600 border-emerald-300 py-0"><CheckCircle2 className="h-3 w-3 mr-0.5" />成功</Badge>
                  <span className="text-zinc-500">{result.rowsAffected} 行</span>
                  <span className="text-zinc-400">·</span>
                  <span className="text-zinc-500 font-mono">{durationMs}ms</span>
                  <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={exportCsv} title="导出 CSV">
                    <FileDown className="h-3 w-3" />
                  </Button>
                </>
              )}
            </div>
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
                  <div className="grid auto-cols-min grid-flow-col gap-0 px-0 py-0 text-[11px] font-medium text-zinc-500 border-b sticky top-0 bg-card z-10">
                    {result.columns.map((c, i) => (
                      <button
                        key={c}
                        onClick={() => toggleSort(i)}
                        className="px-3 py-2 text-left font-mono whitespace-nowrap hover:bg-zinc-50 dark:hover:bg-zinc-900/60 flex items-center gap-1 border-r"
                      >
                        {c}
                        {sortCol === i && sortDir === 'asc' && <ArrowUp className="h-3 w-3 text-sky-500" />}
                        {sortCol === i && sortDir === 'desc' && <ArrowDown className="h-3 w-3 text-sky-500" />}
                        {sortCol !== i && <ArrowUpDown className="h-3 w-3 text-zinc-300 opacity-0 hover:opacity-100" />}
                      </button>
                    ))}
                  </div>
                  {pagedRows.map((row, i) => (
                    <div key={i} className="grid auto-cols-min grid-flow-col gap-0 text-xs border-b last:border-0 hover:bg-zinc-50 dark:hover:bg-zinc-900/40 font-mono">
                      {row.map((cell, j) => (
                        <div key={j} className={`px-3 py-1.5 whitespace-nowrap border-r ${typeof cell === 'number' ? 'text-sky-600 dark:text-sky-400 text-right' : 'text-zinc-700 dark:text-zinc-300'}`}>
                          {String(cell)}
                        </div>
                      ))}
                    </div>
                  ))}
                  {/* 分页 */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between px-3 py-2 border-t text-xs">
                      <span className="text-zinc-500">
                        第 {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, sortedRows.length)} / {sortedRows.length} 行
                      </span>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}>
                          <ChevronLeft className="h-3 w-3" />
                        </Button>
                        <span className="text-zinc-500 px-2 font-mono">{page + 1} / {totalPages}</span>
                        <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1}>
                          <ChevR className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
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
                    <div key={q.id} className="group p-2 rounded border border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 cursor-pointer" onClick={() => loadQuery(q.sql)}>
                      <div className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 text-zinc-400" />
                        <span className="text-xs font-medium flex-1">{q.name}</span>
                      </div>
                      {q.desc && <div className="text-[10px] text-zinc-500 mt-0.5 pl-4">{q.desc}</div>}
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
                    <div key={h.id} className={`p-2 rounded border text-xs cursor-pointer hover:border-sky-300 ${h.ok ? 'border-zinc-200 dark:border-zinc-700' : 'border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20'}`} onClick={() => loadQuery(h.sql)}>
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
                      {currentTable.columns.map(c => {
                        const hasChinese = /[^\x00-\x7F]/.test(c.name)
                        return (
                          <button
                            key={c.name}
                            onClick={() => insertColumn(c.name)}
                            className="w-full text-left flex items-center gap-2 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs group"
                          >
                            <span className={`font-mono flex-1 truncate ${hasChinese ? 'text-rose-600 dark:text-rose-400' : 'group-hover:text-sky-600 dark:group-hover:text-sky-400'}`}>{c.name}</span>
                            <span className="text-[10px] text-sky-600 dark:text-sky-400 font-mono">{c.type}</span>
                            {!c.nullable && <span className="text-[9px] px-1 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400">NN</span>}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* 保存对话框（简易内联）*/}
      {showSaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setShowSaveDialog(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-lg p-4 w-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-medium mb-3 flex items-center gap-2">
              <Save className="h-4 w-4" /> 保存查询
            </div>
            <Input
              autoFocus
              placeholder="查询名称..."
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setShowSaveDialog(false) }}
              className="mb-3"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowSaveDialog(false)}>取消</Button>
              <Button size="sm" onClick={handleSave} disabled={!saveName.trim()}>保存</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
