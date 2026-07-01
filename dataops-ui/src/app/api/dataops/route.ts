import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'

// DataOps 元数据后端入口：op 分发 → spawn scripts/dataops.py（只读）
// GET  /api/dataops?op=catalog            → 轻量查询
// POST /api/dataops  body {op, ...params} → 带参数查询
// 安全：dataops.py 只读连库 + 只读文件；30s 超时硬 kill。

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PYTHON = process.env.DATAOPS_PYTHON || 'python'
const SCRIPT = path.resolve(process.cwd(), 'scripts', 'dataops.py')
const TIMEOUT_MS = 30_000

function runPy(payload: Record<string, unknown>, timeout = TIMEOUT_MS): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [SCRIPT], { windowsHide: true, cwd: process.cwd() })
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`后端超时（${timeout / 1000}s），已终止`))
    }, timeout)
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8') })
    child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8') })
    child.on('error', (e) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      reject(new Error(`无法启动 ${PYTHON}：${e.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      clearTimeout(timer)
      const trimmed = out.trim()
      if (!trimmed) {
        reject(new Error(err.trim() || `python 退出码 ${code}，无输出`))
        return
      }
      try { resolve(JSON.parse(trimmed)) }
      catch { reject(new Error(`python 输出非 JSON: ${trimmed.slice(0, 300)}`)) }
    })
    child.stdin.write(JSON.stringify(payload))
    child.stdin.end()
  })
}

async function handle(payload: Record<string, unknown>) {
  const op = payload.op
  if (!op || typeof op !== 'string') {
    return NextResponse.json({ error: '缺少 op 参数' }, { status: 400 })
  }
  try {
    const res = await runPy(payload)
    if (res && res.error) {
      return NextResponse.json({ error: res.error, op: res.op, elapsedMs: res.elapsedMs }, { status: 400 })
    }
    return NextResponse.json({ ...res, source: 'duckdb' })
  } catch (e: any) {
    const status = /超时/.test(e?.message || '') ? 504 : 500
    return NextResponse.json({ error: e?.message || String(e), op }, { status })
  }
}

export async function GET(req: NextRequest) {
  const op = req.nextUrl.searchParams.get('op') || ''
  // 仅允许无副作用的 op 通过 GET（带参数的走 POST）
  const extra: Record<string, string> = {}
  if (op === 'dictionary') {
    const t = req.nextUrl.searchParams.get('table')
    if (t) extra.table = t
  }
  return handle({ op, ...extra })
}

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() }
  catch { return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 }) }
  return handle(body || {})
}
