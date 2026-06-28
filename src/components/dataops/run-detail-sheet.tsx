'use client'
import { PipelineRun } from '@/lib/dataops/mock-data'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { CheckCircle2, XCircle, SkipForward, Clock, Hash, Activity, FileText, RefreshCw, AlertCircle } from 'lucide-react'
import { formatDuration, formatRows, runStatusClass, triggerClass } from '@/lib/dataops/styles'

// 为某次执行生成 mock 日志
function genRunLogs(run: PipelineRun): { ts: string; level: string; msg: string }[] {
  const base = run.startedAt
  const t0 = base.slice(11)
  if (run.status === 'skipped') {
    return [{ ts: t0, level: 'WARNING', msg: `○ ${run.table} 数据为空，跳过 (${run.error || 'is_fresh'})` }]
  }
  if (run.status === 'failed') {
    return [
      { ts: t0, level: 'INFO', msg: `▶ 开始 ${run.table}` },
      { ts: t0, level: 'ERROR', msg: `✘ ${run.table} 失败: ${run.error || '未知错误'}` },
    ]
  }
  // success
  const logs = [{ ts: t0, level: 'INFO', msg: `▶ 开始 ${run.table}` }]
  if (run.table.includes('kline')) {
    logs.push({ ts: t0, level: 'INFO', msg: '  增量模式，最小日期: 20260626' })
    logs.push({ ts: t0, level: 'DEBUG', msg: '  读取 .day/.lc5 文件 4896/4896' })
  }
  if (run.table === 'capital_info') {
    logs.push({ ts: t0, level: 'INFO', msg: '  全量回补 start=20250626(近1年), 已清空' })
    logs.push({ ts: t0, level: 'INFO', msg: '  区间 20250626~至今, 待拉 4896 股' })
    logs.push({ ts: t0, level: 'INFO', msg: '  进度 500/4896 (8.2股/秒, 已入 320,000 行, 剩 ~532s)' })
    logs.push({ ts: t0, level: 'INFO', msg: '  进度 4500/4896 (8.5股/秒, 已入 2,890,000 行, 剩 ~47s)' })
  }
  logs.push({ ts: run.finishedAt!.slice(11), level: 'INFO', msg: `✔ ${run.table} 完成，共 ${run.rowsIn ? formatRows(run.rowsIn) : 0} 条` })
  return logs
}

export function RunDetailSheet({ run, open, onOpenChange, onRerun }: {
  run: PipelineRun | null
  open: boolean
  onOpenChange: (o: boolean) => void
  onRerun?: (table: string) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto" side="right">
        {run && <RunDetail run={run} onRerun={onRerun} />}
      </SheetContent>
    </Sheet>
  )
}

function RunDetail({ run, onRerun }: { run: PipelineRun; onRerun?: (t: string) => void }) {
  const logs = genRunLogs(run)
  const isFailed = run.status === 'failed'
  const isSkipped = run.status === 'skipped'

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${runStatusClass(run.status)}`}>
            {run.status === 'success' && <CheckCircle2 className="h-3 w-3 mr-0.5" />}
            {run.status === 'failed' && <XCircle className="h-3 w-3 mr-0.5" />}
            {run.status === 'skipped' && <SkipForward className="h-3 w-3 mr-0.5" />}
            {run.status === 'running' && <Activity className="h-3 w-3 mr-0.5 animate-pulse" />}
            {run.status}
          </span>
          <span className="font-mono">{run.table}</span>
        </SheetTitle>
        <p className="text-xs text-zinc-500 -mt-2 font-mono">run_id: {run.runId}</p>
      </SheetHeader>

      <div className="px-4 pb-8 space-y-4">
        {/* 元数据网格 */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <DetailItem icon={<Hash className="h-3.5 w-3.5" />} label="触发方式" value={
            <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${triggerClass(run.trigger)}`}>{run.trigger}</Badge>
          } />
          <DetailItem icon={<Clock className="h-3.5 w-3.5" />} label="耗时" value={<span className="font-mono">{formatDuration(run.durationSec)}</span>} />
          <DetailItem icon={<Activity className="h-3.5 w-3.5" />} label="入库行数" value={<span className="font-mono">{run.rowsIn ? formatRows(run.rowsIn) : '—'}</span>} />
          <DetailItem icon={<FileText className="h-3.5 w-3.5" />} label="force" value={<span className="font-mono">{String(run.force)}</span>} />
          <DetailItem label="开始时间" value={<span className="font-mono text-[11px]">{run.startedAt}</span>} />
          <DetailItem label="结束时间" value={<span className="font-mono text-[11px]">{run.finishedAt || '—'}</span>} />
        </div>

        {/* 错误信息 */}
        {run.error && (
          <div className={`p-3 rounded-md border text-xs ${isFailed ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30' : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'}`}>
            <div className={`flex items-center gap-1.5 font-medium mb-1 ${isFailed ? 'text-rose-700 dark:text-rose-300' : 'text-amber-700 dark:text-amber-300'}`}>
              <AlertCircle className="h-3.5 w-3.5" />错误信息
            </div>
            <div className="font-mono text-[11px] text-zinc-700 dark:text-zinc-300 leading-relaxed">{run.error}</div>
          </div>
        )}

        {/* 操作 */}
        <div className="grid grid-cols-2 gap-2">
          {(isFailed || isSkipped) && (
            <Button size="sm" variant={isFailed ? 'destructive' : 'default'} onClick={() => onRerun?.(run.table)}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />重新执行
            </Button>
          )}
          <Button size="sm" variant="outline" className={(isFailed || isSkipped) ? '' : 'col-span-2'} onClick={() => onRerun?.(run.table)}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" />强制重跑 (force=True)
          </Button>
        </div>

        {/* 日志 */}
        <div>
          <div className="text-xs font-medium text-zinc-500 mb-2 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" />执行日志
            <Badge variant="outline" className="ml-auto text-[10px] py-0">{logs.length} 行</Badge>
          </div>
          <div className="rounded-md border bg-zinc-50 dark:bg-zinc-900/60 overflow-hidden">
            <ScrollArea className="h-64">
              <div className="px-3 py-2 font-mono text-[11px] space-y-0.5">
                {logs.map((l, i) => (
                  <div key={i} className={`flex gap-2 py-0.5 ${l.level === 'ERROR' ? 'text-rose-600' : l.level === 'WARNING' ? 'text-amber-600' : l.level === 'DEBUG' ? 'text-zinc-400' : 'text-zinc-700 dark:text-zinc-300'}`}>
                    <span className="text-zinc-400 flex-shrink-0">{l.ts}</span>
                    <span className="flex-shrink-0 w-14 font-bold">{l.level}</span>
                    <span className="flex-1 whitespace-pre-wrap">{l.msg}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* 日志文件路径 */}
        {run.logPath && (
          <div className="text-[11px] text-zinc-400 flex items-center gap-1.5">
            <FileText className="h-3 w-3" />
            <span className="font-mono">{run.logPath}</span>
          </div>
        )}
      </div>
    </>
  )
}

function DetailItem({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border border-zinc-200 dark:border-zinc-700">
      {icon && <span className="text-zinc-400">{icon}</span>}
      <div className="min-w-0">
        <div className="text-[10px] text-zinc-400">{label}</div>
        <div className="text-xs">{value}</div>
      </div>
    </div>
  )
}
