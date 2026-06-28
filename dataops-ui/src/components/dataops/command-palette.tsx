'use client'
import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { Command as CommandPrimitive } from 'cmdk'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { TABLES, ALERTS, LINT_RULES, PIPELINE_RUNS } from '@/lib/dataops/mock-data'
import {
  LayoutDashboard, Library, HeartPulse, Workflow, GitBranch,
  CheckCheck, ScrollText, BookOpen, Settings, Database, Terminal,
  Play, Search, AlertTriangle, FileCode2, Zap, CornerDownLeft,
  Clock, Trash2, RotateCcw,
} from 'lucide-react'

const RECENT_KEY = 'dataops:recent-searches'
const MAX_RECENT = 6
const CMD_HISTORY_KEY = 'dataops:cmd-history'
const MAX_CMD_HISTORY = 20
const LAST_SEARCH_KEY = 'dataops:last-search'
const USED_CMDS_KEY = 'dataops:used-commands'
const MAX_USED_CMDS = 20

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

interface UsedCmdEntry {
  key: string
  label: string
  ts: number
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
  const [cmdHistory, setCmdHistory] = useState<string[]>([])
  const [usedCmds, setUsedCmds] = useState<UsedCmdEntry[]>([])
  const [ghostText, setGhostText] = useState('')
  const [selectedValue, setSelectedValue] = useState<string>('')
  const historyIndex = useRef(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  // 加载最近搜索 + 命令历史 + 最近使用
  useEffect(() => {
    try {
      const raw = localStorage.getItem(RECENT_KEY)
      if (raw) setRecents(JSON.parse(raw))
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(CMD_HISTORY_KEY)
      if (raw) setCmdHistory(JSON.parse(raw))
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(USED_CMDS_KEY)
      if (raw) setUsedCmds(JSON.parse(raw))
    } catch { /* ignore */ }
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

  // 打开时恢复上次搜索词
  useEffect(() => {
    if (open) {
      // Restore last search query
      try {
        const lastSearch = localStorage.getItem(LAST_SEARCH_KEY) || ''
        setSearch(lastSearch)
      } catch {
        setSearch('')
      }
      setGhostText('')
      historyIndex.current = -1
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // 关闭时保存当前搜索词
  useEffect(() => {
    if (!open && search !== undefined) {
      try { localStorage.setItem(LAST_SEARCH_KEY, search) } catch { /* ignore */ }
    }
  }, [open, search])

  const recordRecent = (query: string, actionLabel: string) => {
    if (!query.trim()) return
    const entry: RecentEntry = { query: query.trim(), ts: Date.now(), actionLabel }
    const next = [entry, ...recents.filter(r => r.query !== entry.query)].slice(0, MAX_RECENT)
    setRecents(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  const recordCmdHistory = useCallback((query: string) => {
    if (!query.trim()) return
    const deduped = cmdHistory.filter(h => h !== query.trim())
    const next = [query.trim(), ...deduped].slice(0, MAX_CMD_HISTORY)
    setCmdHistory(next)
    try { localStorage.setItem(CMD_HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [cmdHistory])

  const recordUsedCmd = useCallback((key: string, label: string) => {
    const entry: UsedCmdEntry = { key, label, ts: Date.now() }
    const deduped = usedCmds.filter(c => c.key !== key)
    const next = [entry, ...deduped].slice(0, MAX_USED_CMDS)
    setUsedCmds(next)
    try { localStorage.setItem(USED_CMDS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }, [usedCmds])

  // History navigation via ↑↓ when search is empty
  const handleInputKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (search === '' && ghostText === '') {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        if (cmdHistory.length > 0) {
          historyIndex.current = Math.min(historyIndex.current + 1, cmdHistory.length - 1)
          setGhostText(cmdHistory[historyIndex.current])
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        return
      }
    } else if (search === '' && ghostText !== '') {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        historyIndex.current = Math.min(historyIndex.current + 1, cmdHistory.length - 1)
        setGhostText(cmdHistory[historyIndex.current])
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        historyIndex.current = Math.max(historyIndex.current - 1, -1)
        if (historyIndex.current >= 0) {
          setGhostText(cmdHistory[historyIndex.current])
        } else {
          setGhostText('')
        }
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        setSearch(ghostText)
        setGhostText('')
        historyIndex.current = -1
        return
      }
      if (e.key === 'Escape') {
        setGhostText('')
        historyIndex.current = -1
        return
      }
    }
    // Clear ghost text when user types any printable character
    if (ghostText && e.key.length === 1) {
      setGhostText('')
      historyIndex.current = -1
    }
  }, [search, ghostText, cmdHistory])

  const clearRecents = () => {
    setRecents([])
    try { localStorage.removeItem(RECENT_KEY) } catch { /* ignore */ }
  }

  const clearUsedCmds = () => {
    setUsedCmds([])
    try { localStorage.removeItem(USED_CMDS_KEY) } catch { /* ignore */ }
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
    { key: 'act-fix-red', label: '一键补数红表', desc: `重新执行 ${TABLES.filter(t => t.health === 'red').length} 张异常表`, icon: <Zap className="h-4 w-4 text-rose-600" />, group: 'actions', run: () => { TABLES.filter(t => t.health === 'red').forEach(t => onRunTable?.(t.table)); onOpenChange(false) }, keywords: 'fix red 异常 补数' },
  ]

  const tableItems: CommandPaletteAction[] = TABLES.map(t => ({
    key: `tbl-${t.table}`,
    label: t.table,
    desc: `${t.cn} · ${t.dir} · ${t.rows > 0 ? `${(t.rows / 10000).toFixed(1)}万行` : '空表'}`,
    icon: <Database className={`h-4 w-4 ${t.health === 'red' ? 'text-rose-500' : t.health === 'yellow' ? 'text-amber-500' : 'text-sky-500'}`} />,
    group: 'tables' as const,
    run: () => { onRunTable?.(t.table); onOpenChange(false) },
    keywords: `${t.cn} ${t.script} ${t.source}`,
  }))

  const alertItems: CommandPaletteAction[] = ALERTS.map(a => ({
    key: `al-${a.id}`,
    label: a.table === '(全局)' ? `告警 · ${a.type}` : `${a.table} · ${a.type}`,
    desc: a.message,
    icon: <AlertTriangle className={`h-4 w-4 ${a.level === 'red' ? 'text-rose-500' : 'text-amber-500'}`} />,
    group: 'alerts' as const,
    run: () => { onNavigate(a.type === 'lint' ? 'lint' : a.type === 'health' ? 'health' : 'orchestration'); onOpenChange(false) },
    keywords: a.ts,
  }))

  const lintItems: CommandPaletteAction[] = LINT_RULES.filter(r => r.violations.length > 0).map(r => ({
    key: `lint-${r.id}`,
    label: `${r.id} · ${r.name}`,
    desc: `${r.violations.length} 处违规 · ${r.description}`,
    icon: <FileCode2 className={`h-4 w-4 ${r.level === 'RED' ? 'text-rose-500' : r.level === 'YELLOW' ? 'text-amber-500' : 'text-sky-500'}`} />,
    group: 'lint' as const,
    run: () => { onNavigate('lint'); onOpenChange(false) },
    keywords: r.id + ' ' + r.name,
  }))

  const runItems: CommandPaletteAction[] = PIPELINE_RUNS.slice(0, 6).map(r => ({
    key: `run-${r.id}`,
    label: `#${r.id} ${r.table}`,
    desc: `${r.status} · ${r.trigger} · ${r.startedAt.slice(5)}${r.error ? ' · ' + r.error : ''}`,
    icon: <Workflow className="h-4 w-4 text-zinc-500" />,
    group: 'runs' as const,
    run: () => { onNavigate('orchestration'); onOpenChange(false) },
    keywords: r.runId,
  }))

  // Build flat list of all items for index tracking
  const allItems = useMemo(() => [
    ...navItems,
    ...actionItems,
    ...tableItems,
    ...alertItems,
    ...lintItems,
    ...runItems,
  ], [navItems, actionItems, tableItems, alertItems, lintItems, runItems])

  // Recently used commands (deduplicated by key)
  const usedCmdMap = useMemo(() => {
    const map = new Map<string, CommandPaletteAction>()
    for (const item of allItems) {
      map.set(item.key, item)
    }
    return map
  }, [allItems])

  const recentUsedItems = useMemo(() => {
    return usedCmds
      .filter(uc => usedCmdMap.has(uc.key))
      .map(uc => usedCmdMap.get(uc.key)!)
      .slice(0, 6)
  }, [usedCmds, usedCmdMap])

  // Compute selection index from selectedValue
  const selectedIndex = useMemo(() => {
    if (!selectedValue) return -1
    // Search through visible items to find the index
    // We need to count all items that are currently rendered in order
    const visibleItems: string[] = []

    // Recently used commands (only when no search)
    if (!search && recentUsedItems.length > 0) {
      recentUsedItems.forEach(a => visibleItems.push(a.key))
    }
    navItems.forEach(a => visibleItems.push(a.key))
    actionItems.forEach(a => visibleItems.push(a.key))
    tableItems.forEach(a => visibleItems.push(a.key))
    alertItems.forEach(a => visibleItems.push(a.key))
    lintItems.forEach(a => visibleItems.push(a.key))
    runItems.forEach(a => visibleItems.push(a.key))

    const idx = visibleItems.indexOf(selectedValue)
    return idx >= 0 ? idx : -1
  }, [selectedValue, search, recentUsedItems, navItems, actionItems, tableItems, alertItems, lintItems, runItems])

  const totalItems = allItems.length + (search ? 0 : recentUsedItems.length)

  const handleSelect = (action: CommandPaletteAction) => {
    if (search.trim()) {
      recordRecent(search, action.label)
      recordCmdHistory(search)
    }
    recordUsedCmd(action.key, action.label)
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Command Palette</DialogTitle>
        <DialogDescription>Search for a command to run...</DialogDescription>
      </DialogHeader>
      <DialogContent className="overflow-hidden p-0 max-w-2xl" showCloseButton={false}>
        <CommandPrimitive
          className="[&_[cmdk-group-heading]]:text-muted-foreground **:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group]]:px-2 [&_[cmdk-group]:not([hidden])_~[cmdk-group]]:pt-0 [&_[cmdk-input-wrapper]_svg]:h-5 [&_[cmdk-input-wrapper]_svg]:w-5 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5 bg-popover text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md"
          onValueChange={setSelectedValue}
        >
          {/* Custom input with ghost text support */}
          <div className="flex items-center gap-2 border-b px-3 h-12 relative">
            <Search className="h-5 w-5 shrink-0 opacity-50" />
            <div className="relative flex-1">
              <CommandPrimitive.Input
                ref={inputRef}
                placeholder="输入视图名、表名、脚本、告警... (Cmd+K 唤起)"
                value={search}
                onValueChange={(v: string) => { setSearch(v); if (ghostText) { setGhostText(''); historyIndex.current = -1 } }}
                onKeyDown={handleInputKeyDown}
                className="placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              />
              {ghostText && !search && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-sm text-zinc-400 pointer-events-none truncate max-w-[80%]">
                  {ghostText}
                </span>
              )}
            </div>
          </div>
          <CommandList className="max-h-[480px]">
            <CommandEmpty>无匹配项</CommandEmpty>

            {/* 最近使用（仅空搜索时显示）*/}
            {!search && recentUsedItems.length > 0 && (
              <CommandGroup heading="最近使用">
                {recentUsedItems.map(a => (
                  <CommandItem key={`used-${a.key}`} value={`${a.label} ${a.desc} ${a.keywords ?? ''}`} onSelect={() => handleSelect(a)}>
                    {a.icon}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{a.label}</div>
                      <div className="text-[11px] text-zinc-500 truncate">{a.desc}</div>
                    </div>
                    <RotateCcw className="h-3 w-3 text-zinc-300" />
                  </CommandItem>
                ))}
                <CommandItem value="清除最近使用 clear-used" onSelect={clearUsedCmds} className="text-rose-500">
                  <Trash2 className="h-4 w-4" />
                  <span className="text-sm">清除使用记录</span>
                </CommandItem>
              </CommandGroup>
            )}
            {!search && recentUsedItems.length > 0 && <CommandSeparator />}

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
            {!search && recents.length > 0 && <CommandSeparator />}

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
          {/* 底部快捷键提示栏 + 选中索引 */}
          <div className="border-t border-zinc-200 dark:border-zinc-800 px-3 py-2 flex items-center justify-between text-[10px] text-zinc-500 bg-zinc-50/50 dark:bg-zinc-900/50">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 font-mono text-[9px] shadow-sm">↑↓</kbd>
                {search ? '导航' : '历史'}
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
              {selectedIndex >= 0 && (
                <span className="font-mono text-zinc-400">{selectedIndex + 1}/{totalItems}</span>
              )}
              <span className="text-zinc-400">DataOps · {totalItems} 项</span>
            </div>
          </div>
        </CommandPrimitive>
      </DialogContent>
    </Dialog>
  )
}
