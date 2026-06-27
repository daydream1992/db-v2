'use client'
import { useState, useMemo } from 'react'
import { TABLES } from '@/lib/dataops/mock-data'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { GitBranch, ArrowDown, ArrowUp, Box, Search } from 'lucide-react'

export function LineageView() {
  const [focus, setFocus] = useState<string>('stock_daily_kline')
  const [depth, setDepth] = useState(2)
  const [search, setSearch] = useState('')

  // 计算上游/下游 N 层
  const graph = useMemo(() => {
    const upstream = new Set<string>()
    const downstream = new Set<string>()

    const collectUp = (table: string, d: number) => {
      if (d <= 0) return
      const t = TABLES.find(x => x.table === table)
      if (!t) return
      for (const dep of t.dependsOn) {
        upstream.add(dep)
        collectUp(dep, d - 1)
      }
    }
    const collectDown = (table: string, d: number) => {
      if (d <= 0) return
      for (const t of TABLES) {
        if (t.dependsOn.includes(table)) {
          downstream.add(t.table)
          collectDown(t.table, d - 1)
        }
      }
    }
    collectUp(focus, depth)
    collectDown(focus, depth)
    return { upstream, downstream }
  }, [focus, depth])

  const focused = TABLES.find(t => t.table === focus)

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="输入表名作为焦点..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
                onKeyDown={e => { if (e.key === 'Enter' && TABLES.find(t => t.table === search)) setFocus(search) }}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">展开层数</span>
              <div className="flex bg-zinc-100 dark:bg-zinc-800 rounded-md p-0.5">
                {[1, 2, 3].map(d => (
                  <button key={d} onClick={() => setDepth(d)} className={`px-2.5 py-0.5 text-xs rounded ${depth === d ? 'bg-white dark:bg-zinc-700 shadow-sm font-medium' : 'text-zinc-500'}`}>{d}</button>
                ))}
              </div>
            </div>
            <Badge variant="secondary" className="text-xs">焦点：{focus}</Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <GitBranch className="h-4 w-4 text-fuchsia-500" />
            血缘关系图
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 上游 */}
            <div>
              <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><ArrowUp className="h-3.5 w-3.5" /> 上游 ({graph.upstream.size})</div>
              <div className="space-y-1.5">
                {graph.upstream.size === 0 && <div className="text-xs text-zinc-400 py-4 text-center">无库内上游</div>}
                {[...graph.upstream].map(t => {
                  const meta = TABLES.find(x => x.table === t)
                  return (
                    <button key={t} onClick={() => setFocus(t)} className="w-full text-left p-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:border-sky-300 dark:hover:border-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30 transition-colors">
                      <div className="font-mono text-xs font-medium truncate">{t}</div>
                      {meta && <div className="text-[10px] text-zinc-400 truncate">{meta.cn}</div>}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 焦点 */}
            <div>
              <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><Box className="h-3.5 w-3.5" /> 焦点表</div>
              {focused && (
                <div className="p-3 rounded-md border-2 border-fuchsia-400 bg-fuchsia-50 dark:bg-fuchsia-950/30">
                  <div className="font-mono text-sm font-semibold">{focused.table}</div>
                  <div className="text-xs text-zinc-500 mb-2">{focused.cn}</div>
                  <div className="space-y-1 text-[11px]">
                    <div className="flex justify-between"><span className="text-zinc-400">类型</span><span>{focused.type}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">schedule</span><span>{focused.schedule}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">行数</span><span className="font-mono">{(focused.rows / 10000).toFixed(1)}万</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">新鲜度</span><span>{focused.freshness}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">上游数</span><span>{focused.dependsOn.length}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-400">下游数</span><span>{focused.downstream.length}</span></div>
                  </div>
                  <div className="mt-2 pt-2 border-t border-fuchsia-200 dark:border-fuchsia-800">
                    <div className="text-[10px] text-zinc-400 mb-1">外部数据源</div>
                    <div className="flex flex-wrap gap-1">
                      {focused.sourceDeps.length === 0 ? <span className="text-[10px] text-zinc-400">无</span> :
                        focused.sourceDeps.map(d => <Badge key={d} variant="outline" className="text-[10px] py-0 px-1 font-mono">{d}</Badge>)}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 下游 */}
            <div>
              <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1"><ArrowDown className="h-3.5 w-3.5" /> 下游 ({graph.downstream.size})</div>
              <div className="space-y-1.5">
                {graph.downstream.size === 0 && <div className="text-xs text-zinc-400 py-4 text-center">无下游</div>}
                {[...graph.downstream].map(t => {
                  const meta = TABLES.find(x => x.table === t)
                  return (
                    <button key={t} onClick={() => setFocus(t)} className="w-full text-left p-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors">
                      <div className="font-mono text-xs font-medium truncate">{t}</div>
                      {meta && <div className="text-[10px] text-zinc-400 truncate">{meta.cn}</div>}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t text-xs text-zinc-500">
            <strong className="text-zinc-700 dark:text-zinc-300">用途：</strong>
            上游坏了 → 查哪些下游受影响；改某表 schema → 查哪些脚本要同步改；调度排序 → 按拓扑序自动排。
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
