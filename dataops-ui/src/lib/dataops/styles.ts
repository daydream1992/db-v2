'use client'
// DataOps 共享辅助：颜色映射、格式化
import { HealthColor, LintLevel, RunStatus, TableType } from './mock-data'

export function healthColorClass(c: HealthColor): string {
  switch (c) {
    case 'green': return 'bg-emerald-500 text-white'
    case 'yellow': return 'bg-amber-400 text-amber-950'
    case 'red': return 'bg-rose-500 text-white'
    case 'white': return 'bg-zinc-200 text-zinc-600'
  }
}

export function healthTextColorClass(health: HealthColor): string {
  switch (health) {
    case 'green': return 'text-emerald-500'
    case 'yellow': return 'text-amber-500'
    case 'red': return 'text-rose-500'
    case 'white': return 'text-zinc-400'
  }
}

export function freshnessClass(f: string): string {
  switch (f) {
    case '最新': return 'text-emerald-600'
    case '滞后': return 'text-rose-600 font-medium'
    case '无日期列': return 'text-amber-600'
    case '空表': return 'text-rose-600 font-medium'
    default: return 'text-zinc-400'
  }
}

export function typeBadgeClass(t: TableType): string {
  switch (t) {
    case '事实': return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
    case '维度': return 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300'
    case '视图': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    case '多表': return 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300'
    case '孤儿': return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
    case '测试': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
  }
}

export function lintLevelClass(l: LintLevel): string {
  switch (l) {
    case 'RED': return 'bg-rose-500 text-white'
    case 'YELLOW': return 'bg-amber-400 text-amber-950'
    case 'BLUE': return 'bg-sky-400 text-white'
  }
}

export function lintLevelDot(l: LintLevel): string {
  switch (l) {
    case 'RED': return 'bg-rose-500'
    case 'YELLOW': return 'bg-amber-400'
    case 'BLUE': return 'bg-sky-400'
  }
}

export function runStatusClass(s: RunStatus): string {
  switch (s) {
    case 'success': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    case 'failed': return 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
    case 'skipped': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
    case 'running': return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300 animate-pulse'
    case 'pending': return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
  }
}

export function runStatusDot(s: RunStatus): string {
  switch (s) {
    case 'success': return 'bg-emerald-500'
    case 'failed': return 'bg-rose-500'
    case 'skipped': return 'bg-zinc-300'
    case 'running': return 'bg-sky-500 animate-pulse'
    case 'pending': return 'bg-zinc-300'
  }
}

export function formatRows(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(2)}亿`
  if (n >= 10_000) return `${(n / 10_000).toFixed(1)}万`
  return n.toLocaleString()
}

export function formatDuration(sec: number | null): string {
  if (sec === null) return '—'
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m${s}s`
  const h = Math.floor(m / 60)
  return `${h}h${m % 60}m`
}

export function triggerClass(t: string): string {
  switch (t) {
    case 'schedule': return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
    case 'manual': return 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
    case 'health-fix': return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
    case 'backfill': return 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300'
    default: return 'bg-zinc-100 text-zinc-600'
  }
}
