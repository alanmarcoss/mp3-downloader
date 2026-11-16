import type { CacheStatusResponse } from '~/types/track'
import { VALID_CACHE_KEY_RE } from '~/server/utils/cacheKey'
import { getCachedTrack, getStorageConfig } from '~/server/utils/storage'

export default defineEventHandler(async (event): Promise<CacheStatusResponse> => {
  const body = await readBody<{ keys?: string[] }>(event).catch(() => ({ keys: [] }))
  const rawKeys = Array.isArray(body?.keys) ? body.keys.slice(0, 50) : []
  const validKeys = rawKeys.filter(k => typeof k === 'string' && VALID_CACHE_KEY_RE.test(k))

  const { storageMode, ttlHours } = getStorageConfig()
  const statuses: CacheStatusResponse['statuses'] = {}

  await Promise.all(
    validKeys.map(async (key) => {
      const cached = await getCachedTrack(key)
      if (cached) {
        statuses[key] = {
          active: true,
          expiresAt: cached.expiresAt,
          downloadUrl: cached.downloadUrl,
          streamUrl: cached.streamUrl,
        }
      }
      else {
        statuses[key] = { active: false }
      }
    }),
  )

  return {
    storageMode,
    ttlHours,
    statuses,
  }
})
