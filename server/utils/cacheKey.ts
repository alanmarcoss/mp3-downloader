import { createHash } from 'node:crypto'
import type { AudioBitrate } from '~/types/track'
import { parseMediaUrl, type ParsedMediaUrl } from '~/utils/url'

export const VALID_CACHE_KEY_RE = /^(yt|sc)-[a-zA-Z0-9_-]{6,24}-(128|192|320)$/

export async function resolveAndParseMediaUrl(rawInput: string): Promise<ParsedMediaUrl> {
  const initial = parseMediaUrl(rawInput)
  if (!initial) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Please enter a valid YouTube or SoundCloud track URL.',
    })
  }

  if (initial.isPlaylist) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlists and sets are not supported in v1. Please paste a single track URL.',
    })
  }

  // Expand SoundCloud mobile shortlinks (on.soundcloud.com / snd.sc)
  if (initial.provider === 'soundcloud' && initial.isShortLink) {
    try {
      const response = await fetch(initial.canonicalUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        },
      })
      const expanded = parseMediaUrl(response.url)
      if (!expanded) {
        throw new Error('Shortlink did not resolve to a SoundCloud track.')
      }
      if (expanded.isPlaylist) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Playlists and sets are not supported in v1. Please paste a single track URL.',
        })
      }
      return expanded
    }
    catch (err: any) {
      if (err?.statusCode) throw err
      throw createError({
        statusCode: 400,
        statusMessage: 'Could not resolve SoundCloud shortlink. Try pasting the full track URL.',
      })
    }
  }

  return initial
}

export function buildCacheKey(parsed: ParsedMediaUrl, bitrate: AudioBitrate): string {
  if (parsed.provider === 'youtube' && parsed.youtubeId) {
    return `yt-${parsed.youtubeId}-${bitrate}`
  }

  const hash = createHash('sha256')
    .update(parsed.canonicalUrl.toLowerCase())
    .digest('hex')
    .slice(0, 16)

  return `sc-${hash}-${bitrate}`
}

export function assertValidCacheKey(key: string): void {
  if (!VALID_CACHE_KEY_RE.test(key)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid cache key.',
    })
  }
}
