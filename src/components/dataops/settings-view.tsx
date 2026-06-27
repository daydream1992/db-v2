'use client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Database, Settings, Bell, HardDrive, Clock, Webhook } from 'lucide-react'

export function SettingsView() {
  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Database className="h-4 w-4 text-sky-500" />数据库连接</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">DB 路径</Label>
              <Input value="K:\DB数据库_v2\db\profit_radar.duckdb" readOnly className="font-mono text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">备份目录</Label>
              <Input value="K:\DB数据库_v2\archive" readOnly className="font-mono text-xs mt-1" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-emerald-600 border-emerald-300">已连接</Badge>
            <span className="text-xs text-zinc-500">DuckDB v0.10 · 文件大小 1.2 GB</span>
            <Button variant="outline" size="sm" className="ml-auto">测试连接</Button>
            <Button variant="outline" size="sm">立即备份</Button>
          </div>
          <div className="p-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
            ⚠ 当前 DB_PATH 在 49 个脚本里硬编码。治理方案：统一到 <code className="font-mono">common/config.py</code>，此处改一处全局生效。
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4 text-fuchsia-500" />调度配置</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">每日盘后执行时间</Label>
              <Input value="17:00" readOnly className="font-mono text-xs mt-1" />
            </div>
            <div>
              <Label className="text-xs">时区</Label>
              <Input value="Asia/Shanghai" readOnly className="font-mono text-xs mt-1" />
            </div>
          </div>
          <div className="space-y-2">
            <ToggleRow label="交易日历判定" desc="仅交易日执行 daily 层" defaultChecked />
            <ToggleRow label="失败自动重试" desc="按 YAML retry 配置 (默认 3 次 / 30s)" defaultChecked />
            <ToggleRow label="health-fix 自动补数" desc="标红表自动 force 重跑（大表需确认）" />
            <ToggleRow label="执行完发通知" desc="success/failed 推送 IM" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><HardDrive className="h-4 w-4 text-emerald-500" />数据源</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <SourceRow name="tqcenter (TQ API)" path="K:\txdlianghua\PYPlugins\sys" status="ok" />
            <SourceRow name="TDX vipdoc (二进制K线)" path="K:\txdlianghua\vipdoc" status="ok" />
            <SourceRow name="TDX T0002 (信号文件)" path="K:\txdlianghua\T0002" status="ok" />
            <SourceRow name="通达信说明书 (文档)" path="docs/" status="ok" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Bell className="h-4 w-4 text-amber-500" />告警通知</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <ToggleRow label="RED 告警" desc="阻断级违规立即推送" defaultChecked />
          <ToggleRow label="每日执行汇总" desc="每天 19:00 推送当日执行结果" defaultChecked />
          <ToggleRow label="健康度周报" desc="每周一 9:00 推送健康度摘要" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Webhook className="h-4 w-4 text-sky-500" />集成</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded-md border">
            <div>
              <div className="text-sm font-medium">git pre-commit hook</div>
              <div className="text-xs text-zinc-500">提交前自动跑 lint engine</div>
            </div>
            <Badge variant="outline" className="text-emerald-600 border-emerald-300">已启用</Badge>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md border">
            <div>
              <div className="text-sm font-medium">CI 校验</div>
              <div className="text-xs text-zinc-500">PR 必须 lint 全绿才能合并</div>
            </div>
            <Badge variant="outline" className="text-amber-600 border-amber-300">待配置</Badge>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md border">
            <div>
              <div className="text-sm font-medium">实时日志推送</div>
              <div className="text-xs text-zinc-500">WebSocket 推送执行日志到 UI</div>
            </div>
            <Badge variant="outline" className="text-zinc-500">P2 规划</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="p-3 rounded-md bg-zinc-50 dark:bg-zinc-900/50 text-xs text-zinc-500 flex items-center gap-2">
        <Settings className="h-4 w-4" />
        本页所有配置对应 <code className="font-mono text-sky-600">config/registry/</code> 下的 YAML 文件，UI 改动会写回 YAML（本原型为只读演示）。
      </div>
    </div>
  )
}

function ToggleRow({ label, desc, defaultChecked }: { label: string; desc: string; defaultChecked?: boolean }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-md border">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-zinc-500">{desc}</div>
      </div>
      <Switch defaultChecked={defaultChecked} />
    </div>
  )
}

function SourceRow({ name, path, status }: { name: string; path: string; status: 'ok' | 'err' }) {
  return (
    <div className="flex items-center justify-between p-2 rounded-md border">
      <div className="min-w-0">
        <div className="text-sm font-medium">{name}</div>
        <div className="text-xs text-zinc-500 font-mono truncate">{path}</div>
      </div>
      <Badge variant="outline" className={status === 'ok' ? 'text-emerald-600 border-emerald-300' : 'text-rose-600 border-rose-300'}>
        {status === 'ok' ? '可用' : '不可达'}
      </Badge>
    </div>
  )
}
