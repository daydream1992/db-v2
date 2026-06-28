'use client'
import { useTheme } from 'next-themes'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const { setTheme, resolvedTheme } = useTheme()

  // 用 CSS dark: 变体控制图标可见性，避免 mounted 态切换导致的 hydration mismatch。
  // html 上有 class="dark"（attribute="class"），所以 dark:block/hidden 可直接命中。
  const toggle = () => {
    const isDark = resolvedTheme === 'dark'
    setTheme(isDark ? 'light' : 'dark')
  }

  return (
    <button
      onClick={toggle}
      className="relative h-8 w-8 rounded-md flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 transition-colors"
      title="切换主题"
      aria-label="切换主题"
    >
      {/* 亮色图标：dark 模式下隐藏 */}
      <Sun className="h-4 w-4 block dark:hidden" />
      {/* 暗色图标：亮色模式下隐藏 */}
      <Moon className="h-4 w-4 hidden dark:block" />
    </button>
  )
}
