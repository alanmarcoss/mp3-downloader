import type { AudioBitrate, InspectResponse } from '~/types/track'
import { buildCacheKey, resolveAndParseMediaUrl } from '~/server/utils/cacheKey'
import { getCachedTrack } from '~/server/utils/storage'
import { inspectSoundCloudTrack } from '~/server/utils/soundcloud'
import { inspectYouTubeTrack } from '~/server/utils/youtube'

export default defineEventHandler(async (event): Promise<InspectResponse> => {
  const body = await readBody<{ url?: string, bitrate?: AudioBitrate }>(event)
  const rawUrl = body?.url?.trim() || ''
  const bitrate: AudioBitrate = [128, 192, 320].includes(Number(body?.bitrate))
    ? (Number(body?.bitrate) as AudioBitrate)
    : 192

  const parsed = await resolveAndParseMediaUrl(rawUrl)
  const cacheKey = buildCacheKey(parsed, bitrate)

  // Fast path: if already cached, we already have full verified metadata!
  const cachedTrack = await getCachedTrack(cacheKey)
  if (cachedTrack) {
    return {
      provider: parsed.provider,
      canonicalUrl: parsed.canonicalUrl,
      cacheKey,
      title: cachedTrack.title,
      artist: cachedTrack.artist,
      duration: cachedTrack.duration,
      thumbnail: cachedTrack.thumbnail,
      cachedTrack,
    }
  }

  const meta = parsed.provider === 'youtube'
    ? await inspectYouTubeTrack(parsed.youtubeId!, parsed.canonicalUrl)
    : await inspectSoundCloudTrack(parsed.canonicalUrl)

  return {
    provider: parsed.provider,
    canonicalUrl: parsed.canonicalUrl,
    cacheKey,
    title: meta.title,
    artist: meta.artist,
    duration: meta.duration,
    thumbnail: meta.thumbnail,
    cachedTrack: null,
  }
})
