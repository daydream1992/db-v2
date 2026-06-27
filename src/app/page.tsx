'use client'
import { useState } from 'react'
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
import { ThemeToggle } from '@/components/theme-toggle'
import { TABLES, ALERTS, PIPELINE_RUNS } from '@/lib/dataops/mock-data'
import { toast } from 'sonner'
import {
  LayoutDashboard, Library, HeartPulse, Workflow, GitBranch,
  CheckCheck, ScrollText, BookOpen, Settings, Database, Github, Sparkles, AlertTriangle, Play, Terminal, Search, Bell
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

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      {/* 顶部栏 */}
      <header className="border-b bg-white dark:bg-zinc-900 sticky top-0 z-30">
        <div className="px-4 lg:px-6 h-14 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-gradient-to-br from-sky-500 to-fuchsia-500 text-white">
              <Database className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold leading-tight">DataOps 管理台</div>
              <div className="text-[10px] text-zinc-400 leading-tight">DB数据库_v2 · profit_radar.duckdb</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2 ml-6">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-zinc-500">DuckDB 已连接 · 1.2 GB</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setCmdOpen(true)}
              className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs text-zinc-500 transition-colors"
              title="命令面板 (Cmd+K)"
            >
              <Search className="h-3.5 w-3.5" />
              <span>搜索...</span>
              <kbd className="ml-1 px-1 py-0.5 rounded bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-[9px] font-mono text-zinc-400">⌘K</kbd>
            </button>
            <ThemeToggle />
            <button
              onClick={() => setNotifOpen(true)}
              className="relative p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="通知中心"
              aria-label="通知"
            >
              <Bell className="h-4 w-4" />
              {ALERTS.length > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[9px] font-bold leading-none">
                  {ALERTS.length}
                </span>
              )}
            </button>
            <button
              onClick={handleRunDaily}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500 hover:bg-sky-600 text-white text-xs font-medium transition-colors"
            >
              <Play className="h-3.5 w-3.5" /> 执行 daily
            </button>
            <a
              href="https://github.com"
              target="_blank"
              rel="noreferrer"
              className="p-1.5 rounded-md hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
              title="仓库"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* 侧栏 */}
        <aside className="w-14 lg:w-56 border-r bg-white dark:bg-zinc-900 flex-shrink-0 hidden sm:block">
          <nav className="p-2 space-y-0.5 sticky top-14">
            {NAV.map(item => {
              const active = view === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => setView(item.key)}
                  className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm transition-colors ${
                    active
                      ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-medium'
                      : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                  title={item.label}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span className="hidden lg:inline flex-1 text-left truncate">{item.label}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className={`hidden lg:inline-flex px-1.5 min-w-[18px] h-[18px] items-center justify-center rounded-full text-[10px] font-medium ${
                      item.key === 'health' ? 'bg-rose-500 text-white' :
                      item.key === 'lint' ? 'bg-amber-400 text-amber-950' :
                      item.key === 'orchestration' ? 'bg-sky-500 text-white' :
                      'bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
          <div className="hidden lg:block p-3 mt-4 mx-2 rounded-md bg-gradient-to-br from-sky-50 to-fuchsia-50 dark:from-sky-950/30 dark:to-fuchsia-950/30 border border-sky-100 dark:border-sky-900">
            <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700 dark:text-sky-300 mb-1">
              <Sparkles className="h-3.5 w-3.5" /> 探索稿 v1
            </div>
            <p className="text-[10px] text-zinc-500 leading-relaxed">
              这是系统化方案的 UI 原型，数据为 mock。基于真实 26 个脚本清单 + 诊断报告。
            </p>
          </div>
        </aside>

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
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h1 className="text-lg font-semibold flex items-center gap-2">
                  {VIEW_TITLES[view].title}
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
            {view === 'dashboard' && <DashboardView onNavigate={handleNavigate} />}
            {view === 'catalog' && <CatalogView onNavigate={handleNavigate} onRunTable={handleRunTable} />}
            {view === 'health' && <HealthView onRunTable={handleRunTable} />}
            {view === 'orchestration' && <OrchestrationView onRunTable={handleRunTable} />}
            {view === 'lineage' && <LineageView />}
            {view === 'lint' && <LintView />}
            {view === 'logs' && <LogsView />}
            {view === 'dictionary' && <DictionaryView />}
            {view === 'sql' && <SqlPlaygroundView />}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>

      {/* Sticky Footer */}
      <footer className="mt-auto border-t bg-white dark:bg-zinc-900">
        <div className="px-4 lg:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-2 text-[11px] text-zinc-500">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              DataOps 管理台 · 探索稿 v2
            </span>
            <span className="hidden sm:inline text-zinc-300 dark:text-zinc-700">|</span>
            <span>26 张表 · 10 个视图 · 12 条 lint 规则 · Cmd+K 命令面板</span>
            <span className="hidden md:inline text-zinc-300 dark:text-zinc-700">|</span>
            <span className="hidden md:inline">基于真实脚本清单 mock</span>
          </div>
          <div className="flex items-center gap-3">
            <span>profit_radar.duckdb</span>
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
      />
    </div>
  )
}
