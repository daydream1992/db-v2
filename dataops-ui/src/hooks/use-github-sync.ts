'use client'

import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'

export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'pushing'

interface GitHubSyncData {
  tables: unknown
  dictionary: unknown
  syncedAt: string
  source: string
  repo: string
  branch: string
  _cached?: boolean
  _cachedAt?: string
  _stale?: boolean
  _staleReason?: string
  _forceRefreshed?: boolean
}

interface PushResult {
  success: boolean
  results: Record<string, { success: boolean; error?: string }>
  pushedAt: string
  repo: string
  branch: string
  commitMessage: string
  error?: string
  details?: string
}

interface PushParams {
  tables?: unknown
  dictionary?: unknown
  commitMessage?: string
}

export function useGitHubSync() {
  const queryClient = useQueryClient()

  const query = useQuery<GitHubSyncData>({
    queryKey: ['github-sync'],
    queryFn: async () => {
      const res = await fetch('/api/github-sync')
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(
          (errorData as { error?: string; details?: string }).details ||
            (errorData as { error?: string }).error ||
            `HTTP ${res.status}`
        )
      }
      return res.json()
    },
    refetchInterval: 30 * 60 * 1000, // Auto-refetch every 30 minutes
    staleTime: 5 * 60 * 1000, // Consider data stale after 5 minutes
  })

  // Force sync mutation (POST to invalidate cache and re-fetch)
  const syncNowMutation = useMutation({
    mutationFn: async (): Promise<GitHubSyncData> => {
      const res = await fetch('/api/github-sync', { method: 'POST' })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(
          (errorData as { error?: string; details?: string }).details ||
            (errorData as { error?: string }).error ||
            `HTTP ${res.status}`
        )
      }
      return res.json()
    },
    onSuccess: (data) => {
      // Update the query cache with fresh data
      queryClient.setQueryData(['github-sync'], data)
    },
  })

  // Push mutation
  const pushMutation = useMutation<PushResult, Error, PushParams>({
    mutationFn: async (params: PushParams): Promise<PushResult> => {
      const res = await fetch('/api/github-sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      const data = await res.json() as PushResult
      if (!res.ok) {
        throw new Error(data.error || data.details || `HTTP ${res.status}`)
      }
      return data
    },
    onSuccess: () => {
      // Invalidate cache so next read gets fresh data from GitHub
      queryClient.invalidateQueries({ queryKey: ['github-sync'] })
    },
  })

  // Determine sync status
  const getSyncStatus = (): SyncStatus => {
    if (pushMutation.isPending) return 'pushing'
    if (syncNowMutation.isPending) return 'syncing'
    if (query.isLoading && !query.data) return 'syncing'
    if (query.error || syncNowMutation.error) return 'error'
    if (query.data) {
      if (query.data._stale) return 'error'
      return 'synced'
    }
    return 'idle'
  }

  // Get last sync time
  const getLastSyncTime = (): string | null => {
    if (syncNowMutation.data?.syncedAt) return syncNowMutation.data.syncedAt
    if (query.data?.syncedAt) return query.data.syncedAt
    return null
  }

  return {
    data: query.data ?? null,
    loading: query.isLoading && !query.data,
    error: query.error?.message ?? syncNowMutation.error?.message ?? null,
    staleError: query.data?._stale ? (query.data._staleReason ?? null) : null,
    isStale: query.data?._stale ?? false,
    syncStatus: getSyncStatus(),
    lastSyncTime: getLastSyncTime(),
    cachedAt: query.data?._cachedAt ?? null,
    isCached: query.data?._cached ?? false,
    refetch: query.refetch,
    syncNow: syncNowMutation.mutate,
    syncNowReset: syncNowMutation.reset,
    isSyncing: syncNowMutation.isPending,
    push: pushMutation.mutate,
    pushReset: pushMutation.reset,
    isPushing: pushMutation.isPending,
    pushResult: pushMutation.data ?? null,
    pushError: pushMutation.error?.message ?? null,
  }
}
