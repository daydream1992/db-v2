'use client'
import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Bell, AlertTriangle, Clock, Filter, CheckCheck, X, ExternalLink, Trash2, Volume2, VolumeX, Pause, Play, CheckCircle2, XCircle, AlertCircle, Info, Settings, Zap } from 'lucide-react'
import { ALERTS, Alert } from '@/lib/dataops/mock-data'
import { useRealtimeAlerts, RealtimeAlert } from '@/hooks/use-realtime-alerts'
import { toast } from 'sonner'

interface NotificationCenterProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  onNavigate?: (v: string) => void
  realtimeAlerts: RealtimeAlert[]
  lastAlert: RealtimeAlert | null
  alertPaused: boolean
  onTogglePause: () => void
  onDismissRealtime: (id: string) => void
  onClearRealtime: () => void
}

// Alert category config with distinct styling
const ALERT_CATEGORIES: Record<string, {
  label: string
  icon: React.ReactNode
  color: string
  bgClass: string
  borderClass: string
  textClass: string
  badgeClass: string
}> = {
  execution_success: {
    label: '执行完成',
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    color: 'text-emerald-500',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/30',
    borderClass: 'border-emerald-200 dark:border-emerald-900',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    badgeClass: 'text-emerald-600 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800',
  },
  execution_failed: {
    label: '执行失败',
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: 'text-rose-500',
    bgClass: 'bg-rose-50 dark:bg-rose-950/30',
    borderClass: 'border-rose-200 dark:border-rose-900',
    textClass: 'text-rose-700 dark:text-rose-300',
    badgeClass: 'text-rose-600 border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800',
  },
  health_change: {
    label: '健康度变更',
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: 'text-amber-500',
    bgClass: 'bg-amber-50 dark:bg-amber-950/30',
    borderClass: 'border-amber-200 dark:border-amber-900',
    textClass: 'text-amber-700 dark:text-amber-300',
    badgeClass: 'text-amber-600 border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800',
  },
  lint_violation: {
    label: 'Lint 违规',
    icon: <Info className="h-3.5 w-3.5" />,
    color: 'text-sky-500',
    bgClass: 'bg-sky-50 dark:bg-sky-950/30',
    borderClass: 'border-sky-200 dark:border-sky-900',
    textClass: 'text-sky-700 dark:text-sky-300',
    badgeClass: 'text-sky-600 border-sky-300 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-800',
  },
  default: {
    label: '其他',
    icon: <AlertCircle className="h-3.5 w-3.5" />,
    color: 'text-zinc-500',
    bgClass: 'bg-zinc-50 dark:bg-zinc-900/30',
    borderClass: 'border-zinc-200 dark:border-zinc-800',
    textClass: 'text-zinc-700 dark:text-zinc-300',
    badgeClass: 'text-zinc-600 border-zinc-300 bg-zinc-50 dark:bg-zinc-800 dark:border-zinc-700',
  },
}

// Map alert to category
function getAlertCategory(alert: Alert & { _realtime?: boolean; _severity?: string; _rtType?: string }): string {
  // For realtime alerts, use the type
  if (alert._realtime && alert._rtType) {
    if (alert._rtType === 'execution' && alert._severity === 'info') return 'execution_success'
    if (alert._rtType === 'execution' && alert._severity === 'error') return 'execution_failed'
    if (alert._rtType === 'health') return 'health_change'
    if (alert._rtType === 'lint') return 'lint_violation'
    if (alert._rtType === 'schema') return 'health_change'
  }
  // For static alerts, infer from type and level
  if (alert.type === 'run') {
    if (alert.level === 'red') return 'execution_failed'
    return 'execution_success'
  }
  if (alert.type === 'health') return 'health_change'
  if (alert.type === 'lint') return 'lint_violation'
  return 'default'
}

// Notification rules state
export interface NotificationRules {
  execution_success: boolean
  execution_failed: boolean
  health_change: boolean
  lint_violation: boolean
  sound: boolean
  toast: boolean
}

const DEFAULT_RULES: NotificationRules = {
  execution_success: true,
  execution_failed: true,
  health_change: true,
  lint_violation: true,
  sound: false,
  toast: true,
}

// Persisted rules from localStorage
function loadRules(): NotificationRules {
  if (typeof window === 'undefined') return DEFAULT_RULES
  try {
    const stored = localStorage.getItem('dataops:notification-rules')
    if (stored) return { ...DEFAULT_RULES, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return DEFAULT_RULES
}

function saveRules(rules: NotificationRules) {
  try {
    localStorage.setItem('dataops:notification-rules', JSON.stringify(rules))
  } catch { /* ignore */ }
}

export function NotificationCenter({
  open, onOpenChange, onNavigate,
  realtimeAlerts, lastAlert, alertPaused, onTogglePause, onDismissRealtime, onClearRealtime,
}: NotificationCenterProps) {
  const [filter, setFilter] = useState<'all' | 'red' | 'yellow' | 'blue'>('all')
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const [readIds, setReadIds] = useState<Set<string>>(new Set())
  const [soundEnabled, setSoundEnabled] = useState(false)
  const [rules, setRules] = useState<NotificationRules>(loadRules)
  const [showRules, setShowRules] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const lastAlertIdRef = useRef<string | null>(null)

  // Create audio element for notification sound
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Use a data URL for a simple beep sound
      audioRef.current = new Audio('data:audio/wav;base64,UklGRl9vT19teleWQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YU' + 'A'.repeat(100))
      audioRef.current.volume = 0.3
    }
  }, [])

  // Save rules when they change
  useEffect(() => {
    saveRules(rules)
  }, [rules])

  // Play notification sound
  const playSound = useCallback(() => {
    if (soundEnabled && audioRef.current) {
      try {
        audioRef.current.play().catch(() => {/* ignore play errors */})
      } catch { /* ignore */ }
    }
  }, [soundEnabled])

  // Merge static ALERTS with realtime alerts
  const allAlerts = useMemo(() => {
    // Convert realtime alerts to compatible format for display
    const rtAlerts = realtimeAlerts ?? []
    const convertedRealtime: (Alert & { _realtime?: boolean; _realtimeId?: string; _severity?: string; _rtType?: string })[] = rtAlerts.map(ra => ({
      id: ra.id,
      level: (ra.severity === 'error' ? 'red' : ra.severity === 'warning' ? 'yellow' : 'blue') as 'red' | 'yellow',
      table: ra.tableName,
      type: ra.type === 'health' ? 'health' : ra.type === 'lint' ? 'lint' : 'run',
      message: ra.message,
      ts: ra.timestamp,
      _realtime: true,
      _realtimeId: ra.id,
      _severity: ra.severity,
      _rtType: ra.type,
    }))
    return [...convertedRealtime, ...ALERTS]
  }, [realtimeAlerts])

  const visible = useMemo(() => {
    return allAlerts.filter(a => {
      if (dismissed.has(a.id)) return false
      if (a._realtimeId && dismissed.has(a._realtimeId)) return false
      if (filter === 'all') return true
      if (filter === 'blue') return a._severity === 'info'
      return a.level === filter
    })
  }, [filter, dismissed, allAlerts])

  const redCount = allAlerts.filter(a => (a.level === 'red' || a._severity === 'error') && !dismissed.has(a.id)).length
  const yellowCount = allAlerts.filter(a => (a.level === 'yellow' || a._severity === 'warning') && !dismissed.has(a.id)).length
  const blueCount = allAlerts.filter(a => a._severity === 'info' && !dismissed.has(a.id)).length
  const totalCount = allAlerts.filter(a => !dismissed.has(a.id)).length
  const unreadCount = allAlerts.filter(a => !dismissed.has(a.id) && !readIds.has(a.id)).length

  // Show toast for new realtime alerts
  useEffect(() => {
    if (!lastAlert || !rules.toast) return
    if (lastAlert.id === lastAlertIdRef.current) return
    lastAlertIdRef.current = lastAlert.id

    // Check if this category is enabled
    const category = getAlertCategory({ _realtime: true, _rtType: lastAlert.type, _severity: lastAlert.severity } as Alert & { _realtime?: boolean; _rtType?: string })
    if (!rules[category as keyof NotificationRules]) return

    const catConfig = ALERT_CATEGORIES[category] || ALERT_CATEGORIES.default

    // Play sound if enabled
    if (rules.sound) playSound()

    // Show toast
    const toastFn = lastAlert.severity === 'error' ? toast.error :
                    lastAlert.severity === 'warning' ? toast.warning : toast.info

    toastFn(`${catConfig.label}: ${lastAlert.tableName}`, {
      description: lastAlert.message,
      duration: 5000,
    })
  }, [lastAlert, rules, playSound])

  const dismiss = (id: string) => {
    setDismissed(prev => new Set(prev).add(id))
    setReadIds(prev => new Set(prev).add(id))
    // Also dismiss from realtime
    const alert = allAlerts.find(a => a.id === id)
    if (alert?._realtimeId) {
      onDismissRealtime(alert._realtimeId)
    }
  }

  const markAllRead = () => {
    const allIds = allAlerts.filter(a => !dismissed.has(a.id)).map(a => a.id)
    setReadIds(prev => new Set([...prev, ...allIds]))
    toast.success('已全部标为已读')
  }

  const dismissAll = () => {
    const allIds = new Set(allAlerts.map(a => a.id))
    setDismissed(allIds)
    setReadIds(allIds)
    onClearRealtime()
    toast.success(`已清空 ${allIds.size} 条告警`)
  }

  const goToAlert = (a: Alert & { _realtime?: boolean }) => {
    setReadIds(prev => new Set(prev).add(a.id))
    const target = a.type === 'lint' ? 'lint' : a.type === 'health' ? 'health' : 'orchestration'
    onNavigate?.(target)
    onOpenChange(false)
  }

  // Check if a realtime alert is new (just arrived)
  const isNewAlert = (id: string) => lastAlert?.id === id

  const toggleRule = (key: keyof NotificationRules) => {
    setRules(prev => ({ ...prev, [key]: !prev[key] }))
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md p-0 flex flex-col" side="right">
        <SheetHeader className="px-4 pt-4 pb-3 border-b">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bell className="h-4 w-4 text-amber-500" />
            通知中心
            <Badge variant="secondary" className="ml-1 text-[10px]">{totalCount}</Badge>
            {unreadCount > 0 && (
              <Badge className="text-[9px] bg-rose-500 text-white hover:bg-rose-600">{unreadCount} 未读</Badge>
            )}
            {alertPaused && (
              <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">暂停中</Badge>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {redCount > 0 && <span className="text-rose-600 font-medium">{redCount} 红 </span>}
            {yellowCount > 0 && <span className="text-amber-600 font-medium">{yellowCount} 黄 </span>}
            {blueCount > 0 && <span className="text-sky-600 font-medium">{blueCount} 信息 </span>}
            {redCount === 0 && yellowCount === 0 && blueCount === 0 && <span className="text-emerald-600">全部已处理</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
          <Tabs value={filter} onValueChange={v => setFilter(v as 'all' | 'red' | 'yellow' | 'blue')}>
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-2.5 py-1">全部 {totalCount}</TabsTrigger>
              <TabsTrigger value="red" className="text-xs px-2.5 py-1">红 {redCount}</TabsTrigger>
              <TabsTrigger value="yellow" className="text-xs px-2.5 py-1">黄 {yellowCount}</TabsTrigger>
              <TabsTrigger value="blue" className="text-xs px-2.5 py-1">信息 {blueCount}</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className={`h-7 text-[10px] ${alertPaused ? 'text-amber-600' : ''}`}
              onClick={onTogglePause}
              title={alertPaused ? '恢复通知' : '暂停通知'}
            >
              {alertPaused ? <Play className="h-3 w-3 mr-0.5" /> : <Pause className="h-3 w-3 mr-0.5" />}
              {alertPaused ? '恢复' : '暂停'}
            </Button>
            <button
              onClick={() => { setSoundEnabled(prev => !prev); setRules(prev => ({ ...prev, sound: !prev.sound })) }}
              className={`p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${soundEnabled ? 'text-sky-600' : 'text-zinc-400'}`}
              title={soundEnabled ? '关闭声音通知' : '开启声音通知'}
              aria-label={soundEnabled ? '关闭声音通知' : '开启声音通知'}
            >
              {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={markAllRead}
              disabled={unreadCount === 0}
              title="全部标为已读"
            >
              <CheckCheck className="h-3 w-3 mr-0.5" />已读
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[10px]"
              onClick={dismissAll}
              disabled={visible.length === 0}
              title="清除全部"
            >
              <Trash2 className="h-3 w-3 mr-0.5" />清除
            </Button>
            <button
              onClick={() => setShowRules(prev => !prev)}
              className={`p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 ${showRules ? 'text-fuchsia-600' : 'text-zinc-400'}`}
              title="通知规则"
              aria-label="通知规则设置"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Notification Rules Panel */}
        {showRules && (
          <div className="px-3 py-3 border-b bg-fuchsia-50/50 dark:bg-fuchsia-950/20 space-y-2 animate-fade-in">
            <div className="flex items-center gap-1.5 text-xs font-medium text-fuchsia-700 dark:text-fuchsia-300 mb-1">
              <Zap className="h-3.5 w-3.5" />
              通知规则
            </div>
            <div className="grid grid-cols-2 gap-2">
              <RuleToggle
                icon={<CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                label="执行完成"
                enabled={rules.execution_success}
                onChange={() => toggleRule('execution_success')}
              />
              <RuleToggle
                icon={<XCircle className="h-3 w-3 text-rose-500" />}
                label="执行失败"
                enabled={rules.execution_failed}
                onChange={() => toggleRule('execution_failed')}
              />
              <RuleToggle
                icon={<AlertTriangle className="h-3 w-3 text-amber-500" />}
                label="健康度变更"
                enabled={rules.health_change}
                onChange={() => toggleRule('health_change')}
              />
              <RuleToggle
                icon={<Info className="h-3 w-3 text-sky-500" />}
                label="Lint 违规"
                enabled={rules.lint_violation}
                onChange={() => toggleRule('lint_violation')}
              />
            </div>
            <div className="flex items-center gap-4 pt-1 border-t border-fuchsia-200 dark:border-fuchsia-900">
              <RuleToggle
                icon={<Volume2 className="h-3 w-3" />}
                label="声音提醒"
                enabled={rules.sound}
                onChange={() => { toggleRule('sound'); setSoundEnabled(prev => !prev) }}
              />
              <RuleToggle
                icon={<Bell className="h-3 w-3" />}
                label="Toast 弹窗"
                enabled={rules.toast}
                onChange={() => toggleRule('toast')}
              />
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {visible.length === 0 && (
              <div className="py-16 text-center text-zinc-400 text-sm flex flex-col items-center gap-2">
                <CheckCheck className="h-8 w-8 text-emerald-400" />
                <div>暂无告警</div>
                <div className="text-xs text-zinc-300">所有告警已忽略或处理</div>
              </div>
            )}
            {visible.map(a => {
              const isRealtime = '_realtime' in a && a._realtime
              const isNew = isRealtime && isNewAlert(a.id)
              const isUnread = !readIds.has(a.id)
              const category = getAlertCategory(a as Alert & { _realtime?: boolean; _rtType?: string })
              const catConfig = ALERT_CATEGORIES[category] || ALERT_CATEGORIES.default

              return (
                <div
                  key={a.id}
                  className={`p-3 rounded-md border text-xs transition-all hover:shadow-sm ${catConfig.borderClass} ${catConfig.bgClass} ${isNew ? 'animate-flash' : ''} ${isUnread ? 'ring-1 ring-inset ring-zinc-300/50 dark:ring-zinc-600/50' : ''}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={catConfig.color}>{catConfig.icon}</span>
                    <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300 truncate">{a.table}</span>
                    {isUnread && (
                      <span className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" title="未读" />
                    )}
                    {isRealtime && (
                      <Badge variant="outline" className="text-[9px] py-0 px-1.5 uppercase tracking-wide text-sky-600 border-sky-300 dark:border-sky-700">
                        实时
                      </Badge>
                    )}
                    <Badge variant="outline" className={`ml-auto text-[9px] py-0 px-1.5 uppercase tracking-wide ${catConfig.badgeClass}`}>
                      {catConfig.label}
                    </Badge>
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
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-white/60 dark:hover:bg-zinc-800/60 ${catConfig.textClass}`}
                    >
                      查看详情 <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>

        <div className="border-t px-3 py-2 flex items-center justify-between text-[11px] text-zinc-400 bg-zinc-50/50 dark:bg-zinc-900/40">
          <span className="flex items-center gap-1"><Filter className="h-3 w-3" />{dismissed.size > 0 ? `${dismissed.size} 条已忽略` : '实时推送模拟中'}</span>
          <div className="flex items-center gap-2">
            {dismissed.size > 0 && (
              <button
                onClick={() => setDismissed(new Set())}
                className="text-sky-600 hover:underline flex items-center gap-1"
              >
                <Trash2 className="h-3 w-3" />恢复已忽略
              </button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// Rule toggle component
function RuleToggle({ icon, label, enabled, onChange }: {
  icon: React.ReactNode
  label: string
  enabled: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="flex items-center gap-1 text-zinc-600 dark:text-zinc-400">
        {icon} {label}
      </span>
      <Switch checked={enabled} onCheckedChange={onChange} className="scale-75 origin-left" />
    </div>
  )
}
