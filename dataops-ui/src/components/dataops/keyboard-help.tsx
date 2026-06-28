'use client'
import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Keyboard, Command, Search, Play, Save } from 'lucide-react'

interface Shortcut {
  keys: string[]
  desc: string
  category: string
  icon?: React.ReactNode
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['⌘', 'K'], desc: '打开命令面板', category: '全局', icon: <Command className="h-3.5 w-3.5" /> },
  { keys: ['⌘', 'B'], desc: '切换侧边栏（待实现）', category: '全局' },
  { keys: ['?'], desc: '显示键盘快捷键帮助', category: '全局', icon: <Keyboard className="h-3.5 w-3.5" /> },
  { keys: ['Esc'], desc: '关闭对话框/抽屉', category: '全局' },
  { keys: ['⌘', 'S'], desc: '保存当前页配置（设置页）', category: '设置', icon: <Save className="h-3.5 w-3.5" /> },
  { keys: ['⌘', 'Enter'], desc: '执行 SQL', category: 'SQL Playground', icon: <Play className="h-3.5 w-3.5" /> },
  { keys: ['⌘', 'T'], desc: '新建查询 Tab', category: 'SQL Playground' },
  { keys: ['⌘', 'W'], desc: '关闭当前 Tab', category: 'SQL Playground' },
  { keys: ['g', 'd'], desc: '跳转 Dashboard', category: '导航' },
  { keys: ['g', 'c'], desc: '跳转脚本目录', category: '导航' },
  { keys: ['g', 'h'], desc: '跳转健康度', category: '导航' },
  { keys: ['g', 'l'], desc: '跳转血缘', category: '导航' },
  { keys: ['g', 's'], desc: '跳转 SQL Playground', category: '导航' },
]

export function KeyboardHelp({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?: (o: boolean) => void }) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 忽略输入框中的按键
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

      if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, setOpen])

  const categories = [...new Set(SHORTCUTS.map(s => s.category))]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 text-sky-500" />
            键盘快捷键
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          {categories.map(cat => (
            <div key={cat}>
              <div className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide mb-2">{cat}</div>
              <div className="space-y-1">
                {SHORTCUTS.filter(s => s.category === cat).map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-zinc-50 dark:hover:bg-zinc-900/50 text-sm">
                    <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                      {s.icon && <span className="text-zinc-400">{s.icon}</span>}
                      {s.desc}
                    </span>
                    <div className="flex items-center gap-1">
                      {s.keys.map((k, j) => (
                        <kbd key={j} className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-[10px] font-mono font-medium text-zinc-600 dark:text-zinc-400 shadow-sm">
                          {k}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="pt-2 border-t text-[11px] text-zinc-400 flex items-center gap-1.5">
            <Search className="h-3 w-3" />
            提示：在命令面板（⌘K）中输入表名可快速跳转
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
