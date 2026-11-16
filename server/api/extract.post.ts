import path from 'node:path'
import type { AudioBitrate, ExtractRequest, ExtractResponse, TrackMetadata } from '~/types/track'
import { buildCacheKey, resolveAndParseMediaUrl } from '~/server/utils/cacheKey'
import { transcodeToMp3, withTempWorkDir } from '~/server/utils/ffmpeg'
import { downloadSoundCloudRawAudio } from '~/server/utils/soundcloud'
import { cleanupExpiredTracks, getCachedTrack, saveCachedTrack } from '~/server/utils/storage'
import { downloadYouTubeRawAudio } from '~/server/utils/youtube'
import { sanitizeFilename } from '~/utils/format'

const inFlightExtractions = new Map<string, Promise<TrackMetadata>>()

export default defineEventHandler(async (event): Promise<ExtractResponse> => {
  const body = await readBody<ExtractRequest>(event)
  const rawUrl = body?.url?.trim() || ''
  const bitrate: AudioBitrate = [128, 192, 320].includes(Number(body?.bitrate))
    ? (Number(body?.bitrate) as AudioBitrate)
    : 192
  const forceRefresh = Boolean(body?.forceRefresh)

  const config = useRuntimeConfig()
  const maxDurationSeconds = Number(config.maxDurationSeconds || 3600)

  const parsed = await resolveAndParseMediaUrl(rawUrl)
  const cacheKey = buildCacheKey(parsed, bitrate)

  if (!forceRefresh) {
    const existing = await getCachedTrack(cacheKey)
    if (existing) {
      return {
        track: existing,
        cached: true,
      }
    }
  }

  // Deduplicate concurrent identical conversions on the same warm instance
  let pending = inFlightExtractions.get(cacheKey)
  if (!pending) {
    pending = (async () => {
      return await withTempWorkDir(cacheKey, async (workDir) => {
        const rawInputPath = path.join(workDir, 'raw-input')
        const mp3OutputPath = path.join(workDir, 'output.mp3')

        const extractedMeta = parsed.provider === 'youtube'
          ? await downloadYouTubeRawAudio(
              parsed.youtubeId!,
              parsed.canonicalUrl,
              rawInputPath,
              maxDurationSeconds,
            )
          : await downloadSoundCloudRawAudio(
              parsed.canonicalUrl,
              rawInputPath,
              maxDurationSeconds,
            )

        await transcodeToMp3({
          inputPath: rawInputPath,
          outputPath: mp3OutputPath,
          bitrate,
          title: extractedMeta.title,
          artist: extractedMeta.artist,
          thumbnailUrl: extractedMeta.thumbnail,
        })

        const baseName = sanitizeFilename(
          extractedMeta.artist && !extractedMeta.title.toLowerCase().includes(extractedMeta.artist.toLowerCase())
            ? `${extractedMeta.artist} - ${extractedMeta.title}`
            : extractedMeta.title,
        )
        const fileName = `${baseName}.mp3`

        const saved = await saveCachedTrack({
          cacheKey,
          provider: parsed.provider,
          sourceUrl: rawUrl,
          canonicalUrl: parsed.canonicalUrl,
          title: extractedMeta.title,
          artist: extractedMeta.artist,
          duration: extractedMeta.duration,
          thumbnail: extractedMeta.thumbnail,
          bitrate,
          fileName,
          mp3FilePath: mp3OutputPath,
        })

        return saved
      })
    })()

    inFlightExtractions.set(cacheKey, pending)
    pending.finally(() => {
      inFlightExtractions.delete(cacheKey)
    })
  }

  const track = await pending

  // Opportunistic non-blocking sweep of expired blobs (>24h) in background
  if (typeof event.waitUntil === 'function') {
    event.waitUntil(cleanupExpiredTracks().catch(() => {}))
  }

  return {
    track,
    cached: false,
  }
})
