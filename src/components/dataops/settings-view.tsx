'use client'
import { useState, useMemo, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Database, Settings, Bell, HardDrive, Clock, Webhook, Save, RotateCcw, Shield, Sliders, AlertTriangle, CheckCircle2, Cloud, FileDown, KeyRound, Activity, Zap, Calendar, Mail, MessageSquare } from 'lucide-react'
import { LINT_RULES } from '@/lib/dataops/mock-data'
import { toast } from 'sonner'

// 默认配置
interface SettingsState {
  // 通用
  dbPath: string
  backupDir: string
  duckdbVersion: string
  dbFileSize: string
  // 调度
  dailyTime: string
  timezone: string
  tradingCalendar: boolean
  autoRetry: boolean
  retryMax: number
  retryBackoff: number
  healthFixAuto: boolean
  notifyOnComplete: boolean
  // 通知
  notifyRed: boolean
  notifyDailySummary: boolean
  notifyWeeklyReport: boolean
  notifyChannels: string[]
  emailRecipient: string
  webhookUrl: string
  // 备份保留
  backupRetentionDays: number
  autoBackup: boolean
  // Lint 规则开关 + 级别覆盖
  lintRuleEnabled: Record<string, boolean>
  lintRuleLevel: Record<string, 'RED' | 'YELLOW' | 'BLUE'>
  // 高级
  logLevel: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
  parallelWorkers: number
  queryTimeoutSec: number
  cacheEnabled: boolean
  experimentalFeatures: boolean
}

const DEFAULT_STATE: SettingsState = {
  dbPath: 'K:\\DB数据库_v2\\db\\profit_radar.duckdb',
  backupDir: 'K:\\DB数据库_v2\\archive',
  duckdbVersion: 'v0.10',
  dbFileSize: '1.2 GB',
  dailyTime: '17:00',
  timezone: 'Asia/Shanghai',
  tradingCalendar: true,
  autoRetry: true,
  retryMax: 3,
  retryBackoff: 30,
  healthFixAuto: false,
  notifyOnComplete: true,
  notifyRed: true,
  notifyDailySummary: true,
  notifyWeeklyReport: false,
  notifyChannels: ['im'],
  emailRecipient: 'dataops@example.com',
  webhookUrl: '',
  backupRetentionDays: 30,
  autoBackup: true,
  lintRuleEnabled: Object.fromEntries(LINT_RULES.map(r => [r.id, true])),
  lintRuleLevel: Object.fromEntries(LINT_RULES.map(r => [r.id, r.level])),
  logLevel: 'INFO',
  parallelWorkers: 4,
  queryTimeoutSec: 300,
  cacheEnabled: true,
  experimentalFeatures: false,
}

// 深比较两个 state 是否一致
function isDirty(a: SettingsState, b: SettingsState): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

export function SettingsView() {
  const [state, setState] = useState<SettingsState>(DEFAULT_STATE)
  const [savedState, setSavedState] = useState<SettingsState>(DEFAULT_STATE)
  const [activeTab, setActiveTab] = useState('general')
  const dirty = isDirty(state, savedState)

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setState(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    setSavedState(state)
    toast.success('配置已保存', {
      description: `写入 config/registry/*.yaml · ${dirtyCount} 处变更`,
    })
  }

  const handleReset = () => {
    setState(savedState)
    toast.info('已重置为上次保存的配置')
  }

  const handleResetDefault = () => {
    setState(DEFAULT_STATE)
    toast.warning('已恢复出厂默认配置（未保存）')
  }

  // 统计变更数
  const dirtyCount = useMemo(() => {
    let count = 0
    for (const k of Object.keys(state) as (keyof SettingsState)[]) {
      if (JSON.stringify(state[k]) !== JSON.stringify(savedState[k])) count++
    }
    return count
  }, [state, savedState])

  // 键盘快捷键 Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (dirty) handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [dirty, state])

  // Lint 规则统计
  const lintStats = useMemo(() => {
    const enabled = Object.values(state.lintRuleEnabled).filter(Boolean).length
    const redCount = Object.entries(state.lintRuleLevel).filter(([id, lvl]) => state.lintRuleEnabled[id] && lvl === 'RED').length
    const yellowCount = Object.entries(state.lintRuleLevel).filter(([id, lvl]) => state.lintRuleEnabled[id] && lvl === 'YELLOW').length
    const blueCount = Object.entries(state.lintRuleLevel).filter(([id, lvl]) => state.lintRuleEnabled[id] && lvl === 'BLUE').length
    return { enabled, total: LINT_RULES.length, redCount, yellowCount, blueCount, disabled: LINT_RULES.length - enabled }
  }, [state.lintRuleEnabled, state.lintRuleLevel])

  return (
    <div className="space-y-4 max-w-5xl">
      {/* 顶部操作栏 */}
      <Card className={dirty ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10' : ''}>
        <CardContent className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                <Settings className="h-4 w-4 text-zinc-500" />
              </div>
              <div>
                <div className="text-sm font-medium flex items-center gap-2">
                  全局配置
                  {dirty ? (
                    <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 text-[10px] animate-pulse">
                      <AlertTriangle className="h-3 w-3 mr-0.5" />未保存 · {dirtyCount} 处变更
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-0.5" />已同步
                    </Badge>
                  )}
                </div>
                <div className="text-[10px] text-zinc-400">config/registry/*.yaml · Ctrl+S 保存</div>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleResetDefault} disabled={JSON.stringify(state) === JSON.stringify(DEFAULT_STATE)}>
                <RotateCcw className="h-3 w-3 mr-1" />恢复默认
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleReset} disabled={!dirty}>
                <RotateCcw className="h-3 w-3 mr-1" />重置
              </Button>
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleSave} disabled={!dirty}>
                <Save className="h-3 w-3 mr-1" />保存 ({dirtyCount})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid grid-cols-7 w-full h-9">
          <TabsTrigger value="general" className="text-xs gap-1"><Database className="h-3 w-3" />通用</TabsTrigger>
          <TabsTrigger value="lint" className="text-xs gap-1"><Shield className="h-3 w-3" />Lint<span className="text-[10px] text-zinc-400">{lintStats.enabled}/{lintStats.total}</span></TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs gap-1"><Clock className="h-3 w-3" />调度</TabsTrigger>
          <TabsTrigger value="notify" className="text-xs gap-1"><Bell className="h-3 w-3" />通知</TabsTrigger>
          <TabsTrigger value="source" className="text-xs gap-1"><HardDrive className="h-3 w-3" />数据源</TabsTrigger>
          <TabsTrigger value="integrate" className="text-xs gap-1"><Webhook className="h-3 w-3" />集成</TabsTrigger>
          <TabsTrigger value="advanced" className="text-xs gap-1"><Sliders className="h-3 w-3" />高级</TabsTrigger>
        </TabsList>

        {/* 通用 Tab */}
        <TabsContent value="general" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4 text-sky-500" />数据库连接</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">DB 路径</Label>
                  <Input value={state.dbPath} onChange={e => update('dbPath', e.target.value)} className="font-mono text-xs mt-1" />
                </div>
                <div>
                  <Label className="text-xs">备份目录</Label>
                  <Input value={state.backupDir} onChange={e => update('backupDir', e.target.value)} className="font-mono text-xs mt-1" />
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-emerald-600 border-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse" />已连接
                </Badge>
                <span className="text-xs text-zinc-500">DuckDB {state.duckdbVersion} · 文件大小 {state.dbFileSize}</span>
                <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={() => toast.success('连接测试成功', { description: '延迟 12ms · DuckDB 0.10.2' })}>
                  <Activity className="h-3 w-3 mr-1" />测试连接
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toast.success('已触发立即备份', { description: `备份至 ${state.backupDir}\\profit_radar_20260625.duckdb` })}>
                  <Cloud className="h-3 w-3 mr-1" />立即备份
                </Button>
              </div>
              <div className="p-2.5 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">DB_PATH 在 49 个脚本里硬编码</div>
                  <div className="mt-0.5">治理方案：统一到 <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 rounded">common/config.py</code>，此处改一处全局生效。</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Cloud className="h-4 w-4 text-fuchsia-500" />备份与保留</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ToggleRow
                label="自动备份"
                desc="每次 daily 执行完后自动备份 DB 文件"
                checked={state.autoBackup}
                onChange={v => update('autoBackup', v)}
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">备份保留天数</Label>
                  <Badge variant="outline" className="font-mono text-xs">{state.backupRetentionDays} 天</Badge>
                </div>
                <Slider
                  value={[state.backupRetentionDays]}
                  min={7}
                  max={180}
                  step={1}
                  onValueChange={v => update('backupRetentionDays', v[0])}
                />
                <div className="flex justify-between text-[10px] text-zinc-400">
                  <span>7 天</span><span>30 天</span><span>90 天</span><span>180 天</span>
                </div>
                <div className="text-[11px] text-zinc-500">
                  当前策略：保留近 {state.backupRetentionDays} 天的 DB 备份 · 预计占用磁盘 ~{(state.backupRetentionDays * 1.2).toFixed(1)} GB
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Lint Tab */}
        <TabsContent value="lint" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Shield className="h-4 w-4 text-emerald-500" />Lint 规则配置
                <Badge variant="secondary" className="text-xs ml-1">{lintStats.enabled}/{lintStats.total} 启用</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-2 mb-4">
                <LevelStat label="RED" count={lintStats.redCount} color="rose" desc="阻断级" />
                <LevelStat label="YELLOW" count={lintStats.yellowCount} color="amber" desc="警告级" />
                <LevelStat label="BLUE" count={lintStats.blueCount} color="sky" desc="建议级" />
                <LevelStat label="禁用" count={lintStats.disabled} color="zinc" desc="已关闭" />
              </div>
              <div className="space-y-1">
                <div className="grid grid-cols-[60px_1fr_110px_60px_50px] gap-2 px-2 py-1.5 text-[10px] font-medium text-zinc-500 bg-zinc-50 dark:bg-zinc-900/50 rounded">
                  <div>ID</div><div>规则</div><div>级别</div><div className="text-center">违规</div><div className="text-center">启用</div>
                </div>
                {LINT_RULES.map(rule => {
                  const enabled = state.lintRuleEnabled[rule.id]
                  const level = state.lintRuleLevel[rule.id]
                  const violationCount = rule.violations.length
                  return (
                    <div key={rule.id} className={`grid grid-cols-[60px_1fr_110px_60px_50px] gap-2 px-2 py-1.5 text-xs items-center rounded border ${enabled ? 'bg-card' : 'bg-zinc-50/50 dark:bg-zinc-900/30 opacity-60'}`}>
                      <div className="font-mono text-zinc-500">{rule.id}</div>
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-1.5">
                          {rule.name}
                          {violationCount > 0 && <Badge variant="outline" className="text-[9px] py-0 px-1 text-rose-600 border-rose-300">{violationCount}</Badge>}
                        </div>
                        <div className="text-[10px] text-zinc-500 truncate">{rule.description}</div>
                      </div>
                      <Select
                        value={level}
                        onValueChange={v => update('lintRuleLevel', { ...state.lintRuleLevel, [rule.id]: v as 'RED' | 'YELLOW' | 'BLUE' })}
                        disabled={!enabled}
                      >
                        <SelectTrigger className="h-7 text-[11px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="RED" className="text-rose-600 text-xs">RED 阻断</SelectItem>
                          <SelectItem value="YELLOW" className="text-amber-600 text-xs">YELLOW 警告</SelectItem>
                          <SelectItem value="BLUE" className="text-sky-600 text-xs">BLUE 建议</SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-center font-mono text-zinc-500">{violationCount}</div>
                      <div className="flex justify-center">
                        <Switch
                          checked={enabled}
                          onCheckedChange={v => update('lintRuleEnabled', { ...state.lintRuleEnabled, [rule.id]: v })}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 p-2.5 rounded-md bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-700 dark:text-sky-300 flex items-start gap-2">
                <Shield className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">规则级别覆盖</div>
                  <div className="mt-0.5">RED 级别规则在 pre-commit 阻断提交；YELLOW 进入周报；BLUE 仅记录。修改级别会立即影响下次 lint 执行。</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 调度 Tab */}
        <TabsContent value="schedule" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-fuchsia-500" />调度配置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" />每日盘后执行时间</Label>
                  <Input value={state.dailyTime} onChange={e => update('dailyTime', e.target.value)} className="font-mono text-xs mt-1" placeholder="17:00" />
                </div>
                <div>
                  <Label className="text-xs">时区</Label>
                  <Select value={state.timezone} onValueChange={v => update('timezone', v)}>
                    <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Shanghai">Asia/Shanghai (UTC+8)</SelectItem>
                      <SelectItem value="Asia/Hong_Kong">Asia/Hong_Kong (UTC+8)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                      <SelectItem value="America/New_York">America/New_York (UTC-5)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="p-3 rounded-md border bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="text-xs font-medium mb-2 flex items-center gap-1.5"><Zap className="h-3 w-3 text-amber-500" />Cron 表达式预览</div>
                <div className="font-mono text-sm text-fuchsia-600 dark:text-fuchsia-400">
                  {`${state.dailyTime.split(':')[1] || '00'} ${state.dailyTime.split(':')[0] || '17'} * * ${state.tradingCalendar ? '1-5' : '*'}`}
                </div>
                <div className="text-[11px] text-zinc-500 mt-1">
                  {state.tradingCalendar ? '仅周一至周五（交易日）执行' : '每天执行（含周末）'}
                </div>
              </div>

              <div className="space-y-2">
                <ToggleRow label="交易日历判定" desc="仅交易日执行 daily 层" checked={state.tradingCalendar} onChange={v => update('tradingCalendar', v)} />
                <ToggleRow label="失败自动重试" desc={`按配置重试（当前 ${state.retryMax} 次 / 间隔 ${state.retryBackoff}s）`} checked={state.autoRetry} onChange={v => update('autoRetry', v)} />
                {state.autoRetry && (
                  <div className="pl-3 py-2 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">最大重试次数</Label>
                          <Badge variant="outline" className="font-mono text-[10px]">{state.retryMax} 次</Badge>
                        </div>
                        <Slider value={[state.retryMax]} min={0} max={10} step={1} onValueChange={v => update('retryMax', v[0])} className="mt-2" />
                      </div>
                      <div>
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">退避间隔</Label>
                          <Badge variant="outline" className="font-mono text-[10px]">{state.retryBackoff}s</Badge>
                        </div>
                        <Slider value={[state.retryBackoff]} min={5} max={300} step={5} onValueChange={v => update('retryBackoff', v[0])} className="mt-2" />
                      </div>
                    </div>
                  </div>
                )}
                <ToggleRow label="health-fix 自动补数" desc="标红表自动 force 重跑（大表需确认）" checked={state.healthFixAuto} onChange={v => update('healthFixAuto', v)} />
                <ToggleRow label="执行完发通知" desc="success/failed 推送 IM" checked={state.notifyOnComplete} onChange={v => update('notifyOnComplete', v)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 通知 Tab */}
        <TabsContent value="notify" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" />告警通知</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ToggleRow label="RED 告警" desc="阻断级违规立即推送" checked={state.notifyRed} onChange={v => update('notifyRed', v)} />
              <ToggleRow label="每日执行汇总" desc="每天 19:00 推送当日执行结果" checked={state.notifyDailySummary} onChange={v => update('notifyDailySummary', v)} />
              <ToggleRow label="健康度周报" desc="每周一 9:00 推送健康度摘要" checked={state.notifyWeeklyReport} onChange={v => update('notifyWeeklyReport', v)} />

              <div className="pt-2 border-t">
                <div className="text-xs font-medium mb-2 flex items-center gap-1.5"><MessageSquare className="h-3 w-3" />通知渠道</div>
                <div className="grid grid-cols-3 gap-2">
                  <ChannelCard icon="im" label="IM 即时" desc="企业 IM 机器人" active={state.notifyChannels.includes('im')} onClick={() => toggleChannel('im')} />
                  <ChannelCard icon="email" label="邮件" desc="SMTP 发送" active={state.notifyChannels.includes('email')} onClick={() => toggleChannel('email')} />
                  <ChannelCard icon="webhook" label="Webhook" desc="自定义回调" active={state.notifyChannels.includes('webhook')} onClick={() => toggleChannel('webhook')} />
                </div>
              </div>

              {state.notifyChannels.includes('email') && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><Mail className="h-3 w-3" />邮件收件人</Label>
                  <Input value={state.emailRecipient} onChange={e => update('emailRecipient', e.target.value)} className="text-xs mt-1" placeholder="dataops@example.com" />
                </div>
              )}
              {state.notifyChannels.includes('webhook') && (
                <div>
                  <Label className="text-xs flex items-center gap-1"><Webhook className="h-3 w-3" />Webhook URL</Label>
                  <Input value={state.webhookUrl} onChange={e => update('webhookUrl', e.target.value)} className="font-mono text-xs mt-1" placeholder="https://..." />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 数据源 Tab */}
        <TabsContent value="source" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4 text-emerald-500" />外部数据源</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <SourceRow name="tqcenter (TQ API)" path="K:\txdlianghua\PYPlugins\sys" status="ok" detail="Python 库 · 17 个 API" latency="12ms" />
                <SourceRow name="TDX vipdoc (二进制K线)" path="K:\txdlianghua\vipdoc" status="ok" detail=".day/.lc5/.lc1 文件 · ~3.2GB" latency="2ms" />
                <SourceRow name="TDX T0002 (信号文件)" path="K:\txdlianghua\T0002" status="ok" detail="gpsz*.dat 信号" latency="3ms" />
                <SourceRow name="通达信说明书 (文档)" path="docs/" status="ok" detail="28 篇文档" latency="—" />
              </div>
              <div className="mt-3 p-2.5 rounded-md bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>所有数据源可达 · 上次巡检 2026-06-25 17:00:00</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 集成 Tab */}
        <TabsContent value="integrate" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Webhook className="h-4 w-4 text-sky-500" />集成与自动化</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <IntegrationRow icon="git" name="git pre-commit hook" desc="提交前自动跑 lint engine" status="enabled" />
              <IntegrationRow icon="ci" name="CI 校验" desc="PR 必须 lint 全绿才能合并" status="pending" />
              <IntegrationRow icon="ws" name="实时日志推送" desc="WebSocket 推送执行日志到 UI" status="enabled" />
              <IntegrationRow icon="api" name="REST API" desc="对外暴露 /api/v1/tables, /api/v1/runs" status="planned" />
              <IntegrationRow icon="schedule" name="外部调度集成" desc="Airflow / Cronus webhook 触发" status="planned" />
            </CardContent>
          </Card>
        </TabsContent>

        {/* 高级 Tab */}
        <TabsContent value="advanced" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Sliders className="h-4 w-4 text-zinc-500" />高级参数</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label className="text-xs">日志级别</Label>
                <Select value={state.logLevel} onValueChange={v => update('logLevel', v as SettingsState['logLevel'])}>
                  <SelectTrigger className="text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DEBUG" className="text-xs">DEBUG (调试，最详细)</SelectItem>
                    <SelectItem value="INFO" className="text-xs">INFO (默认)</SelectItem>
                    <SelectItem value="WARNING" className="text-xs">WARNING (仅警告+错误)</SelectItem>
                    <SelectItem value="ERROR" className="text-xs">ERROR (仅错误)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">并行 worker 数</Label>
                  <Badge variant="outline" className="font-mono text-[10px]">{state.parallelWorkers}</Badge>
                </div>
                <Slider value={[state.parallelWorkers]} min={1} max={16} step={1} onValueChange={v => update('parallelWorkers', v[0])} className="mt-2" />
                <div className="text-[11px] text-zinc-500 mt-1">同时执行的脚本数（建议 ≤ CPU 核数）</div>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-xs">查询超时（秒）</Label>
                  <Badge variant="outline" className="font-mono text-[10px]">{state.queryTimeoutSec}s</Badge>
                </div>
                <Slider value={[state.queryTimeoutSec]} min={30} max={3600} step={30} onValueChange={v => update('queryTimeoutSec', v[0])} className="mt-2" />
              </div>

              <ToggleRow label="查询缓存" desc="对 SELECT 结果缓存 5 分钟" checked={state.cacheEnabled} onChange={v => update('cacheEnabled', v)} />
              <ToggleRow label="实验性功能" desc="启用未稳定的功能（SQL Playground 多 Tab、血缘拖拽等）" checked={state.experimentalFeatures} onChange={v => update('experimentalFeatures', v)} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4 text-amber-500" />密钥管理</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <KeyRow name="TQ API Token" status="set" />
              <KeyRow name="SMTP 密码" status="unset" />
              <KeyRow name="Webhook Secret" status="unset" />
            </CardContent>
          </Card>

          <Card className="border-rose-200 dark:border-rose-900">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-rose-600 dark:text-rose-400"><AlertTriangle className="h-4 w-4" />危险区</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-md border border-rose-200 dark:border-rose-900">
                <div>
                  <div className="text-sm font-medium">清空所有缓存</div>
                  <div className="text-xs text-zinc-500">清除 SQL 查询缓存和临时表</div>
                </div>
                <Button variant="outline" size="sm" className="text-rose-600 border-rose-300 hover:bg-rose-50 h-7 text-xs" onClick={() => toast.success('缓存已清空')}>
                  <FileDown className="h-3 w-3 mr-1" />清空
                </Button>
              </div>
              <div className="flex items-center justify-between p-2 rounded-md border border-rose-200 dark:border-rose-900">
                <div>
                  <div className="text-sm font-medium">重置所有配置</div>
                  <div className="text-xs text-zinc-500">恢复出厂默认配置（不可恢复）</div>
                </div>
                <Button variant="outline" size="sm" className="text-rose-600 border-rose-300 hover:bg-rose-50 h-7 text-xs" onClick={handleResetDefault}>
                  <RotateCcw className="h-3 w-3 mr-1" />重置
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-500 flex items-center gap-2">
        <Settings className="h-4 w-4" />
        本页所有配置对应 <code className="font-mono text-sky-600">config/registry/</code> 下的 YAML 文件，UI 改动会写回 YAML（本原型为只读演示）。
      </div>
    </div>
  )

  function toggleChannel(ch: string) {
    const cur = state.notifyChannels
    update('notifyChannels', cur.includes(ch) ? cur.filter(c => c !== ch) : [...cur, ch])
  }
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-md border">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-zinc-500">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  )
}

function LevelStat({ label, count, color, desc }: { label: string; count: number; color: 'rose' | 'amber' | 'sky' | 'zinc'; desc: string }) {
  const colorMap = {
    rose: 'border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300',
    amber: 'border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300',
    sky: 'border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300',
    zinc: 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/30 text-zinc-700 dark:text-zinc-300',
  }
  return (
    <div className={`p-2.5 rounded-md border ${colorMap[color]}`}>
      <div className="text-2xl font-bold font-mono leading-none">{count}</div>
      <div className="text-[11px] font-medium mt-1">{label}</div>
      <div className="text-[10px] opacity-70">{desc}</div>
    </div>
  )
}

function ChannelCard({ icon, label, desc, active, onClick }: { icon: string; label: string; desc: string; active: boolean; onClick: () => void }) {
  const iconMap: Record<string, React.ReactNode> = {
    im: <MessageSquare className="h-4 w-4" />,
    email: <Mail className="h-4 w-4" />,
    webhook: <Webhook className="h-4 w-4" />,
  }
  return (
    <button
      onClick={onClick}
      className={`p-2.5 rounded-md border text-left transition-all ${active ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30' : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'}`}
    >
      <div className={`flex items-center gap-1.5 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}`}>
        {iconMap[icon]}
        <span className="text-xs font-medium">{label}</span>
        {active && <CheckCircle2 className="h-3 w-3 ml-auto" />}
      </div>
      <div className="text-[10px] text-zinc-500 mt-1">{desc}</div>
    </button>
  )
}

function SourceRow({ name, path, status, detail, latency }: { name: string; path: string; status: 'ok' | 'err'; detail: string; latency: string }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium flex items-center gap-2">
          {name}
          {status === 'ok' && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />}
        </div>
        <div className="text-xs text-zinc-500 font-mono truncate">{path}</div>
        <div className="text-[10px] text-zinc-400 mt-0.5">{detail}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 font-mono">{latency}</span>
        <Badge variant="outline" className={status === 'ok' ? 'text-emerald-600 border-emerald-300 text-[10px]' : 'text-rose-600 border-rose-300 text-[10px]'}>
          {status === 'ok' ? '可用' : '不可达'}
        </Badge>
      </div>
    </div>
  )
}

function IntegrationRow({ icon, name, desc, status }: { icon: string; name: string; desc: string; status: 'enabled' | 'pending' | 'planned' }) {
  const statusMap = {
    enabled: { label: '已启用', cls: 'text-emerald-600 border-emerald-300', dot: 'bg-emerald-500' },
    pending: { label: '待配置', cls: 'text-amber-600 border-amber-300', dot: 'bg-amber-500' },
    planned: { label: 'P2 规划', cls: 'text-zinc-500 border-zinc-300', dot: 'bg-zinc-400' },
  }
  const s = statusMap[status]
  const iconMap: Record<string, React.ReactNode> = {
    git: <KeyRound className="h-4 w-4" />,
    ci: <CheckCircle2 className="h-4 w-4" />,
    ws: <Activity className="h-4 w-4" />,
    api: <Webhook className="h-4 w-4" />,
    schedule: <Calendar className="h-4 w-4" />,
  }
  return (
    <div className="flex items-center justify-between p-2.5 rounded-md border hover:bg-zinc-50 dark:hover:bg-zinc-900/40 transition-colors">
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{iconMap[icon]}</div>
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-xs text-zinc-500">{desc}</div>
        </div>
      </div>
      <Badge variant="outline" className={`text-[10px] ${s.cls}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${s.dot} mr-1`} />{s.label}
      </Badge>
    </div>
  )
}

function KeyRow({ name, status }: { name: string; status: 'set' | 'unset' }) {
  return (
    <div className="flex items-center justify-between p-2.5 rounded-md border">
      <div className="flex items-center gap-2">
        <KeyRound className={`h-4 w-4 ${status === 'set' ? 'text-emerald-500' : 'text-zinc-400'}`} />
        <div>
          <div className="text-sm font-medium">{name}</div>
          <div className="text-[10px] text-zinc-500">{status === 'set' ? '••••••••（已设置）' : '未设置'}</div>
        </div>
      </div>
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => toast[status === 'set' ? 'info' : 'success'](status === 'set' ? `${name} 已重置` : `${name} 已设置`)}>
        {status === 'set' ? '重置' : '设置'}
      </Button>
    </div>
  )
}
