'use client'
import { useState, useMemo } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Bell, AlertTriangle, Clock, Filter, CheckCheck, X, ExternalLink, Trash2 } from 'lucide-react'
import { ALERTS, Alert } from '@/lib/dataops/mock-data'
import { toast } from 'sonner'

interface NotificationCenterProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onNavigate?: (v: string) => void
}

export function NotificationCenter({ open, onOpenChange, onNavigate }: NotificationCenterProps) {
  const [filter, setFilter] = useState<'all' | 'red' | 'yellow'>('all')
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())

  const visible = useMemo(() => {
    return ALERTS.filter(a => !dismissed.has(a.id)).filter(a => filter === 'all' || a.level === filter)
  }, [filter, dismissed])

  const redCount = ALERTS.filter(a => a.level === 'red' && !dismissed.has(a.id)).length
  const yellowCount = ALERTS.filter(a => a.level === 'yellow' && !dismissed.has(a.id)).length

  const dismiss = (id: string) => {
    setDismissed(prev => new Set(prev).add(id))
    toast.success('已忽略该告警')
  }

  const dismissAll = () => {
    setDismissed(new Set(ALERTS.map(a => a.id)))
    toast.success(`已清空 ${ALERTS.length} 条告警`)
  }

  const goToAlert = (a: Alert) => {
    const target = a.type === 'lint' ? 'lint' : a.type === 'health' ? 'health' : 'orchestration'
    onNavigate?.(target)
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col" side="right">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-amber-500" />
            通知中心
            <Badge variant="secondary" className="ml-1 text-[10px]">{visible.length}</Badge>
          </SheetTitle>
          <SheetDescription className="text-xs">
            {redCount > 0 && <span className="text-rose-600 font-medium">{redCount} 红 </span>}
            {yellowCount > 0 && <span className="text-amber-600 font-medium">{yellowCount} 黄 </span>}
            {redCount === 0 && yellowCount === 0 && <span className="text-emerald-600">全部已处理</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
          <Tabs value={filter} onValueChange={v => setFilter(v as 'all' | 'red' | 'yellow')}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5 py-1">全部 {ALERTS.filter(a => !dismissed.has(a.id)).length}</TabsTrigger>
              <TabsTrigger value="red" className="text-xs px-2.5 py-1">红 {redCount}</TabsTrigger>
              <TabsTrigger value="yellow" className="text-xs px-2.5 py-1">黄 {yellowCount}</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={dismissAll} disabled={visible.length === 0}>
            <CheckCheck className="h-3 w-3 mr-1" />全部忽略
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {visible.length === 0 && (
              <div className="py-16 text-center text-zinc-400 text-sm flex flex-col items-center gap-2">
                <CheckCheck className="h-8 w-8 text-emerald-400" />
                <div>暂无告警</div>
                <div className="text-xs text-zinc-300">所有告警已忽略或处理</div>
              </div>
            )}
            {visible.map(a => (
              <div
                key={a.id}
                className={`p-3 rounded-md border text-xs transition-all hover:shadow-sm ${
                  a.level === 'red'
                    ? 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30'
                    : 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30'
                }`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <AlertTriangle className={`h-3.5 w-3.5 ${a.level === 'red' ? 'text-rose-500' : 'text-amber-500'}`} />
                  <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300 truncate">{a.table}</span>
                  <Badge variant="outline" className="ml-auto text-[9px] py-0 px-1.5 uppercase tracking-wide">{a.type}</Badge>
                  <button
                    onClick={() => dismiss(a.id)}
                    className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 p-0.5 rounded hover:bg-white/60 dark:hover:bg-zinc-800/60"
                    aria-label="忽略"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div className="text-zinc-600 dark:text-zinc-400 leading-relaxed mb-2">{a.message}</div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-zinc-400 flex items-center gap-1"><Clock className="h-3 w-3" />{a.ts}</span>
                  <button
                    onClick={() => goToAlert(a)}
                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/60 dark:hover:bg-zinc-800/60 ${a.level === 'red' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}
                  >
                    查看详情 <ExternalLink className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="border-t px-3 py-2 flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
          <span className="flex items-center gap-1"><Filter className="h-3 w-3" />{dismissed.size > 0 ? `${dismissed.size} 条已忽略` : '未筛选'}</span>
          {dismissed.size > 0 && (
            <button
              onClick={() => setDismissed(new Set())}
              className="text-sky-600 hover:underline flex items-center gap-1"
            >
              <Trash2 className="h-3 w-3" />恢复已忽略
            </button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
