'use client'
import { useState, useMemo } from 'react'
import { LINT_RULES, LintLevel } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, AlertCircle, ListChecks, Wrench, TrendingUp } from 'lucide-react'
import { lintLevelClass, lintLevelDot } from '@/lib/dataops/styles'

export function LintView() {
  const [filter, setFilter] = useState<'all' | LintLevel>('all')

  const stats = useMemo(() => {
    const red = LINT_RULES.filter(r => r.level === 'RED')
    const yellow = LINT_RULES.filter(r => r.level === 'YELLOW')
    const blue = LINT_RULES.filter(r => r.level === 'BLUE')
    const totalViolations = LINT_RULES.reduce((s, r) => s + r.violations.length, 0)
    const passing = LINT_RULES.filter(r => r.violations.length === 0).length
    return {
      red: red.length, yellow: yellow.length, blue: blue.length,
      totalRules: LINT_RULES.length, passing,
      passRate: Math.round((passing / LINT_RULES.length) * 100),
      totalViolations,
      redViolations: red.reduce((s, r) => s + r.violations.length, 0),
      yellowViolations: yellow.reduce((s, r) => s + r.violations.length, 0),
      blueViolations: blue.reduce((s, r) => s + r.violations.length, 0),
    }
  }, [])

  const filtered = filter === 'all' ? LINT_RULES : LINT_RULES.filter(r => r.level === filter)

  return (
    <div className="space-y-4">
      {/* 顶部统计 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400">规则总数</div>
            <div className="text-2xl font-semibold">{stats.totalRules}</div>
            <div className="text-[10px] text-emerald-600 flex items-center gap-1"><TrendingUp className="h-3 w-3" />通过率 {stats.passRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" />RED 阻断</div>
            <div className="text-2xl font-semibold text-rose-600">{stats.red}</div>
            <div className="text-[10px] text-zinc-400">{stats.redViolations} 处违规</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-[11px] text-zinc-400 flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />YELLOW 警告</div>
            <div className="text-2xl font-semibold text-amber-600">{stats.yellow}</div>
            <div className="text-[10px] text-zinc-400">{stats.yellowViolations} 处违规</div>
          </CardContent>
        </Card>
        <Card>
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

      {/* 筛选 */}
      <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1 w-fit">
        {([['all', `全部 (${LINT_RULES.length})`], ['RED', `RED (${stats.red})`], ['YELLOW', `YELLOW (${stats.yellow})`], ['BLUE', `BLUE (${stats.blue})`]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-3 py-1.5 text-sm rounded-md transition-colors ${filter === k ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{l}</button>
        ))}
      </div>

      {/* 规则列表 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filtered.map(rule => (
          <Card key={rule.id} className={rule.violations.length === 0 ? 'opacity-80' : ''}>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${lintLevelClass(rule.level)}`}>{rule.level}</span>
                <CardTitle className="text-sm font-mono">{rule.id}</CardTitle>
                <span className="text-sm font-medium">{rule.name}</span>
                {rule.violations.length === 0 ? (
                  <Badge variant="outline" className="ml-auto text-[10px] text-emerald-600 border-emerald-300"><CheckCircle2 className="h-3 w-3 mr-0.5" />通过</Badge>
                ) : (
                  <Badge variant="outline" className="ml-auto text-[10px] text-rose-600 border-rose-300"><XCircle className="h-3 w-3 mr-0.5" />{rule.violations.length} 违规</Badge>
                )}
              </div>
              <p className="text-xs text-zinc-500 mt-1">{rule.description}</p>
            </CardHeader>
            {rule.violations.length > 0 && (
              <CardContent className="pt-0">
                <ScrollArea className="max-h-44">
                  <div className="space-y-1.5">
                    {rule.violations.map((v, i) => (
                      <div key={i} className="p-2 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/40 text-xs">
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
          </Card>
        ))}
      </div>

      {/* 说明 */}
      <Card>
        <CardContent className="p-3">
          <div className="flex items-start gap-2 text-xs text-zinc-500">
            <ListChecks className="h-4 w-4 mt-0.5 flex-shrink-0 text-zinc-400" />
            <div>
              <strong className="text-zinc-700 dark:text-zinc-300">lint engine 说明：</strong>
              所有规则可由 <code className="font-mono text-sky-600">python run.py lint</code> 执行，挂 git pre-commit + CI 强制。
              RED 阻断合并、YELLOW 提示、BLUE 仅建议。规则集可扩展，目标：把"靠人记的规范"变成"机器校验的契约"。
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
