import { promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

let cachedClientId: string | null = null
let cachedClientIdAt = 0
const CLIENT_ID_TTL_MS = 6 * 60 * 60 * 1000

async function discoverSoundCloudClientId(forceRefresh = false): Promise<string> {
  const config = useRuntimeConfig()
  const configured = (config.soundcloudClientId || process.env.SOUNDCLOUD_CLIENT_ID || '').trim()
  if (configured && !forceRefresh) {
    return configured
  }

  if (!forceRefresh && cachedClientId && Date.now() - cachedClientIdAt < CLIENT_ID_TTL_MS) {
    return cachedClientId
  }

  const homeRes = await fetch('https://soundcloud.com', {
    headers: { 'User-Agent': BROWSER_UA },
    signal: AbortSignal.timeout(10000),
  })

  if (!homeRes.ok) {
    throw new Error(`Failed to reach SoundCloud (${homeRes.status})`)
  }

  const html = await homeRes.text()
  const scriptUrls = Array.from(
    html.matchAll(/<script[^>]+crossorigin[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g),
    m => m[1],
  )

  // SoundCloud puts client_id in the last few asset bundles; inspect from the end first
  const candidates = scriptUrls.slice(-6).reverse()

  for (const scriptUrl of candidates) {
    try {
      const jsRes = await fetch(scriptUrl, {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(8000),
      })
      if (!jsRes.ok) continue
      const js = await jsRes.text()
      const match =
        js.match(/client_id\s*:\s*"([a-zA-Z0-9]{32})"/) ||
        js.match(/client_id="([a-zA-Z0-9]{32})"/)
      if (match?.[1]) {
        cachedClientId = match[1]
        cachedClientIdAt = Date.now()
        return cachedClientId
      }
    }
    catch {
      // try next bundle
    }
  }

  throw new Error('Unable to discover SoundCloud client_id. Set SOUNDCLOUD_CLIENT_ID in environment variables.')
}

interface SoundCloudTranscoding {
  url: string
  preset: string
  duration: number
  snipped?: boolean
  format: {
    protocol: 'progressive' | 'hls' | string
    mime_type: string
  }
}

interface SoundCloudTrackObject {
  id: number
  kind: string
  title: string
  duration: number
  full_duration?: number
  artwork_url?: string | null
  permalink_url: string
  policy?: string
  track_authorization?: string
  user?: {
    username?: string
    avatar_url?: string | null
  }
  publisher_metadata?: {
    artist?: string
  }
  media?: {
    transcodings?: SoundCloudTranscoding[]
  }
}

async function resolveSoundCloudTrack(canonicalUrl: string): Promise<{
  track: SoundCloudTrackObject
  clientId: string
}> {
  let clientId = await discoverSoundCloudClientId(false)

  const attemptResolve = async (cid: string) => {
    const apiUrl = new URL('https://api-v2.soundcloud.com/resolve')
    apiUrl.searchParams.set('url', canonicalUrl)
    apiUrl.searchParams.set('client_id', cid)

    return fetch(apiUrl.toString(), {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'application/json',
        'Origin': 'https://soundcloud.com',
        'Referer': 'https://soundcloud.com/',
      },
      signal: AbortSignal.timeout(10000),
    })
  }

  let res = await attemptResolve(clientId)
  if (res.status === 401 || res.status === 403) {
    clientId = await discoverSoundCloudClientId(true)
    res = await attemptResolve(clientId)
  }

  if (res.status === 404) {
    throw createError({
      statusCode: 404,
      statusMessage: 'SoundCloud track not found or is private.',
    })
  }

  if (!res.ok) {
    throw createError({
      statusCode: 502,
      statusMessage: `SoundCloud API returned HTTP ${res.status}.`,
    })
  }

  const data = (await res.json()) as SoundCloudTrackObject
  if (data.kind !== 'track') {
    throw createError({
      statusCode: 400,
      statusMessage: `Unsupported SoundCloud resource (${data.kind}). Please paste a single track URL.`,
    })
  }

  return { track: data, clientId }
}

function normalizeSoundCloudMetadata(track: SoundCloudTrackObject) {
  const rawArt = track.artwork_url || track.user?.avatar_url || ''
  const thumbnail = rawArt
    ? rawArt.replace('-large.', '-t500x500.')
    : ''

  const artist =
    track.publisher_metadata?.artist?.trim() ||
    track.user?.username?.trim() ||
    'Unknown Artist'

  // If title already starts with "Artist - Track", keep clean title & artist
  let title = (track.title || 'Untitled Track').trim()
  const dashMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  const finalArtist = !track.publisher_metadata?.artist && dashMatch ? dashMatch[1].trim() : artist
  if (!track.publisher_metadata?.artist && dashMatch) {
    title = dashMatch[2].trim()
  }

  return {
    title,
    artist: finalArtist,
    duration: Math.round((track.duration || 0) / 1000),
    thumbnail,
  }
}

export async function inspectSoundCloudTrack(canonicalUrl: string) {
  const { track } = await resolveSoundCloudTrack(canonicalUrl)
  return normalizeSoundCloudMetadata(track)
}

function scoreTranscoding(t: SoundCloudTranscoding): number {
  const protocol = t.format?.protocol || ''
  const mime = (t.format?.mime_type || '').toLowerCase().split(';')[0].trim()
  const preset = (t.preset || '').toLowerCase()
  const snipPenalty = t.snipped ? -500 : 0

  // Deprioritize broken/deprecated SoundCloud master mpegurl ("abr_sq") endpoints which frequently 404
  if (mime === 'audio/mpegurl' || preset === 'abr_sq') {
    return -100 + snipPenalty
  }
  if (protocol === 'progressive' && mime === 'audio/mpeg') {
    return 100 + snipPenalty
  }
  if (protocol === 'progressive') {
    return 90 + snipPenalty
  }
  if (preset.includes('160k') || preset.includes('hq')) {
    return 85 + snipPenalty
  }
  if (protocol === 'hls' && mime === 'audio/mpeg') {
    return 80 + snipPenalty
  }
  if (protocol === 'hls' && mime === 'audio/ogg') {
    return 75 + snipPenalty
  }
  if (protocol === 'hls' && mime === 'audio/mp4') {
    return 70 + snipPenalty
  }
  return 50 + snipPenalty
}

export async function downloadSoundCloudRawAudio(
  canonicalUrl: string,
  destPath: string,
  maxDurationSeconds: number,
) {
  const { track, clientId } = await resolveSoundCloudTrack(canonicalUrl)
  const meta = normalizeSoundCloudMetadata(track)

  if (meta.duration > maxDurationSeconds) {
    throw createError({
      statusCode: 400,
      statusMessage: `Track duration (${Math.round(meta.duration / 60)} min) exceeds maximum allowed (${Math.round(maxDurationSeconds / 60)} min).`,
    })
  }

  const transcodings = track.media?.transcodings || []
  if (transcodings.length === 0) {
    throw createError({
      statusCode: 422,
      statusMessage: 'No downloadable audio streams are available for this SoundCloud track.',
    })
  }

  // Sort transcodings best-first and try each in order if one returns 404/error
  const ranked = [...transcodings].sort((a, b) => scoreTranscoding(b) - scoreTranscoding(a))

  let chosen: SoundCloudTranscoding | null = null
  let mediaUrl = ''
  let lastStatus = 0

  for (const candidate of ranked) {
    try {
      const streamInfoUrl = new URL(candidate.url)
      streamInfoUrl.searchParams.set('client_id', clientId)
      if (track.track_authorization) {
        streamInfoUrl.searchParams.set('track_authorization', track.track_authorization)
      }

      const streamInfoRes = await fetch(streamInfoUrl.toString(), {
        headers: {
          'User-Agent': BROWSER_UA,
          'Accept': 'application/json',
          'Origin': 'https://soundcloud.com',
          'Referer': 'https://soundcloud.com/',
        },
        signal: AbortSignal.timeout(10000),
      })

      lastStatus = streamInfoRes.status
      if (!streamInfoRes.ok) {
        continue
      }

      const payload = (await streamInfoRes.json()) as { url?: string }
      if (payload?.url) {
        chosen = candidate
        mediaUrl = payload.url
        break
      }
    }
    catch {
      // Try next candidate transcoding
    }
  }

  if (!chosen || !mediaUrl) {
    throw createError({
      statusCode: 502,
      statusMessage: `Failed to resolve SoundCloud audio stream (${lastStatus || 'no valid transcoding'}).`,
    })
  }

  if (chosen.format?.protocol === 'progressive') {
    const audioRes = await fetch(mediaUrl, {
      headers: { 'User-Agent': BROWSER_UA },
    })
    if (!audioRes.ok || !audioRes.body) {
      throw new Error(`Failed to fetch progressive SoundCloud audio (${audioRes.status})`)
    }
    await pipeline(Readable.fromWeb(audioRes.body as any), createWriteStream(destPath))
  }
  else {
    // HLS M3U8 playlist assembly
    const playlistRes = await fetch(mediaUrl, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(10000),
    })
    if (!playlistRes.ok) {
      throw new Error(`Failed to fetch SoundCloud HLS playlist (${playlistRes.status})`)
    }
    const m3u8 = await playlistRes.text()
    const segmentUrls: string[] = []

    for (const rawLine of m3u8.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      if (line.startsWith('#EXT-X-MAP:')) {
        const uriMatch = line.match(/URI="([^"]+)"/)
        if (uriMatch?.[1]) {
          segmentUrls.push(new URL(uriMatch[1], mediaUrl).toString())
        }
      }
      else if (!line.startsWith('#')) {
        segmentUrls.push(new URL(line, mediaUrl).toString())
      }
    }

    if (segmentUrls.length === 0) {
      throw new Error('SoundCloud HLS playlist contained zero audio segments.')
    }

    const handle = await fs.open(destPath, 'w')
    try {
      // Download segments in small batches of 6 for speed while preserving exact byte order
      const batchSize = 6
      for (let i = 0; i < segmentUrls.length; i += batchSize) {
        const batch = segmentUrls.slice(i, i + batchSize)
        const buffers = await Promise.all(
          batch.map(async (segUrl) => {
            const segRes = await fetch(segUrl, {
              headers: { 'User-Agent': BROWSER_UA },
              signal: AbortSignal.timeout(15000),
            })
            if (!segRes.ok) {
              throw new Error(`HLS segment download failed (${segRes.status})`)
            }
            return Buffer.from(await segRes.arrayBuffer())
          }),
        )
        for (const buf of buffers) {
          await handle.write(buf)
        }
      }
    }
    finally {
      await handle.close()
    }
  }

  return meta
}
