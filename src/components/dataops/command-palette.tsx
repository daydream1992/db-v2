'use client'
import { useEffect, useState, useRef } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { TABLES, ALERTS, LINT_RULES, PIPELINE_RUNS, deriveHealthFromScan } from '@/lib/dataops/mock-data'
import {
  LayoutDashboard, Library, HeartPulse, Workflow, GitBranch,
  CheckCheck, ScrollText, BookOpen, Settings, Database, Terminal,
  Play, Search, AlertTriangle, FileCode2, Zap, CornerDownLeft,
  Clock, Trash2,
} from 'lucide-react'

const RECENT_KEY = 'dataops:recent-searches'
const MAX_RECENT = 6

interface RecentEntry {
  query: string
  ts: number
  actionLabel: string
}

export interface CommandPaletteAction {
  key: string
  label: string
  desc: string
  icon: React.ReactNode
  shortcut?: string
  group: 'navigation' | 'tables' | 'actions' | 'alerts' | 'lint' | 'runs'
  run: () => void
  keywords?: string
}

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onNavigate: (v: string) => void
  onRunTable?: (t: string) => void
  onRunDaily?: () => void
}

export function CommandPalette({ open, onOpenChange, onNavigate, onRunTable, onRunDaily }: CommandPaletteProps) {
  const [search, setSearch] = useState('')
  const [recents, setRecents] = useState<RecentEntry[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // 加载最近搜索
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      if (raw) setRecents(JSON.parse(raw))
    } catch {}
  }, [])

  // 全局 Cmd/Ctrl+K 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
      if (e.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  // 打开时清空搜索
  useEffect(() => {
    if (open) {
      setSearch('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const recordRecent = (query: string, actionLabel: string) => {
    if (!query.trim()) return
    const entry: RecentEntry = { query: query.trim(), ts: Date.now(), actionLabel }
    const next = [entry, ...recents.filter(r => r.query !== entry.query)].slice(0, MAX_RECENT)
    setRecents(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch {}
  }

  const clearRecents = () => {
    setRecents([])
    try { localStorage.removeItem(RECENT_KEY) } catch {}
  }

  const navItems: CommandPaletteAction[] = [
    { key: 'nav-dash', label: 'Dashboard', desc: '全局健康度 · 今日执行 · 告警总览', icon: <LayoutDashboard className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('dashboard'), keywords: '仪表盘 首页 home' },
    { key: 'nav-catalog', label: '脚本目录', desc: '所有数据表与入库脚本', icon: <Library className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('catalog'), keywords: '表 脚本 catalog' },
    { key: 'nav-health', label: '健康度', desc: '红绿灯矩阵 · 新鲜度', icon: <HeartPulse className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('health'), keywords: '红绿灯 矩阵 状态' },
    { key: 'nav-orch', label: '编排', desc: 'DAG 依赖 · 调度计划', icon: <Workflow className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('orchestration'), keywords: 'dag 调度' },
    { key: 'nav-lin', label: '血缘', desc: '表 ↔ 脚本 ↔ 上游关系', icon: <GitBranch className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('lineage'), keywords: 'lineage 依赖' },
    { key: 'nav-lint', label: '规范校验', desc: '12 条 lint 规则', icon: <CheckCheck className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('lint'), keywords: 'lint 校验 规则' },
    { key: 'nav-logs', label: '日志', desc: '按表/级别/时间筛选', icon: <ScrollText className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('logs'), keywords: 'logs 日志' },
    { key: 'nav-dict', label: '数据字典', desc: '字段级元数据 SSOT', icon: <BookOpen className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('dictionary'), keywords: 'dictionary 字典 schema' },
    { key: 'nav-sql', label: 'SQL Playground', desc: '在线查询 DuckDB', icon: <Terminal className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('sql'), keywords: 'sql playground 查询' },
    { key: 'nav-settings', label: '设置', desc: 'DB · 调度 · 数据源', icon: <Settings className="h-4 w-4" />, group: 'navigation', run: () => onNavigate('settings'), keywords: 'settings 配置' },
  ]

  const actionItems: CommandPaletteAction[] = [
    { key: 'act-daily', label: '执行 daily 全量', desc: '18 张 daily 表按拓扑序执行', icon: <Play className="h-4 w-4 text-emerald-600" />, group: 'actions', run: () => { onRunDaily?.(); onOpenChange(false) }, keywords: 'run execute 执行' },
    { key: 'act-fix-red', label: '一键补数红表', desc: `重新执行 ${TABLES.filter(t => deriveHealthFromScan(t) === 'red').length} 张异常表`, icon: <Zap className="h-4 w-4 text-rose-600" />, group: 'actions', run: () => { TABLES.filter(t => deriveHealthFromScan(t) === 'red').forEach(t => onRunTable?.(t.table)); onOpenChange(false) }, keywords: 'fix red 异常 补数' },
  ]

  const tableItems: CommandPaletteAction[] = TABLES.map(t => ({
    key: `tbl-${t.table}`,
    label: t.table,
    desc: `${t.cn} · ${t.dir} · ${t.rows > 0 ? `${(t.rows / 10000).toFixed(1)}万行` : '空表'}`,
    icon: <Database className={`h-4 w-4 ${deriveHealthFromScan(t) === 'red' ? 'text-rose-500' : deriveHealthFromScan(t) === 'yellow' ? 'text-amber-500' : 'text-sky-500'}`} />,
    group: 'tables',
    run: () => { onRunTable?.(t.table); onOpenChange(false) },
    keywords: `${t.cn} ${t.script} ${t.source}`,
  }))

  const alertItems: CommandPaletteAction[] = ALERTS.map(a => ({
    key: `al-${a.id}`,
    label: a.table === '(全局)' ? `告警 · ${a.type}` : `${a.table} · ${a.type}`,
    desc: a.message,
    icon: <AlertTriangle className={`h-4 w-4 ${a.level === 'red' ? 'text-rose-500' : 'text-amber-500'}`} />,
    group: 'alerts',
    run: () => { onNavigate(a.type === 'lint' ? 'lint' : a.type === 'health' ? 'health' : 'orchestration'); onOpenChange(false) },
    keywords: a.ts,
  }))

  const lintItems: CommandPaletteAction[] = LINT_RULES.filter(r => r.violations.length > 0).map(r => ({
    key: `lint-${r.id}`,
    label: `${r.id} · ${r.name}`,
    desc: `${r.violations.length} 处违规 · ${r.description}`,
    icon: <FileCode2 className={`h-4 w-4 ${r.level === 'RED' ? 'text-rose-500' : r.level === 'YELLOW' ? 'text-amber-500' : 'text-sky-500'}`} />,
    group: 'lint',
    run: () => { onNavigate('lint'); onOpenChange(false) },
    keywords: r.id + ' ' + r.name,
  }))

  const runItems: CommandPaletteAction[] = PIPELINE_RUNS.slice(0, 6).map(r => ({
    key: `run-${r.id}`,
    label: `#${r.id} ${r.table}`,
    desc: `${r.status} · ${r.trigger} · ${r.startedAt.slice(5)}${r.error ? ' · ' + r.error : ''}`,
    icon: <Workflow className="h-4 w-4 text-zinc-500" />,
    group: 'runs',
    run: () => { onNavigate('orchestration'); onOpenChange(false) },
    keywords: r.runId,
  }))

  const handleSelect = (action: CommandPaletteAction) => {
    if (search.trim()) recordRecent(search, action.label)
    action.run()
  }

  const formatTs = (ts: number) => {
    const diff = Date.now() - ts
    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
    return `${Math.floor(diff / 86400000)}天前`
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="max-w-2xl">
      <CommandInput ref={inputRef} placeholder="输入视图名、表名、脚本、告警... (Cmd+K 唤起)" value={search} onValueChange={setSearch} />
      <CommandList className="max-h-[480px]">
        <CommandEmpty>无匹配项</CommandEmpty>

        {/* 最近搜索（仅空搜索时显示）*/}
        {!search && recents.length > 0 && (
          <CommandGroup heading="最近搜索">
            {recents.map((r, i) => (
              <CommandItem key={`recent-${i}`} value={`${r.query} ${r.actionLabel}`} onSelect={() => { setSearch(r.query); }}>
                <Clock className="h-4 w-4 text-zinc-400" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.query}</div>
                  <div className="text-[11px] text-zinc-500 truncate">→ {r.actionLabel} · {formatTs(r.ts)}</div>
                </div>
              </CommandItem>
            ))}
            <CommandItem value="清除最近搜索历史 clear" onSelect={clearRecents} className="text-rose-500">
              <Trash2 className="h-4 w-4" />
              <span className="text-sm">清除搜索历史</span>
            </CommandItem>
          </CommandGroup>
        )}
        <CommandSeparator />

        <CommandGroup heading="导航">
          {navItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
              <CornerDownLeft className="h-3 w-3 text-zinc-300 ml-auto opacity-0 group-data-[selected=true]:opacity-100" />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="快捷操作">
          {actionItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={`数据表 (${TABLES.length})`}>
          {tableItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
              <CommandShortcut className="text-[10px]">执行</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading={`告警 (${ALERTS.length})`}>
          {alertItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Lint 规则违规">
          {lintItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="最近执行">
          {runItems.map(a => (
            <CommandItem key={a.key} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
              {a.icon}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-mono">{a.label}</div>
                <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
      {/* 底部快捷键提示栏 */}
      <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2 flex items-center justify-between text-[10px] text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-[9px] shadow-sm">↑↓</kbd>
            导航
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-[9px] shadow-sm">↵</kbd>
            选择
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-[9px] shadow-sm">Esc</kbd>
            关闭
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-400">DataOps v3 · {navItems.length + tableItems.length + actionItems.length + alertItems.length + lintItems.length + runItems.length} 项</span>
        </div>
      </div>
    </CommandDialog>
  )
}
