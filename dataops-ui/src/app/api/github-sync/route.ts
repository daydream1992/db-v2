import { NextRequest, NextResponse } from 'next/server'
import { APP_CONFIG } from '@/lib/dataops/config'

// In-memory cache with 5-minute TTL
const cache = new Map<string, { data: unknown; timestamp: number; error?: string }>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

const repoSlug = APP_CONFIG.gitHubRepo.replace('https://github.com/', '')
const TABLES_URL =
  `https://raw.githubusercontent.com/${repoSlug}/${APP_CONFIG.gitHubBranch}/config/tables.json`
const DICTIONARY_URL =
  `https://raw.githubusercontent.com/${repoSlug}/${APP_CONFIG.gitHubBranch}/config/data_dictionary.json`

async function fetchJson(url: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Accept': 'application/json' }
  if (APP_CONFIG.gitHubToken) {
    headers['Authorization'] = `Bearer ${APP_CONFIG.gitHubToken}`
  }
  const res = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers,
  })
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText} for ${url}`)
  }
  return await res.json()
}

async function doSync() {
  const [tables, dictionary] = await Promise.all([
    fetchJson(TABLES_URL),
    fetchJson(DICTIONARY_URL),
  ])

  const data = {
    tables,
    dictionary,
    syncedAt: new Date().toISOString(),
    source: 'github',
    repo: repoSlug,
    branch: APP_CONFIG.gitHubBranch,
  }

  // Update cache
  cache.set('github-sync', { data, timestamp: Date.now() })

  return data
}

export async function GET() {
  // Check cache first
  const cached = cache.get('github-sync')
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({
      ...cached.data,
      _cached: true,
      _cachedAt: new Date(cached.timestamp).toISOString(),
      _stale: !!cached.error,
      _staleReason: cached.error || undefined,
    })
  }

  try {
    const data = await doSync()
    return NextResponse.json({ ...data, _cached: false, _stale: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // If we have stale cached data, return it with a stale indicator
    if (cached) {
      return NextResponse.json({
        ...cached.data,
        _cached: true,
        _cachedAt: new Date(cached.timestamp).toISOString(),
        _stale: true,
        _staleReason: message,
      })
    }

    return NextResponse.json(
      { error: 'GitHub sync failed', details: message },
      { status: 502 }
    )
  }
}

export async function POST(_request: NextRequest) {
  // Force cache invalidation and re-fetch from GitHub
  const cached = cache.get('github-sync')
  cache.delete('github-sync')

  try {
    const data = await doSync()
    return NextResponse.json({
      ...data,
      _cached: false,
      _stale: false,
      _forceRefreshed: true,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'

    // If force-refresh fails but we had previous cached data, return stale
    if (cached) {
      // Restore the old cache entry so we still have data
      cache.set('github-sync', { ...cached, error: message })
      return NextResponse.json({
        ...cached.data,
        _cached: true,
        _cachedAt: new Date(cached.timestamp).toISOString(),
        _stale: true,
        _staleReason: `Force refresh failed: ${message}`,
      })
    }

    return NextResponse.json(
      { error: 'GitHub sync failed', details: message },
      { status: 502 }
    )
  }
}
