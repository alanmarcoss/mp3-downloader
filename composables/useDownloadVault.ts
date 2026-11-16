import { useIntervalFn, useLocalStorage } from '@vueuse/core'
import type { CacheStatusResponse, TrackMetadata } from '~/types/track'

export function useDownloadVault() {
  const items = useLocalStorage<TrackMetadata[]>('wavelength:vault:v1', [])
  const serverStatuses = useState<CacheStatusResponse['statuses']>('vault-statuses', () => ({}))
  const storageMode = useState<'vercel-blob' | 'local-disk'>('vault-storage-mode', () => 'vercel-blob')
  const ttlHours = useState<number>('vault-ttl-hours', () => 24)
  const now = ref(Date.now())
  const isSyncing = ref(false)

  if (import.meta.client) {
    useIntervalFn(() => {
      now.value = Date.now()
    }, 15_000)
  }

  function isTrackExpired(track: TrackMetadata): boolean {
    const serverState = serverStatuses.value[track.cacheKey]
    if (serverState && serverState.active === false) {
      return true
    }
    const exp = serverState?.expiresAt ?? track.expiresAt
    return now.value >= exp
  }

  function upsertTrack(track: TrackMetadata) {
    const filtered = items.value.filter(t => t.cacheKey !== track.cacheKey)
    items.value = [track, ...filtered].slice(0, 50)
    serverStatuses.value = {
      ...serverStatuses.value,
      [track.cacheKey]: {
        active: true,
        expiresAt: track.expiresAt,
        downloadUrl: track.downloadUrl,
        streamUrl: track.streamUrl,
      },
    }
    storageMode.value = track.storageMode
  }

  function removeTrack(cacheKey: string) {
    items.value = items.value.filter(t => t.cacheKey !== cacheKey)
  }

  function clearVault() {
    items.value = []
  }

  async function syncWithServer() {
    if (!import.meta.client) return
    isSyncing.value = true
    try {
      const keys = items.value.map(t => t.cacheKey)
      const res = await $fetch<CacheStatusResponse>('/api/cache/status', {
        method: 'POST',
        body: { keys },
      })
      storageMode.value = res.storageMode
      ttlHours.value = res.ttlHours
      serverStatuses.value = res.statuses

      // Update refreshed URLs or expiry timestamps from server
      items.value = items.value.map((item) => {
        const s = res.statuses[item.cacheKey]
        if (s?.active) {
          return {
            ...item,
            expiresAt: s.expiresAt ?? item.expiresAt,
            downloadUrl: s.downloadUrl ?? item.downloadUrl,
            streamUrl: s.streamUrl ?? item.streamUrl,
          }
        }
        return item
      })
    }
    catch {
      // Non-fatal
    }
    finally {
      isSyncing.value = false
    }
  }

  return {
    items,
    now,
    storageMode,
    ttlHours,
    isSyncing,
    isTrackExpired,
    upsertTrack,
    removeTrack,
    clearVault,
    syncWithServer,
  }
}
