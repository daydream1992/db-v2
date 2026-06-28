import { NextRequest, NextResponse } from 'next/server'
import { APP_CONFIG } from '@/lib/dataops/config'

const GITHUB_API = 'https://api.github.com'

interface PushBody {
  tables?: unknown
  dictionary?: unknown
  commitMessage?: string
}

async function getFileSha(path: string, token: string): Promise<string | null> {
  const repoSlug = APP_CONFIG.gitHubRepo.replace('https://github.com/', '')
  const url = `${GITHUB_API}/repos/${repoSlug}/contents/${path}?ref=${APP_CONFIG.gitHubBranch}`
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Failed to get SHA for ${path}: HTTP ${res.status} ${text}`)
  }
  const data = await res.json() as { sha?: string }
  return data.sha ?? null
}

async function pushFileToGitHub(
  path: string,
  content: string,
  sha: string | null,
  commitMessage: string,
  token: string
): Promise<{ success: boolean; sha?: string; error?: string }> {
  const repoSlug = APP_CONFIG.gitHubRepo.replace('https://github.com/', '')
  const url = `${GITHUB_API}/repos/${repoSlug}/contents/${path}`

  const body: Record<string, unknown> = {
    message: commitMessage,
    content: Buffer.from(content).toString('base64'),
    branch: APP_CONFIG.gitHubBranch,
  }

  // SHA is required for updating an existing file
  if (sha) {
    body.sha = sha
  }

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { success: false, error: `HTTP ${res.status}: ${text}` }
  }

  const data = await res.json() as { content?: { sha?: string } }
  return { success: true, sha: data.content?.sha }
}

export async function POST(request: NextRequest) {
  const token = APP_CONFIG.gitHubToken
  if (!token) {
    return NextResponse.json(
      { error: 'GITHUB_TOKEN is not configured', success: false },
      { status: 403 }
    )
  }

  let body: PushBody
  try {
    body = await request.json() as PushBody
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', success: false },
      { status: 400 }
    )
  }

  const commitMessage = body.commitMessage || `dataops: sync config update ${new Date().toISOString().slice(0, 19)}`
  const results: Record<string, { success: boolean; error?: string }> = {}

  try {
    // Push tables.json if provided
    if (body.tables !== undefined) {
      const tablesPath = 'config/tables.json'
      const tablesContent = JSON.stringify(body.tables, null, 2)
      const tablesSha = await getFileSha(tablesPath, token)
      const result = await pushFileToGitHub(tablesPath, tablesContent, tablesSha, commitMessage, token)
      results.tables = { success: result.success, error: result.error }
    }

    // Push data_dictionary.json if provided
    if (body.dictionary !== undefined) {
      const dictPath = 'config/data_dictionary.json'
      const dictContent = JSON.stringify(body.dictionary, null, 2)
      const dictSha = await getFileSha(dictPath, token)
      const result = await pushFileToGitHub(dictPath, dictContent, dictSha, commitMessage, token)
      results.dictionary = { success: result.success, error: result.error }
    }

    const allSuccess = Object.values(results).every(r => r.success)

    return NextResponse.json({
      success: allSuccess,
      results,
      pushedAt: new Date().toISOString(),
      repo: APP_CONFIG.gitHubRepo.replace('https://github.com/', ''),
      branch: APP_CONFIG.gitHubBranch,
      commitMessage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json(
      { error: 'GitHub push failed', details: message, results, success: false },
      { status: 502 }
    )
  }
}
