import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

// DataOps SQL Playground → 真实 DuckDB（经 Python sidecar 只读执行）
// 安全：① 关键字白名单 ② 无 LIMIT 自动补 + 行数硬上限 ③ read_only 连库 ④ 30s 超时 kill

export const dynamic = 'force-dynamic'
// 查询路由默认不缓存（每次实时跑）
export const revalidate = 0

const PYTHON = process.env.DATAOPS_PYTHON || 'python'
// Next dev 的 process.cwd() = dataops-ui，DB 在上级项目根的 db/ 下
const DB_PATH =
  process.env.DUCKDB_PATH ||
  path.resolve(process.cwd(), '..', 'db', 'profit_radar.duckdb')
const SCRIPT = path.resolve(process.cwd(), 'scripts', 'sql_query.py')

const TIMEOUT_MS = 30_000
const MAX_LIMIT = 5000
const DEFAULT_LIMIT = 1000
// 仅放行只读语句首关键字
const ALLOWED_LEAD = /^(select|with|show|describe|explain|pragma|table|values)\b/i

function hasLimit(sql: string): boolean {
  return /\blimit\b/i.test(sql)
}

/** spawn python sidecar，喂 JSON，收 JSON，超时硬 kill。 */
function runPy(payload: Record<string, unknown>, timeout = TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT], { windowsHide: true, cwd: process.cwd() })
    let out = ''
    let err = ''
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`查询超时（${timeout / 1000}s），已终止`))
    }, timeout)

    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8') })
    child.on('error', (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`无法启动 ${PYTHON}（${SCRIPT}）：${e.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      clearTimeout(timer)
      const trimmed = out.trim()
      if (!trimmed) {
        reject(new Error(err.trim() || `python 进程退出码 ${code}，无输出（检查 ${PYTHON} 是否在 PATH）`))
        return
      }
      try {
        resolve(JSON.parse(trimmed))
      } catch {
        reject(new Error(`python 输出非 JSON（code=${code}）: ${trimmed.slice(0, 300)}`))
      }
    })

    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const rawSql: string = (body?.sql ?? '').toString().trim()
  if (!rawSql) {
    return NextResponse.json({ error: '空 SQL' }, { status: 400 })
  }

  // ① 白名单：首关键字必须是只读语句
  const lead = rawSql.match(/^(\w+)/)?.[1] ?? ''
  if (!ALLOWED_LEAD.test(rawSql)) {
    return NextResponse.json(
      { error: `仅允许只读语句（SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA/TABLE/VALUES），拒绝：${lead}` },
      { status: 400 },
    )
  }

  const explain = !!body?.explain
  let limit = Number(body?.limit) || DEFAULT_LIMIT
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT
  limit = Math.min(Math.trunc(limit), MAX_LIMIT)

  // ② 普通查询无 LIMIT 则自动补，防打爆（最大表 1.98 亿行）
  let sql = rawSql.replace(/;\s*$/, '')
  if (!explain && !hasLimit(sql)) {
    sql = `${sql} LIMIT ${limit}`
  }

  try {
    const res = await runPy({ sql, explain, limit, dbPath: DB_PATH })
    if (res && res.error) {
      return NextResponse.json({ error: res.error, elapsedMs: res.elapsedMs }, { status: 400 })
    }
    return NextResponse.json({ ...res, source: 'duckdb', db: DB_PATH })
  } catch (e: any) {
    const status = /超时/.test(e?.message || '') ? 504 : 500
    return NextResponse.json({ error: e?.message || String(e) }, { status })
  }
}
