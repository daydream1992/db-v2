'use client'
import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { DashboardView } from '@/components/dataops/dashboard-view'
import { CatalogView } from '@/components/dataops/catalog-view'
import { HealthView } from '@/components/dataops/health-view'
import { OrchestrationView } from '@/components/dataops/orchestration-view'
import { LineageView } from '@/components/dataops/lineage-view'
import { LintView } from '@/components/dataops/lint-view'
import { LogsView } from '@/components/dataops/logs-view'
import { DictionaryView } from '@/components/dataops/dictionary-view'
import { SettingsView } from '@/components/dataops/settings-view'
import { SqlPlaygroundView } from '@/components/dataops/sql-playground-view'
import { CommandPalette } from '@/components/dataops/command-palette'
import { NotificationCenter } from '@/components/dataops/notification-center'
import { KeyboardHelp } from '@/components/dataops/keyboard-help'
import { ThemeToggle } from '@/components/theme-toggle'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { TABLES, ALERTS, PIPELINE_RUNS } from '@/lib/dataops/mock-data'
import { APP_CONFIG } from '@/lib/dataops/config'
import { useRealtimeAlerts } from '@/hooks/use-realtime-alerts'
import { toast } from 'sonner'
import {
  LayoutDashboard, Library, HeartPulse, Workflow, GitBranch,
  CheckCheck, ScrollText, BookOpen, Settings, Database, Github, Sparkles, AlertTriangle, Play, Terminal, Search, Bell, Keyboard,
  ChevronLeft
} from 'lucide-react'

type View = 'dashboard' | 'catalog' | 'health' | 'orchestration' | 'lineage' | 'lint' | 'logs' | 'dictionary' | 'sql' | 'settings'

const NAV: { key: View; label: string; icon: React.ReactNode; badge?: number }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'catalog', label: '脚本目录', icon: <Library className="h-4 w-4" />, badge: TABLES.length },
  { key: 'health', label: '健康度', icon: <HeartPulse className="h-4 w-4" />, badge: TABLES.filter(t => t.health === 'red').length },
  { key: 'orchestration', label: '编排', icon: <Workflow className="h-4 w-4" />, badge: PIPELINE_RUNS.filter(r => r.status === 'running').length },
  { key: 'lineage', label: '血缘', icon: <GitBranch className="h-4 w-4" /> },
  { key: 'lint', label: '规范校验', icon: <CheckCheck className="h-4 w-4" />, badge: ALERTS.filter(a => a.type === 'lint').length },
  { key: 'logs', label: '日志', icon: <ScrollText className="h-4 w-4" /> },
  { key: 'dictionary', label: '数据字典', icon: <BookOpen className="h-4 w-4" /> },
  { key: 'sql', label: 'SQL Playground', icon: <Terminal className="h-4 w-4" /> },
  { key: 'settings', label: '设置', icon: <Settings className="h-4 w-4" /> },
]

const VIEW_TITLES: Record<View, { title: string; desc: string }> = {
  dashboard: { title: 'Dashboard', desc: '全局健康度 · 今日执行 · 告警总览' },
  catalog: { title: '脚本目录', desc: '所有数据表与入库脚本的注册中心' },
  health: { title: '健康度', desc: '红绿灯矩阵 · 新鲜度 · 一致性' },
  orchestration: { title: '编排', desc: 'DAG 依赖 · 调度计划 · 执行历史' },
  lineage: { title: '血缘', desc: '表 ↔ 脚本 ↔ 上游的关系图' },
  lint: { title: '规范校验', desc: '12 条可机器校验的编码规则' },
  logs: { title: '日志', desc: '按表 / 级别 / 时间筛选' },
  dictionary: { title: '数据字典', desc: '字段级元数据 SSOT' },
  sql: { title: 'SQL Playground', desc: '在线查询 DuckDB · Ctrl+Enter 执行' },
  settings: { title: '设置', desc: 'DB 连接 · 调度 · 数据源 · 集成' },
}

export default function Home() {
  const [view, setView] = useState<View>('dashboard')
  const [cmdOpen, setCmdOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [isLg, setIsLg] = useState(false)
  const [isHydrated, setIsHydrated] = useState(false)

  // Fix SSR hydration: update sidebar state on mount + detect breakpoint
  useEffect(() => {
    const stored = localStorage.getItem('dataops:sidebar-collapsed')
    const shouldCollapse = stored !== null ? stored === 'true' : window.innerWidth < 640
    if (shouldCollapse) {
      queueMicrotask(() => setSidebarCollapsed(true))
    }

    const checkLg = () => setIsLg(window.innerWidth >= 1024)
    checkLg()
    window.addEventListener('resize', checkLg)

    // Mark as hydrated after initial state settles — skip mount animations
    const raf = requestAnimationFrame(() => {
      setIsHydrated(true)
    })

    return () => {
      window.removeEventListener('resize', checkLg)
      cancelAnimationFrame(raf)
    }
  }, [])

  // Real-time alerts
  const { alerts: realtimeAlerts, lastAlert, paused: alertPaused, togglePause, dismissAlert, clearAlerts, alertCount } = useRealtimeAlerts(true)
  const totalAlertCount = ALERTS.length + alertCount

  useEffect(() => {
    localStorage.setItem('dataops:sidebar-collapsed', String(sidebarCollapsed))
  }, [sidebarCollapsed])

  const handleRunTable = (table: string) => {
    toast.success(`已触发执行：${table}`, {
      description: 'force=False · 触发方式 manual · 可在「编排」页查看进度',
    })
  }

  const handleNavigate = (v: string) => setView(v as View)
  const handleRunDaily = () => {
    toast.info('已触发 daily 全量执行', { description: '18 张 daily 表按拓扑序执行，预计 ~25 分钟' })
    setView('orchestration')
  }

  // Computed sidebar width based on collapsed state and viewport
  const sidebarWidth = sidebarCollapsed ? 48 : (isLg ? 224 : 56)
  // Text labels are only visible on lg+ screens when expanded
  const showLabels = !sidebarCollapsed && isLg

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 bg-grid-pattern">
      {/* 顶部栏 */}
      <header className="border-b bg-white/90 dark:bg-zinc-900/90 backdrop-blur-sm sticky top-0 z-30">
        <div className="px-4 lg:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-sky-500 to-fuchsia-500 text-white shadow-sm">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">DataOps 管理台</div>
              <div className="text-[10px] text-zinc-400 leading-tight">{APP_CONFIG.projectName} · {APP_CONFIG.dbName}</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 ml-6">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
            <span className="text-xs text-zinc-500">DuckDB 已连接</span>
            <span className="sr-only">数据库连接状态：已连接</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-500 transition-colors"
              title="命令面板 (Cmd+K)"
              aria-label="搜索命令面板"
            >
              <Search className="h-3.5 w-3.5" />
              <span>搜索...</span>
              <kbd className="ml-1 px-1 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[9px] font-mono text-zinc-400">⌘K</kbd>
            </button>
            <ThemeToggle />
            <button
              onClick={() => setHelpOpen(true)}
              className="hidden sm:flex p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="键盘快捷键 (?)"
              aria-label="快捷键"
            >
              <Keyboard className="h-4 w-4" />
            </button>
            <button
              onClick={() => setNotifOpen(true)}
              className={`relative p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-all ${lastAlert ? 'animate-pulse-glow' : ''}`}
              title="通知中心"
              aria-label="通知"
            >
              <Bell className={`h-4 w-4 transition-colors ${lastAlert ? 'text-rose-500' : ''}`} />
              {totalAlertCount > 0 && (
                <span className={`absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full text-white text-[9px] font-bold leading-none transition-colors ${lastAlert ? 'bg-rose-600 animate-pulse' : 'bg-rose-500'}`}>
                  {totalAlertCount}
                </span>
              )}
            </button>
            <button
              onClick={handleRunDaily}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium transition-colors"
              aria-label="执行 daily"
            >
              <Play className="h-3.5 w-3.5" /> 执行 daily
            </button>
            <a
              href={APP_CONFIG.gitHubRepo}
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="仓库"
              aria-label="GitHub 仓库"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 侧栏 */}
        <motion.aside
          className="border-r bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm flex-shrink-0 hidden sm:flex flex-col overflow-hidden"
          animate={{ width: sidebarWidth }}
          transition={isHydrated
            ? {
                duration: sidebarCollapsed ? 0.2 : 0.25,
                delay: sidebarCollapsed ? 0.06 : 0,
                ease: [0.4, 0, 0.2, 1],
              }
            : { duration: 0 }
          }
        >
          <nav className="p-2 space-y-0.5 sticky top-14">
            {NAV.map(item => {
              const active = view === item.key
              const btn = (
                <button
                  onClick={() => setView(item.key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all duration-200 relative overflow-hidden ${
                    active
                      ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-medium shadow-sm'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:translate-x-0.5'
                  }`}
                  aria-label={item.label}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r-full bg-gradient-to-b from-sky-500 to-fuchsia-500" />
                  )}
                  <span className={`flex-shrink-0 transition-transform duration-200 ${active ? 'scale-110' : 'group-hover:scale-105'}`}>{item.icon}</span>
                  <AnimatePresence>
                    {showLabels && (
                      <motion.span
                        key={`label-${item.key}`}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { delay: 0.12, duration: 0.2, ease: 'easeOut' } }}
                        exit={{ opacity: 0, transition: { duration: 0.08, ease: 'easeIn' } }}
                        className="flex-1 text-left truncate"
                      >
                        {item.label}
                      </motion.span>
                    )}
                  </AnimatePresence>
                  <AnimatePresence>
                    {showLabels && item.badge !== undefined && item.badge > 0 && (
                      <motion.span
                        key={`badge-${item.key}`}
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1, transition: { delay: 0.16, duration: 0.2, ease: 'easeOut' } }}
                        exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.08, ease: 'easeIn' } }}
                        className={`px-1.5 min-w-[18px] h-[18px] inline-flex items-center justify-center rounded-full text-[10px] font-medium transition-transform duration-200 ${active ? 'scale-105' : ''} ${
                          item.key === 'health' ? 'bg-rose-500 text-white' :
                          item.key === 'lint' ? 'bg-amber-400 text-amber-950' :
                          item.key === 'orchestration' ? 'bg-sky-500 text-white' :
                          'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
                        }`}
                      >
                        {item.badge}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              )
              if (sidebarCollapsed) {
                return (
                  <Tooltip key={item.key}>
                    <TooltipTrigger asChild>{btn}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>{item.label}</TooltipContent>
                  </Tooltip>
                )
              }
              return <div key={item.key}>{btn}</div>
            })}
          </nav>

          {/* 探索稿信息卡片 */}
          <AnimatePresence>
            {!sidebarCollapsed && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0, transition: { delay: 0.18, duration: 0.25, ease: 'easeOut' } }}
                exit={{ opacity: 0, y: 8, transition: { duration: 0.12, ease: 'easeIn' } }}
                className="hidden lg:block p-3 mt-4 mx-2 rounded-md bg-gradient-to-br from-sky-50 to-fuchsia-50 dark:from-sky-950/30 dark:to-fuchsia-950/30 border border-sky-100 dark:border-sky-900"
              >
                <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 mb-1">
                  <Sparkles className="h-3.5 w-3.5" /> 探索稿 v1
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  这是系统化方案的 UI 原型，数据为 mock。基于真实 26 个脚本清单 + 诊断报告。
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 底部切换按钮区域 */}
          <div className="mt-auto p-2 border-t border-zinc-100 dark:border-zinc-800 sidebar-toggle-glow">
            <button
              onClick={() => setSidebarCollapsed(c => !c)}
              className="w-full flex items-center justify-center p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500 transition-colors"
              aria-label={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
              title={sidebarCollapsed ? '展开侧栏' : '收起侧栏'}
            >
              <motion.div
                animate={{ rotate: sidebarCollapsed ? 180 : 0 }}
                transition={{ duration: 0.25, ease: 'easeInOut' }}
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.div>
            </button>
          </div>
        </motion.aside>

        {/* 移动端导航 */}
        <div className="sm:hidden border-b bg-white dark:bg-zinc-900 px-2 py-2 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {NAV.map(item => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap ${
                  view === item.key ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-medium' : 'text-zinc-500'
                }`}
                aria-label={item.label}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* 主内容 */}
        <main className="flex-1 min-w-0 overflow-hidden">
          <div className="px-4 lg:px-6 py-4">
            {/* 页面标题 */}
            <div className="mb-4 flex items-center justify-between animate-fade-in">
              <div>
                <h1 className="text-lg font-semibold flex items-center gap-2">
                  <span className="text-gradient">{VIEW_TITLES[view].title}</span>
                </h1>
                <p className="text-xs text-zinc-500 mt-0.5">{VIEW_TITLES[view].desc}</p>
              </div>
              {view === 'dashboard' && (
                <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3 w-3" /> {ALERTS.filter(a => a.level === 'red').length} 项待处理
                </div>
              )}
            </div>

            {/* 视图内容 */}
            <div key={view} className="animate-fade-in">
              {view === 'dashboard' && <DashboardView onNavigate={handleNavigate} />}
              {view === 'catalog' && <CatalogView onNavigate={handleNavigate} onRunTable={handleRunTable} />}
              {view === 'health' && <HealthView onRunTable={handleRunTable} />}
              {view === 'orchestration' && <OrchestrationView onRunTable={handleRunTable} />}
              {view === 'lineage' && <LineageView onNavigate={handleNavigate} />}
              {view === 'lint' && <LintView />}
              {view === 'logs' && <LogsView />}
              {view === 'dictionary' && <DictionaryView />}
              {view === 'sql' && <SqlPlaygroundView />}
              {view === 'settings' && <SettingsView />}
            </div>
          </div>
        </main>
      </div>

      {/* Sticky Footer */}
      <footer className="mt-auto border-t bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
        <div className="px-4 lg:px-6 py-2.5 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-500">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium">DataOps 管理台</span>
              <Badge variant="outline" className="text-[9px] py-0 px-1.5 font-mono">v{APP_CONFIG.version}</Badge>
            </span>
            <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
            <span>{TABLES.length} 表 · {NAV.length} 视图 · {ALERTS.filter(a => a.type === 'lint').length} lint · Cmd+K</span>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">|</span>
            <span className="hidden md:inline">Gantt 时序 · KPI 钻取 · 日志分组 · YAML 导入导出</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
              <span className="font-mono">{APP_CONFIG.dbName}</span>
            </span>
            <span className="text-zinc-300 dark:text-zinc-700">·</span>
            <span>方案文档：SYSTEM_DESIGN_EXPLORATION_v1.md</span>
          </div>
        </div>
      </footer>

      {/* 命令面板 */}
      <CommandPalette
        open={cmdOpen}
        onOpenChange={setCmdOpen}
        onNavigate={handleNavigate}
        onRunTable={handleRunTable}
        onRunDaily={handleRunDaily}
      />

      {/* 通知中心 */}
      <NotificationCenter
        open={notifOpen}
        onOpenChange={setNotifOpen}
        onNavigate={handleNavigate}
        realtimeAlerts={realtimeAlerts}
        lastAlert={lastAlert}
        alertPaused={alertPaused}
        onTogglePause={togglePause}
        onDismissRealtime={dismissAlert}
        onClearRealtime={clearAlerts}
      />

      {/* 键盘快捷键帮助 */}
      <KeyboardHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  )
}
