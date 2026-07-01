'use client'
import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Database, Settings, Bell, HardDrive, Clock, Webhook, Save, RotateCcw, Shield, Sliders, AlertTriangle, CheckCircle2, Cloud, FileDown, KeyRound, Activity, Zap, Calendar, Mail, MessageSquare, FileUp, FileCode2, ClipboardCopy, Globe, Github, RefreshCw, Upload, Loader2, XCircle, AlertCircle, Plus, Trash2, Pencil, Copy, Download, FileUp as ImportIcon, Search, Filter, Table2, Link2, ChevronDown } from 'lucide-react'
import { LINT_RULES, TABLES } from '@/lib/dataops/mock-data'
import { REAL_TABLE_CONFIGS } from '@/lib/dataops/real-data'
import { APP_CONFIG } from '@/lib/dataops/config'
import { toast } from 'sonner'
import { useGitHubSync, type SyncStatus } from '@/hooks/use-github-sync'
import { Checkbox } from '@/components/ui/checkbox'
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table'

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
  dbPath: APP_CONFIG.dbPath,
  backupDir: APP_CONFIG.backupDir,
  duckdbVersion: 'v0.10',
  dbFileSize: '--',
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

// ── Profile system ─────────────────────────────────────────────
type ProfileColor = 'emerald' | 'amber' | 'rose' | 'sky' | 'violet' | 'zinc'

interface Profile {
  id: string
  name: string
  color: ProfileColor
  state: SettingsState
}

const PROFILE_COLORS: { value: ProfileColor; label: string; dot: string; bg: string; text: string }[] = [
  { value: 'emerald', label: '开发', dot: 'bg-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700', text: 'text-emerald-700 dark:text-emerald-300' },
  { value: 'amber', label: '测试', dot: 'bg-amber-500', bg: 'bg-amber-100 dark:bg-amber-950/50 border-amber-300 dark:border-amber-700', text: 'text-amber-700 dark:text-amber-300' },
  { value: 'rose', label: '生产', dot: 'bg-rose-500', bg: 'bg-rose-100 dark:bg-rose-950/50 border-rose-300 dark:border-rose-700', text: 'text-rose-700 dark:text-rose-300' },
  { value: 'sky', label: '预发布', dot: 'bg-sky-500', bg: 'bg-sky-100 dark:bg-sky-950/50 border-sky-300 dark:border-sky-700', text: 'text-sky-700 dark:text-sky-300' },
  { value: 'violet', label: '自定义', dot: 'bg-violet-500', bg: 'bg-violet-100 dark:bg-violet-950/50 border-violet-300 dark:border-violet-700', text: 'text-violet-700 dark:text-violet-300' },
  { value: 'zinc', label: '其他', dot: 'bg-zinc-400', bg: 'bg-zinc-100 dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600', text: 'text-zinc-700 dark:text-zinc-300' },
]

const PROFILES_STORAGE_KEY = 'dataops:profiles'
const ACTIVE_PROFILE_KEY = 'dataops:active-profile'

function getDefaultProfiles(): Profile[] {
  return [
    { id: 'dev', name: '开发', color: 'emerald', state: { ...DEFAULT_STATE } },
    { id: 'staging', name: '测试', color: 'amber', state: { ...DEFAULT_STATE, dailyTime: '18:00', autoRetry: false } },
    { id: 'prod', name: '生产', color: 'rose', state: { ...DEFAULT_STATE, dailyTime: '17:30', autoRetry: true, retryMax: 5, logLevel: 'WARNING' } },
  ]
}

function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY)
    if (!raw) return getDefaultProfiles()
    return JSON.parse(raw) as Profile[]
  } catch {
    return getDefaultProfiles()
  }
}

function saveProfiles(profiles: Profile[]): void {
  try {
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(profiles))
  } catch {
    // silently fail
  }
}

function loadActiveProfileId(): string {
  try {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || 'dev'
  } catch {
    return 'dev'
  }
}

function saveActiveProfileId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROFILE_KEY, id)
  } catch {
    // silently fail
  }
}

function getProfileColorConfig(color: ProfileColor) {
  return PROFILE_COLORS.find(c => c.value === color) ?? PROFILE_COLORS[5]
}

function generateId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function SettingsView() {
  // GitHub sync hook
  const githubSync = useGitHubSync()
  const [pushCommitMsg, setPushCommitMsg] = useState('')

  // Profile system
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles())
  const [activeProfileId, setActiveProfileId] = useState<string>(() => loadActiveProfileId())
  const [showProfileDialog, setShowProfileDialog] = useState(false)
  const [profileDialogMode, setProfileDialogMode] = useState<'add' | 'rename'>('add')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileColor, setNewProfileColor] = useState<ProfileColor>('sky')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null)
  const [showProfileImportExport, setShowProfileImportExport] = useState(false)
  const [profileImportText, setProfileImportText] = useState('')
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false)
  const [pendingSwitchId, setPendingSwitchId] = useState<string | null>(null)

  // Current active profile
  const activeProfile = useMemo(() => {
    return profiles.find(p => p.id === activeProfileId) ?? profiles[0] ?? getDefaultProfiles()[0]
  }, [profiles, activeProfileId])

  const activeColorConfig = useMemo(() => getProfileColorConfig(activeProfile.color), [activeProfile.color])

  // Initialize state from active profile
  const [state, setState] = useState<SettingsState>(() => activeProfile.state)
  const [savedState, setSavedState] = useState<SettingsState>(() => activeProfile.state)
  const [activeTab, setActiveTab] = useState('general')
  const dirty = isDirty(state, savedState)

  // 连接测试状态
  const [connectionTesting, setConnectionTesting] = useState(false)

  // 挂载时加载真实 DuckDB 版本与文件大小 (op=dbinfo)
  useEffect(() => {
    let cancelled = false
    fetch('/api/dataops?op=dbinfo')
      .then(async r => {
        if (!r.ok) return
        const data = await r.json()
        if (cancelled) return
        setState(prev => ({
          ...prev,
          duckdbVersion: data?.version ?? prev.duckdbVersion,
          dbFileSize: typeof data?.fileSizeBytes === 'number'
            ? `${(data.fileSizeBytes / 1e9).toFixed(1)}GB`
            : prev.dbFileSize,
        }))
      })
      .catch(() => { /* 静默: 失败时保留默认值 */ })
    return () => { cancelled = true }
  }, [])

  // 真实连接测试
  const handleTestConnection = async () => {
    setConnectionTesting(true)
    const t0 = Date.now()
    try {
      const res = await fetch('/api/dataops?op=dbinfo')
      const latency = Date.now() - t0
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (!data?.openOk) throw new Error('数据库未打开')
      const version = data.version ?? 'unknown'
      const gb = typeof data.fileSizeBytes === 'number' ? (data.fileSizeBytes / 1e9).toFixed(1) : '?'
      // 同步刷新状态里的版本/大小
      setState(prev => ({
        ...prev,
        duckdbVersion: version,
        dbFileSize: typeof data.fileSizeBytes === 'number' ? `${gb}GB` : prev.dbFileSize,
      }))
      toast.success('连接测试成功', {
        description: `延迟 ${latency}ms · DuckDB ${version} · ${gb}GB`,
      })
    } catch (e) {
      toast.error('连接测试失败', {
        description: e instanceof Error ? e.message : '无法连接数据库',
      })
    } finally {
      setConnectionTesting(false)
    }
  }

  // ── Config Management State ─────────────────────────────────
  type ConfigRow = {
    tableName: string
    cn: string
    schedule: string
    mode: string
    sort: number
    dir: string
    source: string
    depends_on: string[]
    status: string
  }

  // Build initial config from REAL_TABLE_CONFIGS
  const buildInitialConfig = (): ConfigRow[] =>
    Object.values(REAL_TABLE_CONFIGS).map(cfg => ({
      tableName: cfg.table,
      cn: cfg.cn,
      schedule: cfg.schedule,
      mode: cfg.mode,
      sort: cfg.sort,
      dir: cfg.dir,
      source: cfg.source,
      depends_on: [...cfg.dependsOn],
      status: cfg.isView ? 'view' : 'active',
    }))

  const [configData, setConfigData] = useState<ConfigRow[]>(() => buildInitialConfig())
  const [configSavedData, setConfigSavedData] = useState<ConfigRow[]>(() => buildInitialConfig())
  const [configSearch, setConfigSearch] = useState('')
  const [configScheduleFilter, setConfigScheduleFilter] = useState<string>('all')
  const [configDirFilter, setConfigDirFilter] = useState<string>('all')
  const [depDialogOpen, setDepDialogOpen] = useState(false)
  const [depDialogTable, setDepDialogTable] = useState<string | null>(null)
  const [depDialogSelected, setDepDialogSelected] = useState<string[]>([])
  const [configSaving, setConfigSaving] = useState(false)

  // Config diff tracking
  const configDirtyCount = useMemo(() => {
    let count = 0
    for (let i = 0; i < configData.length; i++) {
      const cur = configData[i]
      const saved = configSavedData[i]
      if (
        cur.schedule !== saved.schedule ||
        cur.mode !== saved.mode ||
        JSON.stringify(cur.depends_on) !== JSON.stringify(saved.depends_on)
      ) {
        count++
      }
    }
    return count
  }, [configData, configSavedData])

  const configIsDirty = configDirtyCount > 0

  // Config statistics
  const configStats = useMemo(() => {
    const total = configData.length
    const bySchedule: Record<string, number> = {}
    const byMode: Record<string, number> = {}
    let withDeps = 0
    for (const row of configData) {
      bySchedule[row.schedule] = (bySchedule[row.schedule] || 0) + 1
      byMode[row.mode] = (byMode[row.mode] || 0) + 1
      if (row.depends_on.length > 0) withDeps++
    }
    return { total, bySchedule, byMode, withDeps, unsaved: configDirtyCount }
  }, [configData, configDirtyCount])

  // Filtered config rows
  const filteredConfig = useMemo(() => {
    return configData.filter(row => {
      if (configSearch) {
        const q = configSearch.toLowerCase()
        if (!row.tableName.toLowerCase().includes(q) && !row.cn.toLowerCase().includes(q)) return false
      }
      if (configScheduleFilter !== 'all' && row.schedule !== configScheduleFilter) return false
      if (configDirFilter !== 'all' && row.dir !== configDirFilter) return false
      return true
    })
  }, [configData, configSearch, configScheduleFilter, configDirFilter])

  // Check if a specific row has unsaved changes
  const isRowDirty = (tableName: string): boolean => {
    const cur = configData.find(r => r.tableName === tableName)
    const saved = configSavedData.find(r => r.tableName === tableName)
    if (!cur || !saved) return false
    return cur.schedule !== saved.schedule || cur.mode !== saved.mode || JSON.stringify(cur.depends_on) !== JSON.stringify(saved.depends_on)
  }

  // Update a single config field
  const updateConfigField = (tableName: string, field: 'schedule' | 'mode', value: string) => {
    setConfigData(prev => prev.map(row => row.tableName === tableName ? { ...row, [field]: value } : row))
  }

  // Open dependency editor
  const openDepDialog = (tableName: string) => {
    const row = configData.find(r => r.tableName === tableName)
    if (!row) return
    setDepDialogTable(tableName)
    setDepDialogSelected([...row.depends_on])
    setDepDialogOpen(true)
  }

  // Save dependency changes
  const saveDepDialog = () => {
    if (!depDialogTable) return
    setConfigData(prev => prev.map(row => row.tableName === depDialogTable ? { ...row, depends_on: [...depDialogSelected] } : row))
    setDepDialogOpen(false)
    setDepDialogTable(null)
  }

  // Save all config changes
  const handleConfigSave = async () => {
    setConfigSaving(true)
    try {
      // Find dirty rows and send PUT for each
      const dirtyRows = configData.filter(row => isRowDirty(row.tableName))
      for (const row of dirtyRows) {
        const saved = configSavedData.find(r => r.tableName === row.tableName)
        const updates: { schedule?: string; mode?: string; depends_on?: string[] } = {}
        if (saved && row.schedule !== saved.schedule) updates.schedule = row.schedule
        if (saved && row.mode !== saved.mode) updates.mode = row.mode
        if (saved && JSON.stringify(row.depends_on) !== JSON.stringify(saved.depends_on)) updates.depends_on = row.depends_on
        await fetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tableName: row.tableName, updates }),
        })
      }
      setConfigSavedData(configData.map(r => ({ ...r, depends_on: [...r.depends_on] })))
      toast.success('配置已保存', { description: `${dirtyRows.length} 项变更已同步` })
    } catch {
      toast.error('保存失败', { description: '请稍后重试' })
    } finally {
      setConfigSaving(false)
    }
  }

  // Reset config changes
  const handleConfigReset = () => {
    setConfigData(configSavedData.map(r => ({ ...r, depends_on: [...r.depends_on] })))
    toast.info('已重置为上次保存的配置')
  }

  // Export config as JSON
  const handleConfigExport = async () => {
    try {
      const res = await fetch('/api/config', { method: 'POST' })
      const data = await res.json()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tables_config_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('配置已导出为 JSON')
    } catch {
      toast.error('导出失败')
    }
  }

  // Schedule badge color mapping
  const scheduleColorMap: Record<string, string> = {
    daily: 'bg-sky-100 text-sky-700 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-700',
    weekly: 'bg-violet-100 text-violet-700 border-violet-300 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-700',
    monthly: 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700',
    once: 'bg-zinc-100 text-zinc-600 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-600',
    intraday: 'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700',
  }

  // Sync state when active profile changes
  useEffect(() => {
    const profile = profiles.find(p => p.id === activeProfileId)
    if (profile) {
      setState(profile.state)
      setSavedState(profile.state)
    }
  }, [activeProfileId, profiles])

  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setState(prev => ({ ...prev, [key]: value }))
  }

  const handleSave = () => {
    if (activeProfile.color === 'rose' && activeProfile.name === '生产') {
      setShowProdSaveConfirm(true)
      return
    }
    doSave()
  }

  const doSave = useCallback(() => {
    setSavedState(state)
    // Update profile in profiles list
    setProfiles(prev => {
      const next = prev.map(p => p.id === activeProfileId ? { ...p, state } : p)
      saveProfiles(next)
      return next
    })
    toast.success('配置已保存', {
      description: `写入 config/registry/*.yaml · ${dirtyCount} 处变更 · 环境: ${activeProfile.name}`,
    })
  }, [state, activeProfileId, activeProfile.name])

  // Switch profile
  const handleProfileSwitch = useCallback((newId: string) => {
    if (newId === activeProfileId) return
    if (dirty) {
      setPendingSwitchId(newId)
      setShowSwitchConfirm(true)
    } else {
      switchToProfile(newId)
    }
  }, [activeProfileId, dirty])

  const switchToProfile = useCallback((newId: string) => {
    // Save current state to current profile first
    setProfiles(prev => {
      const next = prev.map(p => p.id === activeProfileId ? { ...p, state } : p)
      saveProfiles(next)
      return next
    })
    setActiveProfileId(newId)
    saveActiveProfileId(newId)
    const target = profiles.find(p => p.id === newId)
    toast.success(`已切换到 ${target?.name ?? newId} 环境`)
  }, [activeProfileId, state, profiles])

  const handleReset = () => {
    setState(savedState)
    toast.info('已重置为上次保存的配置')
  }

  const handleResetDefault = () => {
    setState(DEFAULT_STATE)
    toast.warning('已恢复出厂默认配置（未保存）')
  }

  // ── Profile management ─────────────────────────────────────
  const handleAddProfile = () => {
    setProfileDialogMode('add')
    setEditingProfileId(null)
    setNewProfileName('')
    setNewProfileColor('sky')
    setShowProfileDialog(true)
  }

  const handleRenameProfile = (id: string) => {
    const profile = profiles.find(p => p.id === id)
    if (!profile) return
    setProfileDialogMode('rename')
    setEditingProfileId(id)
    setNewProfileName(profile.name)
    setNewProfileColor(profile.color)
    setShowProfileDialog(true)
  }

  const handleProfileDialogConfirm = () => {
    if (!newProfileName.trim()) {
      toast.error('请输入 Profile 名称')
      return
    }

    if (profileDialogMode === 'add') {
      const newProfile: Profile = {
        id: generateId(),
        name: newProfileName.trim(),
        color: newProfileColor,
        state: { ...DEFAULT_STATE },
      }
      setProfiles(prev => {
        const next = [...prev, newProfile]
        saveProfiles(next)
        return next
      })
      toast.success(`已创建 Profile: ${newProfileName.trim()}`)
    } else if (profileDialogMode === 'rename' && editingProfileId) {
      setProfiles(prev => {
        const next = prev.map(p => p.id === editingProfileId ? { ...p, name: newProfileName.trim(), color: newProfileColor } : p)
        saveProfiles(next)
        return next
      })
      toast.success(`已重命名 Profile 为: ${newProfileName.trim()}`)
    }

    setShowProfileDialog(false)
    setNewProfileName('')
    setEditingProfileId(null)
  }

  const handleDeleteProfile = (id: string) => {
    if (profiles.length <= 1) {
      toast.error('至少保留一个 Profile')
      return
    }
    if (id === activeProfileId) {
      toast.error('不能删除当前活跃的 Profile')
      return
    }
    setProfiles(prev => {
      const next = prev.filter(p => p.id !== id)
      saveProfiles(next)
      return next
    })
    setShowDeleteConfirm(null)
    toast.success('已删除 Profile')
  }

  const handleCopyProfile = () => {
    const newProfile: Profile = {
      id: generateId(),
      name: `${activeProfile.name} (副本)`,
      color: 'sky',
      state: { ...state },
    }
    setProfiles(prev => {
      const next = [...prev, newProfile]
      saveProfiles(next)
      return next
    })
    toast.success(`已复制当前配置为: ${newProfile.name}`, {
      description: '可切换到新 Profile 进行编辑',
    })
  }

  // ── Profile import/export ──────────────────────────────────
  const handleExportProfiles = () => {
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: profiles,
      activeProfileId,
    }
    const json = JSON.stringify(exportData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dataops_profiles_${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('已导出 Profile 配置')
  }

  const handleImportProfiles = () => {
    try {
      const data = JSON.parse(profileImportText)
      if (!data.profiles || !Array.isArray(data.profiles)) {
        toast.error('导入失败', { description: '无效的 Profile 数据格式' })
        return
      }
      // Merge: add profiles that don't exist by name
      const existingNames = new Set(profiles.map(p => p.name))
      const newProfiles = data.profiles.filter((p: Profile) => !existingNames.has(p.name))
      if (newProfiles.length === 0) {
        toast.info('所有 Profile 已存在，无需导入')
        return
      }
      // Assign new IDs to avoid conflicts
      const imported = newProfiles.map((p: Profile) => ({
        ...p,
        id: generateId(),
      }))
      setProfiles(prev => {
        const next = [...prev, ...imported]
        saveProfiles(next)
        return next
      })
      setShowProfileImportExport(false)
      setProfileImportText('')
      toast.success(`已导入 ${imported.length} 个 Profile`)
    } catch {
      toast.error('导入失败', { description: 'JSON 格式错误' })
    }
  }

  // === YAML 导入/导出 ===
  const [yamlPreview, setYamlPreview] = useState<string>('')
  const [showYamlDialog, setShowYamlDialog] = useState(false)
  const [importText, setImportText] = useState('')
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showProdSaveConfirm, setShowProdSaveConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const profileFileRef = useRef<HTMLInputElement>(null)

  // 简易 YAML 序列化（不依赖外部库）
  const stateToYaml = (s: SettingsState): string => {
    const lines: string[] = []
    lines.push('# DataOps 管理台配置文件')
    lines.push('# 生成时间: ' + new Date().toISOString())
    lines.push('# 路径: config/registry/settings.yaml')
    lines.push('')
    lines.push('general:')
    lines.push(`  db_path: "${s.dbPath}"`)
    lines.push(`  backup_dir: "${s.backupDir}"`)
    lines.push(`  duckdb_version: "${s.duckdbVersion}"`)
    lines.push(`  db_file_size: "${s.dbFileSize}"`)
    lines.push('')
    lines.push('schedule:')
    lines.push(`  daily_time: "${s.dailyTime}"`)
    lines.push(`  timezone: "${s.timezone}"`)
    lines.push(`  trading_calendar: ${s.tradingCalendar}`)
    lines.push(`  auto_retry: ${s.autoRetry}`)
    lines.push(`  retry_max: ${s.retryMax}`)
    lines.push(`  retry_backoff_sec: ${s.retryBackoff}`)
    lines.push(`  health_fix_auto: ${s.healthFixAuto}`)
    lines.push(`  notify_on_complete: ${s.notifyOnComplete}`)
    lines.push('')
    lines.push('notification:')
    lines.push(`  notify_red: ${s.notifyRed}`)
    lines.push(`  notify_daily_summary: ${s.notifyDailySummary}`)
    lines.push(`  notify_weekly_report: ${s.notifyWeeklyReport}`)
    lines.push(`  channels: [${s.notifyChannels.map(c => c).join(', ')}]`)
    lines.push(`  email_recipient: "${s.emailRecipient}"`)
    lines.push(`  webhook_url: "${s.webhookUrl}"`)
    lines.push('')
    lines.push('backup:')
    lines.push(`  retention_days: ${s.backupRetentionDays}`)
    lines.push(`  auto_backup: ${s.autoBackup}`)
    lines.push('')
    lines.push('lint_rules:')
    LINT_RULES.forEach(r => {
      lines.push(`  ${r.id}:`)
      lines.push(`    enabled: ${s.lintRuleEnabled[r.id]}`)
      lines.push(`    level: ${s.lintRuleLevel[r.id]}`)
    })
    lines.push('')
    lines.push('advanced:')
    lines.push(`  log_level: ${s.logLevel}`)
    lines.push(`  parallel_workers: ${s.parallelWorkers}`)
    lines.push(`  query_timeout_sec: ${s.queryTimeoutSec}`)
    lines.push(`  cache_enabled: ${s.cacheEnabled}`)
    lines.push(`  experimental_features: ${s.experimentalFeatures}`)
    return lines.join('\n')
  }

  const handleExportYaml = () => {
    const yaml = stateToYaml(state)
    setYamlPreview(yaml)
    setShowYamlDialog(true)
  }

  const handleDownloadYaml = () => {
    const yaml = yamlPreview || stateToYaml(state)
    const blob = new Blob([yaml], { type: 'text/yaml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `dataops_settings_${new Date().toISOString().slice(0, 10)}.yaml`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('YAML 配置已下载')
  }

  const handleCopyYaml = async () => {
    try {
      await navigator.clipboard.writeText(yamlPreview)
      toast.success('YAML 已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }

  // 简易 YAML 解析（仅支持本项目生成的格式）
  const parseSimpleYaml = (text: string): Partial<SettingsState> | null => {
    try {
      const result: Record<string, unknown> = {}
      const lines = text.split('\n')
      let section = ''
      let inLintRules = false
      let currentLintId = ''
      for (const raw of lines) {
        const line = raw.replace(/\r$/, '')
        if (!line.trim() || line.trim().startsWith('#')) continue
        const secMatch = line.match(/^(\w+):$/)
        if (secMatch) {
          section = secMatch[1]
          inLintRules = section === 'lint_rules'
          if (inLintRules) result.lintRuleEnabled = result.lintRuleEnabled as Record<string, boolean> || {}
          if (inLintRules) result.lintRuleLevel = result.lintRuleLevel as Record<string, string> || {}
          continue
        }
        if (inLintRules) {
          const ruleMatch = line.match(/^  ([A-Z]\d+):$/)
          if (ruleMatch) { currentLintId = ruleMatch[1]; continue }
          if (currentLintId) {
            const enMatch = line.match(/^    enabled:\s*(\w+)/)
            if (enMatch) { (result.lintRuleEnabled as Record<string, boolean>)[currentLintId] = enMatch[1] === 'true'; continue }
            const lvlMatch = line.match(/^    level:\s*(\w+)/)
            if (lvlMatch) {
              const lvl = lvlMatch[1]
              if (lvl === 'RED' || lvl === 'YELLOW' || lvl === 'BLUE') {
                (result.lintRuleLevel as Record<string, 'RED' | 'YELLOW' | 'BLUE'>)[currentLintId] = lvl
              }
              continue
            }
          }
        }
        const kvMatch = line.match(/^  (\w+):\s*(.*)$/)
        if (kvMatch) {
          let [, k, v] = kvMatch
          v = v.trim()
          if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1)
          if (v === 'true') v = true as unknown as string
          else if (v === 'false') v = false as unknown as string
          else if (/^\d+$/.test(v)) v = parseInt(v, 10) as unknown as string
          else if (v.startsWith('[') && v.endsWith(']')) {
            v = v.slice(1, -1).split(',').map(x => x.trim()).filter(Boolean) as unknown as string
          }
          if (section === 'general') {
            if (k === 'db_path') result.dbPath = v as string
            else if (k === 'backup_dir') result.backupDir = v as string
            else if (k === 'duckdb_version') result.duckdbVersion = v as string
            else if (k === 'db_file_size') result.dbFileSize = v as string
          } else if (section === 'schedule') {
            if (k === 'daily_time') result.dailyTime = v as string
            else if (k === 'timezone') result.timezone = v as string
            else if (k === 'trading_calendar') result.tradingCalendar = v as boolean
            else if (k === 'auto_retry') result.autoRetry = v as boolean
            else if (k === 'retry_max') result.retryMax = v as number
            else if (k === 'retry_backoff_sec') result.retryBackoff = v as number
            else if (k === 'health_fix_auto') result.healthFixAuto = v as boolean
            else if (k === 'notify_on_complete') result.notifyOnComplete = v as boolean
          } else if (section === 'notification') {
            if (k === 'notify_red') result.notifyRed = v as boolean
            else if (k === 'notify_daily_summary') result.notifyDailySummary = v as boolean
            else if (k === 'notify_weekly_report') result.notifyWeeklyReport = v as boolean
            else if (k === 'channels') result.notifyChannels = v as string[]
            else if (k === 'email_recipient') result.emailRecipient = v as string
            else if (k === 'webhook_url') result.webhookUrl = v as string
          } else if (section === 'backup') {
            if (k === 'retention_days') result.backupRetentionDays = v as number
            else if (k === 'auto_backup') result.autoBackup = v as boolean
          } else if (section === 'advanced') {
            if (k === 'log_level') {
              if (v === 'DEBUG' || v === 'INFO' || v === 'WARNING' || v === 'ERROR') result.logLevel = v as SettingsState['logLevel']
            }
            else if (k === 'parallel_workers') result.parallelWorkers = v as number
            else if (k === 'query_timeout_sec') result.queryTimeoutSec = v as number
            else if (k === 'cache_enabled') result.cacheEnabled = v as boolean
            else if (k === 'experimental_features') result.experimentalFeatures = v as boolean
          }
        }
      }
      return Object.keys(result).length > 0 ? result as Partial<SettingsState> : null
    } catch {
      return null
    }
  }

  const handleImportYaml = () => {
    const parsed = parseSimpleYaml(importText)
    if (!parsed) {
      toast.error('YAML 解析失败', { description: '请检查格式是否正确' })
      return
    }
    setState(prev => ({ ...prev, ...parsed }))
    setShowImportDialog(false)
    setImportText('')
    const keys = Object.keys(parsed)
    toast.success(`已导入 ${keys.length} 个配置段`, {
      description: keys.map(k => k).join(' · ') + ' · 记得保存',
    })
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setImportText(text)
      setShowImportDialog(true)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleProfileFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result || '')
      setProfileImportText(text)
      setShowProfileImportExport(true)
    }
    reader.readAsText(file)
    e.target.value = ''
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
      {/* 环境 Profile 卡片 */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-zinc-500" />
              环境 Profile
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${activeColorConfig.bg} ${activeColorConfig.text} border`}>
                <span className={`h-1.5 w-1.5 rounded-full ${activeColorConfig.dot} mr-1`} />
                {activeProfile.name}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">{profiles.length} 个 Profile</Badge>
            </CardTitle>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleCopyProfile} title="复制当前配置创建新 Profile">
                <Copy className="h-3 w-3 mr-1" />复制当前配置
              </Button>
              <input ref={profileFileRef} type="file" accept=".json" onChange={handleProfileFileUpload} className="hidden" />
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setProfileImportText(''); setShowProfileImportExport(true) }} title="导入/导出 Profile">
                <FileCode2 className="h-3 w-3 mr-1" />导入/导出
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={handleAddProfile} title="新建 Profile">
                <Plus className="h-3 w-3 mr-1" />新建
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {profiles.map(profile => {
              const colorCfg = getProfileColorConfig(profile.color)
              const isActive = profile.id === activeProfileId
              return (
                <div
                  key={profile.id}
                  className={`group flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all ${
                    isActive
                      ? `${colorCfg.bg} ${colorCfg.text} border-current shadow-sm`
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300 dark:hover:border-zinc-600'
                  }`}
                  onClick={() => handleProfileSwitch(profile.id)}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${colorCfg.dot} ${isActive ? 'ring-2 ring-offset-1 ring-current' : ''}`} />
                  <span className="text-xs font-medium">{profile.name}</span>
                  {isActive && (
                    <Badge variant="outline" className={`text-[9px] py-0 px-1 ${colorCfg.text} border-current`}>活跃</Badge>
                  )}
                  {/* Edit/Delete buttons (not on active) */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleRenameProfile(profile.id) }}
                      className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600"
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    {!isActive && profiles.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(profile.id) }}
                        className="p-0.5 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40 text-zinc-400 hover:text-rose-600"
                        title="删除"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Profile key differences summary */}
          <div className="mt-3 pt-3 border-t">
            <div className="text-[10px] text-zinc-400 mb-1.5">当前 Profile 关键配置:</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              <span className="text-zinc-500">DB: <span className="font-mono text-zinc-700 dark:text-zinc-300">{state.dbPath}</span></span>
              <span className="text-zinc-500">备份: <span className="font-mono text-zinc-700 dark:text-zinc-300">{state.backupDir}</span></span>
              <span className="text-zinc-500">调度: <span className="font-mono text-zinc-700 dark:text-zinc-300">{state.dailyTime}</span></span>
              <span className="text-zinc-500">重试: <span className="font-mono text-zinc-700 dark:text-zinc-300">{state.autoRetry ? `${state.retryMax}次/${state.retryBackoff}s` : '关'}</span></span>
            </div>
          </div>
        </CardContent>
      </Card>

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
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${activeColorConfig.bg} ${activeColorConfig.text} border`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${activeColorConfig.dot} mr-1`} />
                    {activeProfile.name}
                  </Badge>
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
              <input ref={fileInputRef} type="file" accept=".yaml,.yml,.txt" onChange={handleFileUpload} className="hidden" />
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowImportDialog(true)} title="从文本导入 YAML">
                <FileUp className="h-3 w-3 mr-1" />导入
              </Button>
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleExportYaml} title="导出为 YAML">
                <FileDown className="h-3 w-3 mr-1" />导出
              </Button>
              <div className="w-px h-5 bg-zinc-200 dark:bg-zinc-700 mx-0.5" />
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
        <TabsList className="grid grid-cols-8 w-full h-9">
          <TabsTrigger value="general" className="text-xs gap-1"><Database className="h-3 w-3" />通用</TabsTrigger>
          <TabsTrigger value="lint" className="text-xs gap-1"><Shield className="h-3 w-3" />Lint<span className="text-[10px] text-zinc-400">{lintStats.enabled}/{lintStats.total}</span></TabsTrigger>
          <TabsTrigger value="schedule" className="text-xs gap-1"><Clock className="h-3 w-3" />调度</TabsTrigger>
          <TabsTrigger value="notify" className="text-xs gap-1"><Bell className="h-3 w-3" />通知</TabsTrigger>
          <TabsTrigger value="source" className="text-xs gap-1"><HardDrive className="h-3 w-3" />数据源</TabsTrigger>
          <TabsTrigger value="integrate" className="text-xs gap-1"><Webhook className="h-3 w-3" />集成</TabsTrigger>
          <TabsTrigger value="config" className="text-xs gap-1"><Table2 className="h-3 w-3" />配置<span className="text-[10px] text-zinc-400">{configStats.unsaved > 0 ? `${configStats.unsaved}` : ''}</span></TabsTrigger>
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
                <Button variant="outline" size="sm" className="ml-auto h-7 text-xs" onClick={handleTestConnection} disabled={connectionTesting}>
                  {connectionTesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Activity className="h-3 w-3 mr-1" />}
                  测试连接
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
              <CardTitle className="text-base flex items-center gap-2"><Github className="h-4 w-4 text-zinc-700 dark:text-zinc-300" />GitHub 同步</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Sync status & controls */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-md border bg-zinc-50/50 dark:bg-zinc-900/30">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <SyncStatusBadge status={githubSync.syncStatus} />
                    {githubSync.isStale && (
                      <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 text-[10px]">
                        <AlertCircle className="h-3 w-3 mr-0.5" />数据过期
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 space-y-0.5">
                    {githubSync.lastSyncTime && (
                      <div>上次同步：{formatSyncTime(githubSync.lastSyncTime)}</div>
                    )}
                    {githubSync.cachedAt && (
                      <div>缓存时间：{formatSyncTime(githubSync.cachedAt)}</div>
                    )}
                    {githubSync.data && (
                      <div className="font-mono text-[10px] text-zinc-400">
                        {githubSync.data.repo} · {githubSync.data.branch}
                      </div>
                    )}
                    {githubSync.staleError && (
                      <div className="text-amber-600 dark:text-amber-400 text-[10px] mt-1">
                        同步失败，显示缓存数据：{githubSync.staleError}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      githubSync.syncNowReset()
                      githubSync.syncNow(undefined as unknown as void)
                      toast.info('正在从 GitHub 强制同步…')
                    }}
                    disabled={githubSync.isSyncing}
                  >
                    {githubSync.isSyncing ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 mr-1" />
                    )}
                    立即同步
                  </Button>
                </div>
              </div>

              {/* Push section */}
              <div className="p-3 rounded-md border">
                <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
                  <Upload className="h-3 w-3 text-sky-500" />
                  推送到 GitHub
                </div>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Commit 消息</Label>
                    <Input
                      value={pushCommitMsg}
                      onChange={e => setPushCommitMsg(e.target.value)}
                      className="text-xs mt-1 font-mono"
                      placeholder="dataops: update config"
                      disabled={githubSync.isPushing}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      className="h-8 text-xs bg-zinc-800 dark:bg-zinc-200 dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300"
                      disabled={githubSync.isPushing || !githubSync.data}
                      onClick={() => {
                        if (!githubSync.data) return
                        githubSync.pushReset()
                        githubSync.push({
                          tables: githubSync.data.tables,
                          dictionary: githubSync.data.dictionary,
                          commitMessage: pushCommitMsg || undefined,
                        })
                        toast.info('正在推送到 GitHub…')
                      }}
                    >
                      {githubSync.isPushing ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Upload className="h-3 w-3 mr-1" />
                      )}
                      推送当前配置
                    </Button>
                    <span className="text-[10px] text-zinc-400">
                      将 tables.json 和 data_dictionary.json 推回仓库
                    </span>
                  </div>
                  {githubSync.pushResult && (
                    <div className={`p-2 rounded-md text-xs ${
                      githubSync.pushResult.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                    }`}>
                      {githubSync.pushResult.success ? (
                        <div className="flex items-start gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <div>
                            <div className="font-medium">推送成功</div>
                            <div className="text-[10px] mt-0.5">
                              {formatSyncTime(githubSync.pushResult.pushedAt)} · {githubSync.pushResult.commitMessage}
                            </div>
                            {Object.entries(githubSync.pushResult.results).map(([key, val]) => (
                              <div key={key} className="text-[10px]">
                                {key}: {val.success ? '✓' : `✗ ${val.error ?? ''}`}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1.5">
                          <XCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                          <div>推送失败：{githubSync.pushResult.error || '部分文件推送失败'}</div>
                        </div>
                      )}
                    </div>
                  )}
                  {githubSync.pushError && (
                    <div className="p-2 rounded-md text-xs bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 flex items-start gap-1.5">
                      <XCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                      <div>{githubSync.pushError}</div>
                    </div>
                  )}
                </div>
              </div>

              {/* Token status */}
              <div className="p-2.5 rounded-md bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800 text-xs text-sky-700 dark:text-sky-300 flex items-start gap-2">
                <KeyRound className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <div className="font-medium">GITHUB_TOKEN 状态</div>
                  <div className="mt-0.5">
                    {APP_CONFIG.gitHubToken ? (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        已配置 · 推送和私有仓库读取可用
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        未配置 · 仅公开仓库读取可用，推送功能不可用
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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

        {/* 配置管理 Tab */}
        <TabsContent value="config" className="mt-4 space-y-4">
          {/* Statistics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            <Card className="p-3">
              <div className="text-2xl font-bold font-mono text-zinc-700 dark:text-zinc-200">{configStats.total}</div>
              <div className="text-xs text-zinc-500 mt-0.5">总表数</div>
            </Card>
            <Card className="p-3">
              <div className="flex flex-wrap gap-1.5 mt-1">
                {['daily', 'weekly', 'monthly', 'once'].map(s => (
                  <span key={s} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${scheduleColorMap[s] || ''}`}>
                    {s === 'daily' ? '日' : s === 'weekly' ? '周' : s === 'monthly' ? '月' : '一'}{configStats.bySchedule[s] || 0}
                  </span>
                ))}
              </div>
              <div className="text-xs text-zinc-500 mt-1.5">按调度</div>
            </Card>
            <Card className="p-3">
              <div className="flex gap-2 mt-1">
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-700">
                  增量 {configStats.byMode['increment'] || 0}
                </span>
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-700">
                  全量 {configStats.byMode['full'] || 0}
                </span>
              </div>
              <div className="text-xs text-zinc-500 mt-1.5">按模式</div>
            </Card>
            <Card className="p-3">
              <div className="text-2xl font-bold font-mono text-violet-600 dark:text-violet-400">{configStats.withDeps}</div>
              <div className="text-xs text-zinc-500 mt-0.5">有依赖</div>
            </Card>
            <Card className={`p-3 ${configStats.unsaved > 0 ? 'border-amber-300 dark:border-amber-700 bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
              <div className={`text-2xl font-bold font-mono ${configStats.unsaved > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-zinc-400'}`}>
                {configStats.unsaved}
              </div>
              <div className="text-xs text-zinc-500 mt-0.5">待保存</div>
            </Card>
          </div>

          {/* Config Diff View / Action Bar */}
          <Card className={configIsDirty ? 'border-amber-300 dark:border-amber-700 bg-amber-50/20 dark:bg-amber-950/10' : ''}>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-zinc-100 dark:bg-zinc-800">
                    <Table2 className="h-4 w-4 text-zinc-500" />
                  </div>
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      tables.json 配置
                      {configIsDirty ? (
                        <Badge variant="outline" className="text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 text-[10px] animate-pulse">
                          <AlertTriangle className="h-3 w-3 mr-0.5" />{configDirtyCount} 项待保存
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-emerald-600 border-emerald-300 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />已同步
                        </Badge>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400">config/tables.json · {configStats.total} 表</div>
                  </div>
                </div>
                <div className="ml-auto flex items-center gap-1.5">
                  <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={handleConfigExport}>
                    <Download className="h-3 w-3 mr-1" />导出 JSON
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleConfigReset} disabled={!configIsDirty}>
                    <RotateCcw className="h-3 w-3 mr-1" />重置
                  </Button>
                  <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={handleConfigSave} disabled={!configIsDirty || configSaving}>
                    {configSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Save className="h-3 w-3 mr-1" />}
                    保存更改{configDirtyCount > 0 ? ` (${configDirtyCount})` : ''}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Search & Filter Bar */}
          <Card>
            <CardContent className="p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400" />
                  <Input
                    placeholder="搜索表名 / 中文名..."
                    value={configSearch}
                    onChange={e => setConfigSearch(e.target.value)}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                <Select value={configScheduleFilter} onValueChange={setConfigScheduleFilter}>
                  <SelectTrigger className="h-8 text-xs w-[120px]">
                    <Filter className="h-3 w-3 mr-1 text-zinc-400" />
                    <SelectValue placeholder="调度筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">全部调度</SelectItem>
                    <SelectItem value="daily" className="text-xs">daily</SelectItem>
                    <SelectItem value="weekly" className="text-xs">weekly</SelectItem>
                    <SelectItem value="monthly" className="text-xs">monthly</SelectItem>
                    <SelectItem value="once" className="text-xs">once</SelectItem>
                    <SelectItem value="intraday" className="text-xs">intraday</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={configDirFilter} onValueChange={setConfigDirFilter}>
                  <SelectTrigger className="h-8 text-xs w-[120px]">
                    <SelectValue placeholder="目录筛选" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">全部目录</SelectItem>
                    <SelectItem value="1_入库" className="text-xs">1_入库</SelectItem>
                    <SelectItem value="2_计算" className="text-xs">2_计算</SelectItem>
                  </SelectContent>
                </Select>
                <Badge variant="outline" className="text-[10px] ml-1">
                  显示 {filteredConfig.length}/{configStats.total}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Config Table */}
          <Card>
            <CardContent className="p-0">
              <div className="max-h-[520px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[11px] w-[160px]">表名</TableHead>
                      <TableHead className="text-[11px] w-[120px]">中文名</TableHead>
                      <TableHead className="text-[11px] w-[70px]">目录</TableHead>
                      <TableHead className="text-[11px] w-[110px]">调度</TableHead>
                      <TableHead className="text-[11px] w-[110px]">模式</TableHead>
                      <TableHead className="text-[11px] w-[50px]">排序</TableHead>
                      <TableHead className="text-[11px] w-[90px]">数据源</TableHead>
                      <TableHead className="text-[11px]">依赖</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredConfig.map(row => {
                      const rowDirty = isRowDirty(row.tableName)
                      return (
                        <TableRow key={row.tableName} className={`group ${rowDirty ? 'bg-amber-50/50 dark:bg-amber-950/20' : ''}`}>
                          <TableCell className="text-xs">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-medium">{row.tableName}</span>
                              {row.status === 'view' && (
                                <Badge variant="outline" className="text-[9px] py-0 px-1 text-violet-600 border-violet-300">VIEW</Badge>
                              )}
                              {rowDirty && (
                                <Badge variant="outline" className="text-[9px] py-0 px-1 text-amber-600 border-amber-300 animate-pulse">已改</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-zinc-600 dark:text-zinc-400">{row.cn}</TableCell>
                          <TableCell className="text-xs">
                            <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${row.dir === '1_入库' ? 'text-sky-600 border-sky-300' : 'text-fuchsia-600 border-fuchsia-300'}`}>
                              {row.dir}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Select
                              value={row.schedule}
                              onValueChange={v => updateConfigField(row.tableName, 'schedule', v)}
                            >
                              <SelectTrigger className={`h-7 text-[11px] border-0 p-0 pl-1 gap-0.5 hover:bg-muted ${scheduleColorMap[row.schedule] || ''}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="daily" className="text-xs">daily (每日)</SelectItem>
                                <SelectItem value="weekly" className="text-xs">weekly (每周)</SelectItem>
                                <SelectItem value="monthly" className="text-xs">monthly (每月)</SelectItem>
                                <SelectItem value="once" className="text-xs">once (一次)</SelectItem>
                                <SelectItem value="intraday" className="text-xs">intraday (日内)</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-xs">
                            <Select
                              value={row.mode}
                              onValueChange={v => updateConfigField(row.tableName, 'mode', v)}
                            >
                              <SelectTrigger className="h-7 text-[11px] border-0 p-0 pl-1 gap-0.5 hover:bg-muted">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="increment" className="text-xs">increment (增量)</SelectItem>
                                <SelectItem value="full" className="text-xs">full (全量)</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-xs font-mono text-zinc-500">{row.sort}</TableCell>
                          <TableCell className="text-xs text-zinc-500">{row.source}</TableCell>
                          <TableCell className="text-xs">
                            <button
                              className="flex flex-wrap gap-1 items-center group/dep cursor-pointer hover:opacity-80"
                              onClick={() => openDepDialog(row.tableName)}
                              title="点击编辑依赖"
                            >
                              {row.depends_on.length === 0 ? (
                                <span className="text-zinc-400 text-[10px] italic">无</span>
                              ) : (
                                row.depends_on.map(dep => (
                                  <Badge key={dep} variant="outline" className="text-[9px] py-0 px-1 text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-700">
                                    {dep}
                                  </Badge>
                                ))
                              )}
                              <Pencil className="h-2.5 w-2.5 text-zinc-300 opacity-0 group-hover/dep:opacity-100 transition-opacity" />
                            </button>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
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

      {/* 版本信息 + 关于 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            版本信息
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-start gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-gradient-to-br from-emerald-500 to-sky-600 text-white shadow-md">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">DataOps 管理台</span>
                  <Badge className="bg-emerald-600 text-[10px]">v1.0.0</Badge>
                  <Badge variant="outline" className="text-[10px]">2026-06-25</Badge>
                </div>
                <div className="text-[11px] text-zinc-500 mt-0.5">DuckDB {state.duckdbVersion} · React 19 · Next.js 16</div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:ml-auto">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={() => toast.success('当前已是最新版本', { description: 'v1.0.0 · 2026-06-25' })}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                检查更新
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 关于 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Github className="h-4 w-4 text-zinc-500" />
            关于
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              DataOps 管理台是一套面向量化交易数据管线的 DevOps 平台，覆盖数据入库、计算、策略产出的全生命周期管理。
              核心理念：把"靠人记的规范"变成"机器校验的契约"——lint engine、血缘 DAG、schema diff、健康度监控四件套。
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><Github className="h-3 w-3" />{APP_CONFIG.gitHubRepo}</span>
              <span className="flex items-center gap-1"><Database className="h-3 w-3" />{TABLES.length} 表</span>
              <span className="flex items-center gap-1"><Shield className="h-3 w-3" />{LINT_RULES.length} Lint 规则</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 键盘快捷键 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Zap className="h-4 w-4 text-sky-500" />
            键盘快捷键
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              { keys: 'Ctrl + S', desc: '保存当前配置' },
              { keys: 'Ctrl + Enter', desc: 'SQL Playground 执行查询' },
              { keys: 'Ctrl + 滚轮', desc: '血缘图谱缩放' },
              { keys: 'Esc', desc: '关闭弹窗/抽屉' },
              { keys: 'Ctrl + K', desc: '全局搜索（规划中）' },
              { keys: '1-9', desc: '切换侧栏视图（规划中）' },
            ].map(shortcut => (
              <div key={shortcut.keys} className="flex items-center justify-between px-3 py-2 rounded-md border border-zinc-200 dark:border-zinc-700 text-xs">
                <span className="text-zinc-600 dark:text-zinc-400">{shortcut.desc}</span>
                <kbd className="px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-[10px] text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700">
                  {shortcut.keys}
                </kbd>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-500 flex items-center gap-2">
        <Settings className="h-4 w-4" />
        本页所有配置对应 <code className="font-mono text-sky-600">config/registry/</code> 下的 YAML 文件，UI 改动会写回 YAML（本原型为只读演示）。
      </div>

      {/* ── Dialog: Add/Rename Profile ─────────────────────────── */}
      <Dialog open={showProfileDialog} onOpenChange={setShowProfileDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{profileDialogMode === 'add' ? '新建环境 Profile' : '重命名 Profile'}</DialogTitle>
            <DialogDescription>
              {profileDialogMode === 'add' ? '创建一个新的环境配置 Profile' : '修改 Profile 名称和颜色'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs">Profile 名称</Label>
              <Input
                value={newProfileName}
                onChange={e => setNewProfileName(e.target.value)}
                placeholder="如：UAT 环境"
                className="mt-1"
                onKeyDown={e => { if (e.key === 'Enter') handleProfileDialogConfirm() }}
              />
            </div>
            <div>
              <Label className="text-xs">颜色标识</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {PROFILE_COLORS.map(c => (
                  <button
                    key={c.value}
                    onClick={() => setNewProfileColor(c.value)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border text-xs transition-all ${
                      newProfileColor === c.value
                        ? `${c.bg} ${c.text} border-current shadow-sm`
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-zinc-300'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowProfileDialog(false)}>取消</Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={handleProfileDialogConfirm}>
              {profileDialogMode === 'add' ? '创建' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Delete Profile Confirm ──────────────────────── */}
      <Dialog open={!!showDeleteConfirm} onOpenChange={(open) => { if (!open) setShowDeleteConfirm(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-rose-600">确认删除 Profile？</DialogTitle>
            <DialogDescription>
              删除后该 Profile 的所有配置将丢失，无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowDeleteConfirm(null)}>取消</Button>
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => showDeleteConfirm && handleDeleteProfile(showDeleteConfirm)}>
              <Trash2 className="h-3 w-3 mr-1" />删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Profile Import/Export ────────────────────────── */}
      <Dialog open={showProfileImportExport} onOpenChange={setShowProfileImportExport}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileCode2 className="h-4 w-4" />
              Profile 导入 / 导出
            </DialogTitle>
            <DialogDescription>
              以 JSON 格式导入或导出环境 Profile 配置
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Export */}
            <div className="p-3 rounded-md border space-y-2">
              <div className="text-xs font-medium flex items-center gap-1.5">
                <Download className="h-3 w-3 text-sky-500" />导出
              </div>
              <div className="text-[11px] text-zinc-500">将当前所有 Profile 导出为 JSON 文件</div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleExportProfiles}>
                <Download className="h-3 w-3 mr-1" />导出 JSON
              </Button>
            </div>

            {/* Import */}
            <div className="p-3 rounded-md border space-y-2">
              <div className="text-xs font-medium flex items-center gap-1.5">
                <ImportIcon className="h-3 w-3 text-fuchsia-500" />导入
              </div>
              <div className="text-[11px] text-zinc-500">粘贴 JSON 文本或上传文件导入 Profile（同名 Profile 不会覆盖）</div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => profileFileRef.current?.click()}>
                  <FileUp className="h-3 w-3 mr-1" />选择文件...
                </Button>
                <span className="text-[10px] text-zinc-400">.json</span>
              </div>
              <textarea
                value={profileImportText}
                onChange={e => setProfileImportText(e.target.value)}
                placeholder={'{\n  "version": 1,\n  "profiles": [...]\n}'}
                className="w-full min-h-[120px] p-2 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono text-[11px] resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-300"
                spellCheck={false}
              />
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => { setShowProfileImportExport(false); setProfileImportText('') }}>关闭</Button>
            <Button size="sm" className="bg-fuchsia-600 hover:bg-fuchsia-700" onClick={handleImportProfiles} disabled={!profileImportText.trim()}>
              <ImportIcon className="h-3 w-3 mr-1" />导入
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Profile Switch Confirm (dirty) ──────────────── */}
      <Dialog open={showSwitchConfirm} onOpenChange={setShowSwitchConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>切换环境</DialogTitle>
            <DialogDescription>当前配置有未保存的更改，切换前将自动保存。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => { setShowSwitchConfirm(false); setPendingSwitchId(null) }}>取消</Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700" onClick={() => {
              setShowSwitchConfirm(false)
              if (pendingSwitchId) switchToProfile(pendingSwitchId)
              setPendingSwitchId(null)
            }}>
              <Globe className="h-3 w-3 mr-1" />确认切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Prod Save Confirm ───────────────────────────── */}
      <Dialog open={showProdSaveConfirm} onOpenChange={setShowProdSaveConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-rose-600">确认修改生产环境配置？</DialogTitle>
            <DialogDescription>此操作将直接影响生产环境</DialogDescription>
          </DialogHeader>
          <div className="p-2.5 rounded-md bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <div>确认有 {dirtyCount} 处变更需要应用到生产环境</div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setShowProdSaveConfirm(false)}>取消</Button>
            <Button size="sm" className="bg-rose-600 hover:bg-rose-700" onClick={() => { setShowProdSaveConfirm(false); doSave() }}>
              <AlertTriangle className="h-3 w-3 mr-1" />确认修改生产环境
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── YAML Export Dialog ──────────────────────────────────── */}
      {showYamlDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowYamlDialog(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between bg-gradient-to-r from-sky-50 to-emerald-50 dark:from-sky-950/30 dark:to-emerald-950/30 rounded-t-xl">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-sky-500 to-emerald-500 text-white">
                  <FileCode2 className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">YAML 配置预览</div>
                  <div className="text-[10px] text-zinc-500">settings.yaml · {yamlPreview.split('\n').length} 行</div>
                </div>
              </div>
              <button onClick={() => setShowYamlDialog(false)} className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-4">
              <pre className="text-xs font-mono leading-relaxed text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap"><code>{yamlPreview}</code></pre>
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-end gap-2 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-b-xl">
              <Button size="sm" variant="outline" onClick={handleCopyYaml}>
                <ClipboardCopy className="h-3 w-3 mr-1" />复制
              </Button>
              <Button size="sm" className="bg-sky-600 hover:bg-sky-700" onClick={handleDownloadYaml}>
                <FileDown className="h-3 w-3 mr-1" />下载 .yaml
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Staging watermark */}
      {activeProfile.color === 'amber' && (
        <div className="fixed top-4 right-4 z-40 pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-300/30 backdrop-blur-sm rotate-3">
            <span className="text-2xl font-bold text-amber-500/20 tracking-widest">测试</span>
          </div>
        </div>
      )}

      {/* Prod watermark */}
      {activeProfile.color === 'rose' && activeProfile.name.includes('生产') && (
        <div className="fixed top-4 right-4 z-40 pointer-events-none">
          <div className="px-4 py-2 rounded-lg bg-rose-500/10 border border-rose-300/30 backdrop-blur-sm -rotate-2">
            <span className="text-2xl font-bold text-rose-500/20 tracking-widest">生产</span>
          </div>
        </div>
      )}

      {/* ── Dependency Editor Dialog ──────────────────────────────── */}
      <Dialog open={depDialogOpen} onOpenChange={setDepDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4 text-violet-500" />
              编辑依赖 — {depDialogTable}
            </DialogTitle>
            <DialogDescription>
              选择该表的上游依赖表（depends_on），勾选后保存
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-zinc-500">
              当前依赖: <span className="font-mono">{depDialogSelected.length}</span> 个表
            </div>
            <div className="max-h-[320px] overflow-y-auto rounded-md border p-2 space-y-1">
              {Object.values(REAL_TABLE_CONFIGS)
                .filter(cfg => cfg.table !== depDialogTable) // Can't depend on self
                .sort((a, b) => a.table.localeCompare(b.table))
                .map(cfg => {
                  const checked = depDialogSelected.includes(cfg.table)
                  return (
                    <label
                      key={cfg.table}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors text-xs ${
                        checked ? 'bg-violet-50 dark:bg-violet-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900/40'
                      }`}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(val) => {
                          if (val) {
                            setDepDialogSelected(prev => [...prev, cfg.table])
                          } else {
                            setDepDialogSelected(prev => prev.filter(t => t !== cfg.table))
                          }
                        }}
                      />
                      <span className="font-mono font-medium">{cfg.table}</span>
                      <span className="text-zinc-400 ml-1">{cfg.cn}</span>
                      <Badge variant="outline" className={`text-[9px] py-0 px-1 ml-auto ${scheduleColorMap[cfg.schedule] || ''}`}>
                        {cfg.schedule}
                      </Badge>
                    </label>
                  )
                })}
            </div>
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setDepDialogOpen(false)}>取消</Button>
            <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={saveDepDialog}>
              <Link2 className="h-3 w-3 mr-1" />
              保存依赖 ({depDialogSelected.length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* YAML Import Dialog */}
      {showImportDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowImportDialog(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-zinc-200 dark:border-zinc-800" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b flex items-center justify-between bg-gradient-to-r from-fuchsia-50 to-amber-50 dark:from-fuchsia-950/30 dark:to-amber-950/30 rounded-t-xl">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-md bg-gradient-to-br from-fuchsia-500 to-amber-500 text-white">
                  <FileUp className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-semibold">导入 YAML 配置</div>
                  <div className="text-[10px] text-zinc-500">粘贴 YAML 文本或上传文件 · 导入后需手动保存</div>
                </div>
              </div>
              <button onClick={() => setShowImportDialog(false)} className="p-1.5 rounded-md hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-500">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <FileUp className="h-3 w-3 mr-1" />选择文件...
                </Button>
                <span className="text-[10px] text-zinc-400">支持 .yaml / .yml / .txt</span>
              </div>
              <textarea
                value={importText}
                onChange={e => setImportText(e.target.value)}
                placeholder={'# 粘贴 YAML 内容，例如：\n\ngeneral:\n  db_path: "db/profit_radar.duckdb"\n  backup_dir: "./archive"\n\nschedule:\n  daily_time: "17:00"\n  auto_retry: true\n  retry_max: 3\n\n# ... 完整格式参考「导出」生成的 YAML'}
                className="flex-1 min-h-[200px] w-full p-3 rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 font-mono text-xs resize-none focus:outline-none focus:ring-2 focus:ring-fuchsia-300"
                spellCheck={false}
              />
            </div>
            <div className="px-5 py-3 border-t flex items-center justify-between gap-2 bg-zinc-50/50 dark:bg-zinc-950/30 rounded-b-xl">
              <span className="text-[10px] text-zinc-400">导入会合并到当前配置（浅合并），未出现的字段保留原值</span>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { setShowImportDialog(false); setImportText('') }}>取消</Button>
                <Button size="sm" className="bg-fuchsia-600 hover:bg-fuchsia-700" onClick={handleImportYaml} disabled={!importText.trim()}>
                  <FileUp className="h-3 w-3 mr-1" />解析并导入
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
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

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const config: Record<SyncStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    idle: { label: '未同步', icon: <Clock className="h-3 w-3 mr-0.5" />, cls: 'text-zinc-500 border-zinc-300' },
    syncing: { label: '同步中', icon: <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />, cls: 'text-sky-600 border-sky-300' },
    synced: { label: '已同步', icon: <CheckCircle2 className="h-3 w-3 mr-0.5" />, cls: 'text-emerald-600 border-emerald-300' },
    error: { label: '同步失败', icon: <XCircle className="h-3 w-3 mr-0.5" />, cls: 'text-rose-600 border-rose-300' },
    pushing: { label: '推送中', icon: <Loader2 className="h-3 w-3 mr-0.5 animate-spin" />, cls: 'text-amber-600 border-amber-300' },
  }
  const c = config[status]
  return (
    <Badge variant="outline" className={`text-[10px] ${c.cls}`}>
      {c.icon}{c.label}
    </Badge>
  )
}

function formatSyncTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffMin = Math.floor(diffMs / 60_000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin} 分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr} 小时前`
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
