'use client'
import { useState, useMemo, useCallback } from 'react'
import { LINT_RULES, LintLevel } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Progress } from '@/components/ui/progress'
import { CheckCircle2, XCircle, ListChecks, Wrench, TrendingUp, Grid3x3, Filter, Download, Play, Loader2, ChevronDown, ChevronRight, Shield, FileCode2, Hash, AlignLeft } from 'lucide-react'
import { lintLevelClass } from '@/lib/dataops/styles'
import { toast } from 'sonner'

// Rule categories derived from rule IDs
const RULE_CATEGORIES: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  naming: { label: '命名规范', icon: Hash, color: 'text-rose-600' },
  contract: { label: '契约规范', icon: FileCode2, color: 'text-amber-600' },
  integrity: { label: '数据完整性', icon: Shield, color: 'text-sky-600' },
  style: { label: '代码风格', icon: AlignLeft, color: 'text-fuchsia-600' },
}

function getRuleCategory(ruleId: string): keyof typeof RULE_CATEGORIES {
  if (['R001', 'R004'].includes(ruleId)) return 'naming'
  if (['R002', 'R003', 'R009'].includes(ruleId)) return 'contract'
  if (['R005', 'R006', 'R007', 'R008', 'R010'].includes(ruleId)) return 'integrity'
  return 'style'
}

// Severity badge with colored border
function SeverityBadge({ level }: { level: LintLevel }) {
  const config: Record<LintLevel, { label: string; border: string; bg: string; text: string }> = {
    RED: { label: 'ERROR', border: 'border-rose-400 dark:border-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300' },
    YELLOW: { label: 'WARNING', border: 'border-amber-400 dark:border-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' },
    BLUE: { label: 'INFO', border: 'border-sky-400 dark:border-sky-600', bg: 'bg-sky-50 dark:bg-sky-950/40', text: 'text-sky-700 dark:text-sky-300' },
  }
  const c = config[level]
  return (
    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${c.border} ${c.bg} ${c.text}`}>
      {c.label}
    </span>
  )
}

export function LintView() {
  const [filter, setFilter] = useState<'all' | LintLevel>('all')
  const [matrixRule, setMatrixRule] = useState<string | null>(null)
  const [matrixTable, setMatrixTable] = useState<string | null>(null)
  const [lintRunning, setLintRunning] = useState(false)
  const [lintProgress, setLintProgress] = useState(0)
  const [lintResults, setLintResults] = useState<LINT_RULES | null>(null)
  const [expandedRules, setExpandedRules] = useState<Set<string>>(() => new Set())

  const toggleExpand = useCallback((ruleId: string) => {
    setExpandedRules(prev => {
      const next = new Set(prev)
      if (next.has(ruleId)) next.delete(ruleId)
      else next.add(ruleId)
      return next
    })
  }, [])

  const stats = useMemo(() => {
    const rules = lintResults || LINT_RULES
    const red = rules.filter(r => r.level === 'RED')
    const yellow = rules.filter(r => r.level === 'YELLOW')
    const blue = rules.filter(r => r.level === 'BLUE')
    const totalViolations = rules.reduce((s, r) => s + r.violations.length, 0)
    const passing = rules.filter(r => r.violations.length === 0).length
    return {
      red: red.length, yellow: yellow.length, blue: blue.length,
      totalRules: rules.length, passing,
      passRate: Math.round((passing / rules.length) * 100),
      totalViolations,
      redViolations: red.reduce((s, r) => s + r.violations.length, 0),
      yellowViolations: yellow.reduce((s, r) => s + r.violations.length, 0),
      blueViolations: blue.reduce((s, r) => s + r.violations.length, 0),
    }
  }, [lintResults])

  const rules = lintResults || LINT_RULES

  // Group rules by category
  const rulesByCategory = useMemo(() => {
    const grouped = new Map<string, typeof rules>()
    rules.forEach(r => {
      const cat = getRuleCategory(r.id)
      if (!grouped.has(cat)) grouped.set(cat, [])
      grouped.get(cat)!.push(r)
    })
    return grouped
  }, [rules])

  // 矩阵数据：规则 × 表 的违规数
  const { matrixTables, matrix } = useMemo(() => {
    const tableSet = new Set<string>()
    rules.forEach(r => r.violations.forEach(v => tableSet.add(v.table)))
    const tables = Array.from(tableSet).sort((a, b) => {
      const aIsMeta = a.startsWith('(')
      const bIsMeta = b.startsWith('(')
      if (aIsMeta && !bIsMeta) return 1
      if (!aIsMeta && bIsMeta) return -1
      return a.localeCompare(b)
    })
    const m: Record<string, Record<string, number>> = {}
    rules.forEach(r => {
      m[r.id] = {}
      tables.forEach(t => { m[r.id][t] = 0 })
      r.violations.forEach(v => { m[r.id][v.table] = (m[r.id][v.table] || 0) + 1 })
    })
    return { matrixTables: tables, matrix: m }
  }, [rules])

  const cellColor = (ruleLevel: LintLevel, count: number): string => {
    if (count === 0) return 'bg-zinc-100 dark:bg-zinc-800/60'
    if (ruleLevel === 'RED') {
      if (count >= 2) return 'bg-rose-500 text-white'
      return 'bg-rose-300 dark:bg-rose-700/70 text-rose-950 dark:text-white'
    }
    if (ruleLevel === 'YELLOW') {
      if (count >= 2) return 'bg-amber-400 text-amber-950'
      return 'bg-amber-200 dark:bg-amber-700/60 text-amber-950 dark:text-white'
    }
    return 'bg-sky-300 dark:bg-sky-700/70 text-sky-950 dark:text-white'
  }

  const filtered = (() => {
    let r = filter === 'all' ? rules : rules.filter(r => r.level === filter)
    if (matrixRule) r = r.filter(rr => rr.id === matrixRule)
    if (matrixTable) r = r.filter(rr => rr.violations.some(v => v.table === matrixTable))
    return r
  })()

  // 导出 Python linter
  const handleExportLinter = useCallback(async () => {
    try {
      toast.info('正在生成 Python linter 脚本...')
      const res = await fetch('/api/lint/export')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'lint_engine.py'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Python linter 已导出 (lint_engine.py)')
    } catch (err) {
      toast.error(`导出失败: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }, [])

  // 运行 lint（模拟客户端检查）
  const handleRunLint = useCallback(async () => {
    setLintRunning(true)
    setLintProgress(0)
    setLintResults(null)

    const totalSteps = LINT_RULES.length
    const newResults: typeof LINT_RULES = []

    for (let i = 0; i < totalSteps; i++) {
      await new Promise(resolve => setTimeout(resolve, 150 + Math.random() * 100))
      newResults.push({ ...LINT_RULES[i] })
      setLintProgress(Math.round(((i + 1) / totalSteps) * 100))
    }

    setLintResults(newResults)
    setLintRunning(false)

    const totalViolations = newResults.reduce((s, r) => s + r.violations.length, 0)
    const passing = newResults.filter(r => r.violations.length === 0).length
    toast.success(`Lint 完成: ${passing}/${totalSteps} 规则通过，${totalViolations} 处违规`)
  }, [])

  return (
    <div className="space-y-4">
      {/* 顶部操作栏 */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs gap-1.5"
          onClick={handleExportLinter}
        >
          <Download className="h-3.5 w-3.5" />
          导出 Python linter
        </Button>
        <Button
          size="sm"
          variant={lintRunning ? 'secondary' : 'default'}
          className="h-8 text-xs gap-1.5"
          onClick={handleRunLint}
          disabled={lintRunning}
        >
          {lintRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {lintRunning ? '检查中...' : '运行 Lint'}
        </Button>
        {lintResults && !lintRunning && (
          <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300">
            <CheckCircle2 className="h-3 w-3 mr-0.5" />上次检查完成
          </Badge>
        )}
      </div>

      {/* Lint 运行进度 */}
      {lintRunning && (
        <Card>
          <CardContent className="p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-600 dark:text-zinc-400 flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-500" />
                  正在运行 lint 检查...
                </span>
                <span className="font-mono text-sky-600">{lintProgress}%</span>
              </div>
              <Progress value={lintProgress} className="h-2" />
              <div className="text-[10px] text-zinc-400">
                已检查 {Math.round(lintProgress / 100 * LINT_RULES.length)} / {LINT_RULES.length} 条规则
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 顶部统计 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400">规则总数</div>
            <div className="text-2xl font-semibold">{stats.totalRules}</div>
            <div className="text-[10px] text-emerald-600 flex items-center gap-1"><TrendingUp className="h-3 w-3" />通过率 {stats.passRate}%</div>
          </CardContent>
        </Card>
        <Card className="border-rose-200 dark:border-rose-900/50">
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />RED 阻断</div>
            <div className="text-2xl font-semibold text-rose-600">{stats.red}</div>
            <div className="text-[10px] text-zinc-400">{stats.redViolations} 处违规</div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 dark:border-amber-900/50">
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />YELLOW 警告</div>
            <div className="text-2xl font-semibold text-amber-600">{stats.yellow}</div>
            <div className="text-[10px] text-zinc-400">{stats.yellowViolations} 处违规</div>
          </CardContent>
        </Card>
        <Card className="border-sky-200 dark:border-sky-900/50">
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" />BLUE 建议</div>
            <div className="text-2xl font-semibold text-sky-600">{stats.blue}</div>
            <div className="text-[10px] text-zinc-400">{stats.blueViolations} 处违规</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400">已通过规则</div>
            <div className="text-2xl font-semibold text-emerald-600">{stats.passing}</div>
            <div className="text-[10px] text-zinc-400">{stats.totalViolations} 处待修</div>
          </CardContent>
        </Card>
      </div>

      {/* 规则 × 表 违规矩阵热力图 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Grid3x3 className="h-4 w-4 text-fuchsia-500" />
              规则 × 表 违规矩阵
              <Badge variant="outline" className="text-[10px] font-normal ml-1">
                {rules.length} 规则 × {matrixTables.length} 目标
              </Badge>
            </CardTitle>
            <div className="flex items-center gap-3 text-[10px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-500" />RED ≥2</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-300 dark:bg-rose-700" />RED 1</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" />YELLOW</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-sky-300 dark:bg-sky-700" />BLUE</span>
              <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-100 dark:bg-zinc-800" />通过</span>
            </div>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            每个单元格表示该规则在该表上的违规数。悬停查看详情，点击行/列头筛选下方规则列表。
            {(matrixRule || matrixTable) && (
              <button
                className="ml-2 text-sky-600 hover:underline inline-flex items-center gap-0.5"
                onClick={() => { setMatrixRule(null); setMatrixTable(null); setFilter('all') }}
              >
                <Filter className="h-3 w-3" /> 清除筛选 ({matrixRule || '—'} · {matrixTable || '—'})
              </button>
            )}
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="overflow-x-auto">
            <TooltipProvider delayDuration={150}>
              <table className="text-[11px] border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-background z-10 text-left p-1.5 min-w-[180px] border-b border-r border-zinc-200 dark:border-zinc-700">
                      <span className="text-zinc-400">规则 \ 目标</span>
                    </th>
                    {matrixTables.map(t => (
                      <th
                        key={t}
                        className={`p-1 border-b border-zinc-200 dark:border-zinc-700 cursor-pointer transition-colors ${
                          matrixTable === t ? 'bg-fuchsia-100 dark:bg-fuchsia-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                        }`}
                        onClick={() => setMatrixTable(prev => prev === t ? null : t)}
                      >
                        <div className="writing-vertical-rl text-rotate-180 font-mono text-[10px] text-zinc-600 dark:text-zinc-300 whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>
                          {t}
                        </div>
                      </th>
                    ))}
                    <th className="p-1 border-b border-l border-zinc-200 dark:border-zinc-700 text-zinc-500">合计</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => {
                    const rowTotal = rule.violations.length
                    const isRowActive = matrixRule === rule.id
                    return (
                      <tr key={rule.id} className={isRowActive ? 'bg-fuchsia-50/50 dark:bg-fuchsia-950/20' : ''}>
                        <td
                          className={`sticky left-0 bg-background z-10 p-1.5 border-b border-r border-zinc-200 dark:border-zinc-700 cursor-pointer transition-colors ${
                            isRowActive ? 'bg-fuchsia-100 dark:bg-fuchsia-950/50' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                          }`}
                          onClick={() => { setMatrixRule(prev => prev === rule.id ? null : rule.id); setFilter(prev => prev === rule.level ? 'all' : rule.level) }}
                        >
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex px-1 py-0 rounded text-[9px] font-mono font-bold ${lintLevelClass(rule.level)}`}>{rule.level}</span>
                            <span className="font-mono text-zinc-500">{rule.id}</span>
                            <span className="text-zinc-700 dark:text-zinc-200 truncate max-w-[100px]">{rule.name}</span>
                          </div>
                        </td>
                        {matrixTables.map(t => {
                          const count = matrix[rule.id]?.[t] ?? 0
                          return (
                            <td key={t} className="p-0.5 border-b border-zinc-100 dark:border-zinc-800/50">
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <div
                                    className={`h-7 w-9 rounded-sm flex items-center justify-center font-mono text-[10px] font-medium cursor-pointer transition-all hover:scale-110 hover:z-10 hover:ring-2 hover:ring-fuchsia-400 ${cellColor(rule.level, count)}`}
                                  >
                                    {count > 0 ? count : ''}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <div className="text-xs space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className={`inline-flex px-1 py-0 rounded text-[9px] font-mono font-bold ${lintLevelClass(rule.level)}`}>{rule.level}</span>
                                      <span className="font-mono font-medium">{rule.id}</span>
                                      <span className="text-zinc-300">·</span>
                                      <span className="font-mono text-sky-300">{t}</span>
                                    </div>
                                    <div className="text-zinc-200">{rule.name}</div>
                                    {count > 0 ? (
                                      <div className="text-amber-300">{count} 处违规</div>
                                    ) : (
                                      <div className="text-emerald-300">✓ 通过</div>
                                    )}
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </td>
                          )
                        })}
                        <td className="p-1 text-center border-b border-l border-zinc-200 dark:border-zinc-700">
                          <span className={`font-mono font-bold ${rowTotal > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>{rowTotal || '✓'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="sticky left-0 bg-background z-10 p-1.5 border-t border-r border-zinc-200 dark:border-zinc-700 text-zinc-500 font-medium">列合计</td>
                    {matrixTables.map(t => {
                      const colTotal = rules.reduce((s, r) => s + (matrix[r.id]?.[t] ?? 0), 0)
                      return (
                        <td key={t} className="p-1 text-center border-t border-zinc-200 dark:border-zinc-700">
                          <span className={`font-mono text-[10px] font-bold ${colTotal > 0 ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-300'}`}>{colTotal || ''}</span>
                        </td>
                      )
                    })}
                    <td className="p-1 text-center border-t border-l border-zinc-200 dark:border-zinc-700">
                      <span className="font-mono text-[10px] font-bold text-fuchsia-600">{stats.totalViolations}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      {/* 筛选 */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 w-fit">
        {([['all', `全部 (${rules.length})`], ['RED', `RED (${stats.red})`], ['YELLOW', `YELLOW (${stats.yellow})`], ['BLUE', `BLUE (${stats.blue})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${filter === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{l}</button>
        ))}
      </div>

      {/* 规则列表 - grouped by category */}
      {[...rulesByCategory.entries()].map(([catKey, catRules]) => {
        const catConfig = RULE_CATEGORIES[catKey]
        const CatIcon = catConfig.icon
        const catFiltered = catRules.filter(r => filtered.some(f => f.id === r.id))
        if (catFiltered.length === 0) return null
        return (
          <div key={catKey}>
            <div className="flex items-center gap-2 mb-2">
              <CatIcon className={`h-4 w-4 ${catConfig.color}`} />
              <span className="text-sm font-semibold">{catConfig.label}</span>
              <Badge variant="secondary" className="text-[10px]">{catFiltered.length} 规则</Badge>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {catFiltered.map((rule, ruleIdx) => {
                const isExpanded = expandedRules.has(rule.id)
                const severityBorder = rule.level === 'RED' ? 'border-l-4 border-l-rose-400 dark:border-l-rose-600' : rule.level === 'YELLOW' ? 'border-l-4 border-l-amber-400 dark:border-l-amber-600' : 'border-l-4 border-l-sky-400 dark:border-l-sky-600'
                return (
                  <Card key={rule.id} className={`${rule.violations.length === 0 ? 'opacity-80' : ''} ${severityBorder}`}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center gap-2">
                        <SeverityBadge level={rule.level} />
                        <CardTitle className="text-sm font-mono">{rule.id}</CardTitle>
                        <span className="text-sm font-medium">{rule.name}</span>
                        {rule.violations.length === 0 ? (
                          <Badge variant="outline" className="ml-auto text-[10px] text-emerald-600 border-emerald-300"><CheckCircle2 className="h-3 w-3 mr-0.5" />通过</Badge>
                        ) : (
                          <Badge variant="outline" className="ml-auto text-[10px] text-rose-600 border-rose-300"><XCircle className="h-3 w-3 mr-0.5" />{rule.violations.length} 违规</Badge>
                        )}
                        {rule.violations.length > 0 && (
                          <button onClick={() => toggleExpand(rule.id)} className="p-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                            {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-zinc-500" /> : <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />}
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-zinc-500 mt-1">{rule.description}</p>
                    </CardHeader>
                    {rule.violations.length > 0 && isExpanded && (
                      <CardContent className="pt-0">
                        <ScrollArea className="max-h-44">
                          <div className="space-y-1.5">
                            {rule.violations.map((v, i) => (
                              <div key={i} className={`p-2 rounded border border-zinc-200 dark:border-zinc-700 text-xs ${i % 2 === 0 ? 'bg-zinc-50 dark:bg-zinc-900/40' : 'bg-white dark:bg-zinc-800/40'}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">{v.table}</span>
                                </div>
                                <div className="text-zinc-600 dark:text-zinc-400 mb-1">{v.detail}</div>
                                <div className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-start gap-1">
                                  <Wrench className="h-3 w-3 mt-0.5 flex-shrink-0" />
                                  <span>{v.fix}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                      </CardContent>
                    )}
                    {rule.violations.length > 0 && !isExpanded && (
                      <CardContent className="pt-0">
                        <button
                          onClick={() => toggleExpand(rule.id)}
                          className="text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 flex items-center gap-1"
                        >
                          <ChevronRight className="h-3 w-3" />
                          展开查看 {rule.violations.length} 处违规
                        </button>
                      </CardContent>
                    )}
                  </Card>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* 说明 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-start gap-2 text-xs text-zinc-500">
            <ListChecks className="h-4 w-4 mt-0.5 flex-shrink-0 text-zinc-400" />
            <div>
              <strong className="text-zinc-700 dark:text-zinc-300">lint engine 说明：</strong>
              所有规则可由 <code className="font-mono text-sky-600">python lint_engine.py</code> 执行，挂 git pre-commit + CI 强制。
              RED 阻断合并、YELLOW 提示、BLUE 仅建议。规则集可扩展，目标：把"靠人记的规范"变成"机器校验的契约"。
              点击「导出 Python linter」可下载完整的 lint_engine.py 脚本，在本地或 CI 中运行。
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
