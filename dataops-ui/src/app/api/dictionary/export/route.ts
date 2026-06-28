import { NextResponse } from 'next/server'
import { TABLES } from '@/lib/dataops/mock-data'
import { APP_CONFIG } from '@/lib/dataops/config'

/**
 * GET /api/dictionary/export
 * Returns a Markdown document of the data dictionary as a downloadable file.
 */
export async function GET() {
  const markdown = generateDictionaryMarkdown()

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="data_dictionary.md"',
    },
  })
}

function generateDictionaryMarkdown(): string {
  const now = new Date().toISOString().slice(0, 19)
  const lines: string[] = []

  // Header
  lines.push('# 数据字典 (Data Dictionary)')
  lines.push('')
  lines.push(`> 生成时间: ${now}`)
  lines.push(`> 来源: db-v2 config/tables.json + data_dictionary.json`)
  lines.push(`> 仓库: ${APP_CONFIG.gitHubRepo} (${APP_CONFIG.gitHubBranch})`)
  lines.push(`> 表总数: ${TABLES.length}`)
  lines.push(`> 字段总数: ${TABLES.reduce((s, t) => s + t.columns.length, 0)}`)
  lines.push('')

  // Table of Contents
  lines.push('## 目录')
  lines.push('')

  // Group by directory
  const dirGroups = new Map<string, typeof TABLES>()
  TABLES.forEach(t => {
    const dir = t.dir
    if (!dirGroups.has(dir)) dirGroups.set(dir, [])
    dirGroups.get(dir)!.push(t)
  })

  const sortedDirs = Array.from(dirGroups.keys()).sort()
  for (const dir of sortedDirs) {
    lines.push(`### ${dir}`)
    lines.push('')
    const tables = dirGroups.get(dir)!.sort((a, b) => a.sort.localeCompare(b.sort))
    for (const t of tables) {
      lines.push(`- [${t.table} — ${t.cn}](#${t.table})`)
    }
    lines.push('')
  }

  lines.push('---')
  lines.push('')

  // Per-table sections
  for (const dir of sortedDirs) {
    const tables = dirGroups.get(dir)!.sort((a, b) => a.sort.localeCompare(b.sort))

    lines.push(`# ${dir}`)
    lines.push('')

    for (const t of tables) {
      lines.push(`## ${t.table}`)
      lines.push('')
      lines.push(`| 属性 | 值 |`)
      lines.push(`|------|-----|`)
      lines.push(`| 中文名 | ${t.cn} |`)
      lines.push(`| 目录 | ${t.dir} |`)
      lines.push(`| 排序 | ${t.sort} |`)
      lines.push(`| 调度 | ${t.schedule} |`)
      lines.push(`| 模式 | ${t.mode} |`)
      lines.push(`| 数据源 | ${t.source} |`)
      lines.push(`| 类型 | ${t.type} |`)
      lines.push(`| 行数 | ${t.rows.toLocaleString()} |`)
      lines.push(`| 脚本 | ${t.script} |`)
      if (t.dateCol) {
        lines.push(`| 日期列 | ${t.dateCol} |`)
      }
      if (t.dedupKey.length > 0) {
        lines.push(`| 去重键 | ${t.dedupKey.join(', ')} |`)
      }
      if (t.dependsOn.length > 0) {
        lines.push(`| 依赖 | ${t.dependsOn.join(', ')} |`)
      }
      if (t.downstream.length > 0) {
        lines.push(`| 下游 | ${t.downstream.join(', ')} |`)
      }
      lines.push('')

      // Column definitions
      lines.push('### 字段定义')
      lines.push('')
      lines.push('| # | 列名 | 类型 | 中文名 | 可空 | 备注 |')
      lines.push('|---|------|------|--------|------|------|')

      t.columns.forEach((c, i) => {
        const hasChinese = /[^\x00-\x7F]/.test(c.name)
        const nullable = c.nullable ? '✓' : '—'
        const note = hasChinese ? '⚠️ 含中文，建议英化' : c.nullable ? '允许 NULL' : '非空'
        lines.push(`| ${i + 1} | ${c.name} | ${c.type} | ${c.cn} | ${nullable} | ${note} |`)
      })

      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  // Statistics
  const totalCols = TABLES.reduce((s, t) => s + t.columns.length, 0)
  const chineseCols = TABLES.reduce((s, t) => s + t.columns.filter(c => /[^\x00-\x7F]/.test(c.name)).length, 0)
  const typeDist = new Map<string, number>()
  TABLES.forEach(t => t.columns.forEach(c => typeDist.set(c.type, (typeDist.get(c.type) || 0) + 1)))

  lines.push('# 统计信息')
  lines.push('')
  lines.push('## 字段类型分布')
  lines.push('')
  lines.push('| 类型 | 数量 | 占比 |')
  lines.push('|------|------|------|')
  for (const [type, count] of Array.from(typeDist.entries()).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${type} | ${count} | ${(count / totalCols * 100).toFixed(1)}% |`)
  }
  lines.push('')
  lines.push(`> 中文列名: ${chineseCols} / ${totalCols} (${(chineseCols / totalCols * 100).toFixed(1)}%)`)
  lines.push('')
  lines.push(`*数据字典由 DataOps 管理台自动生成 — ${now}*`)

  return lines.join('\n')
}
