import type { Provider } from '~/types/track'

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
])

const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'snd.sc',
])

export interface ParsedMediaUrl {
  provider: Provider
  canonicalUrl: string
  youtubeId?: string
  isShortLink?: boolean
  isPlaylist?: boolean
}

export function extractYouTubeId(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl.trim())
    const host = url.hostname.toLowerCase()
    if (!YOUTUBE_HOSTS.has(host)) return null

    if (host === 'youtu.be' || host === 'www.youtu.be') {
      const id = url.pathname.split('/').filter(Boolean)[0]
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
    }

    const vParam = url.searchParams.get('v')
    if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) {
      return vParam
    }

    const segments = url.pathname.split('/').filter(Boolean)
    if (
      segments.length >= 2 &&
      ['shorts', 'embed', 'live', 'v'].includes(segments[0]) &&
      /^[a-zA-Z0-9_-]{11}$/.test(segments[1])
    ) {
      return segments[1]
    }

    return null
  }
  catch {
    return null
  }
}

export function parseMediaUrl(rawInput: string): ParsedMediaUrl | null {
  const trimmed = rawInput.trim()
  if (!trimmed) return null

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withProtocol)
  }
  catch {
    return null
  }

  const host = url.hostname.toLowerCase()

  if (YOUTUBE_HOSTS.has(host)) {
    const videoId = extractYouTubeId(url.toString())
    if (!videoId) {
      if (url.pathname.includes('/playlist') || url.searchParams.has('list')) {
        return {
          provider: 'youtube',
          canonicalUrl: url.toString(),
          isPlaylist: true,
        }
      }
      return null
    }

    return {
      provider: 'youtube',
      youtubeId: videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    }
  }

  if (SOUNDCLOUD_HOSTS.has(host)) {
    if (host === 'on.soundcloud.com' || host === 'snd.sc') {
      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.length === 0) return null
      return {
        provider: 'soundcloud',
        canonicalUrl: `https://${host}/${segments[0]}`,
        isShortLink: true,
      }
    }

    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.length < 2) return null

    const reservedFirst = new Set(['discover', 'stream', 'you', 'search', 'upload', 'Charts', 'charts', 'messages', 'settings'])
    if (reservedFirst.has(segments[0])) return null

    if (segments[1] === 'sets' || segments[1] === 'albums') {
      return {
        provider: 'soundcloud',
        canonicalUrl: `https://soundcloud.com/${segments.slice(0, 3).join('/')}`,
        isPlaylist: true,
      }
    }

    // Preserve secret token path segment `/s-xxxxx` for private SoundCloud links
    const cleanSegments = segments[2]?.startsWith('s-')
      ? segments.slice(0, 3)
      : segments.slice(0, 2)

    return {
      provider: 'soundcloud',
      canonicalUrl: `https://soundcloud.com/${cleanSegments.join('/')}`,
    }
  }

  return null
}

export function detectProvider(rawInput: string): Provider | null {
  return parseMediaUrl(rawInput)?.provider ?? null
}
