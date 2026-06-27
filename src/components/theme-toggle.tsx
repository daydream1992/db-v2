'use client'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'
import { useState } from 'react'

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // 使用 useTheme 的 mounted 判断替代 effect setState
  const isDark = mounted ? ((resolvedTheme || theme) === 'dark') : false

  if (!mounted) {
    // 首次渲染后通过事件挂载
    if (typeof window !== 'undefined') {
      queueMicrotask(() => setMounted(true))
    }
    return <div className="h-8 w-8" />
  }

  return (
    <button
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="relative h-8 w-8 rounded-md flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
      title={isDark ? '切换到亮色' : '切换到暗色'}
      aria-label="切换主题"
    >
      <Sun className={`h-4 w-4 absolute transition-all ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'} duration-300`} />
      <Moon className={`h-4 w-4 absolute transition-all ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'} duration-300`} />
    </button>
  )
}
