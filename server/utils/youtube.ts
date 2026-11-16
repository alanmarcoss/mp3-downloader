import { spawn } from 'node:child_process'
import { createWriteStream, promises as fs } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ytdl from '@distube/ytdl-core'
import { Innertube, UniversalCache } from 'youtubei.js'
import { ProxyAgent, fetch as undiciFetch } from 'undici'

interface CookieItem {
  name: string
  value: string
  domain?: string
  path?: string
}

function parseYouTubeCookies(raw: string): { list: CookieItem[], header: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { list: [], header: '' }

  // Support EditThisCookie / Cookie-Editor JSON array format
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Array<Record<string, any>>
      const list: CookieItem[] = parsed
        .filter(c => c && typeof c.name === 'string' && typeof c.value === 'string')
        .map(c => ({
          name: c.name,
          value: c.value,
          domain: c.domain || '.youtube.com',
          path: c.path || '/',
        }))
      const header = list.map(c => `${c.name}=${c.value}`).join('; ')
      return { list, header }
    }
    catch {
      // fall through
    }
  }

  // Support raw "NAME=VALUE; NAME2=VALUE2" header string
  const list: CookieItem[] = []
  for (const part of trimmed.split(';')) {
    const eqIdx = part.indexOf('=')
    if (eqIdx > 0) {
      const name = part.slice(0, eqIdx).trim()
      const value = part.slice(eqIdx + 1).trim()
      if (name) {
        list.push({ name, value, domain: '.youtube.com', path: '/' })
      }
    }
  }

  return { list, header: list.map(c => `${c.name}=${c.value}`).join('; ') }
}

function getYouTubeRuntimeAuth() {
  const config = useRuntimeConfig()
  const proxy = (config.youtubeProxy || process.env.YOUTUBE_PROXY || '').trim()
  const rawCookies = (config.youtubeCookies || process.env.YOUTUBE_COOKIES || '').trim()
  const cookies = parseYouTubeCookies(rawCookies)

  let ytdlAgent: any = undefined
  try {
    if (proxy) {
      ytdlAgent = ytdl.createProxyAgent(
        { uri: proxy },
        cookies.list.length > 0 ? cookies.list : undefined,
      )
    }
    else if (cookies.list.length > 0) {
      ytdlAgent = ytdl.createAgent(cookies.list)
    }
  }
  catch {
    ytdlAgent = undefined
  }

  return {
    proxy,
    cookies,
    ytdlAgent,
  }
}

function cleanYouTubeTitleAndArtist(rawTitle: string, channelName: string) {
  let artist = channelName.replace(/\s*-\s*Topic$/i, '').trim() || 'YouTube'
  let title = rawTitle.trim()

  const dashMatch = title.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dashMatch) {
    artist = dashMatch[1].trim()
    title = dashMatch[2]
      .replace(/\s*\((Official\s+(Music\s+)?Video|Official\s+Audio|Lyrics?|Visualizer|HD|4K)\)\s*/gi, ' ')
      .replace(/\s*\[(Official\s+(Music\s+)?Video|Official\s+Audio|Lyrics?|Visualizer|HD|4K)\]\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return { title: title || rawTitle, artist }
}

export async function inspectYouTubeTrack(videoId: string, canonicalUrl: string) {
  const { ytdlAgent } = getYouTubeRuntimeAuth()
  const fallbackThumb = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`

  try {
    const info = await ytdl.getBasicInfo(canonicalUrl, {
      agent: ytdlAgent,
    })
    const details = info.videoDetails
    const { title, artist } = cleanYouTubeTitleAndArtist(
      details.title || 'Untitled Track',
      details.author?.name || 'YouTube',
    )

    return {
      title,
      artist,
      duration: Number(details.lengthSeconds || 0),
      thumbnail: fallbackThumb,
    }
  }
  catch {
    // Ultra-fast oEmbed fallback (works from all datacenter IPs without auth)
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`
    const res = await fetch(oembedUrl, {
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      throw createError({
        statusCode: 404,
        statusMessage: 'YouTube video not found or is unavailable.',
      })
    }
    const data = (await res.json()) as { title?: string, author_name?: string }
    const { title, artist } = cleanYouTubeTitleAndArtist(
      data.title || 'Untitled Track',
      data.author_name || 'YouTube',
    )
    return {
      title,
      artist,
      duration: 0,
      thumbnail: fallbackThumb,
    }
  }
}

async function tryDownloadViaYtdlCore(
  videoId: string,
  canonicalUrl: string,
  destPath: string,
  maxDurationSeconds: number,
) {
  const { ytdlAgent } = getYouTubeRuntimeAuth()
  const info = await ytdl.getInfo(canonicalUrl, { agent: ytdlAgent })
  const details = info.videoDetails

  if (details.isLiveContent) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Live streams cannot be converted to MP3.',
    })
  }

  const duration = Number(details.lengthSeconds || 0)
  if (duration > maxDurationSeconds) {
    throw createError({
      statusCode: 400,
      statusMessage: `Video duration (${Math.round(duration / 60)} min) exceeds maximum allowed (${Math.round(maxDurationSeconds / 60)} min).`,
    })
  }

  const audioStream = ytdl.downloadFromInfo(info, {
    quality: 'highestaudio',
    filter: 'audioonly',
    agent: ytdlAgent,
    highWaterMark: 1 << 24,
  })

  await pipeline(audioStream, createWriteStream(destPath))

  const stat = await fs.stat(destPath)
  if (stat.size < 1024) {
    throw new Error('Downloaded YouTube stream was empty.')
  }

  const { title, artist } = cleanYouTubeTitleAndArtist(
    details.title || 'Untitled Track',
    details.author?.name || 'YouTube',
  )

  return {
    title,
    artist,
    duration,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  }
}

async function tryDownloadViaInnertube(
  videoId: string,
  destPath: string,
  maxDurationSeconds: number,
) {
  const { proxy, cookies } = getYouTubeRuntimeAuth()
  const dispatcher = proxy ? new ProxyAgent(proxy) : undefined

  const yt = await Innertube.create({
    cache: new UniversalCache(false),
    generate_session_locally: true,
    cookie: cookies.header || undefined,
    fetch: dispatcher
      ? (input: any, init?: any) => undiciFetch(input, { ...init, dispatcher }) as any
      : undefined,
  })

  const basic = await yt.getBasicInfo(videoId)
  const duration = Number(basic.basic_info.duration || 0)

  if (basic.basic_info.is_live) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Live streams cannot be converted to MP3.',
    })
  }

  if (duration > maxDurationSeconds) {
    throw createError({
      statusCode: 400,
      statusMessage: `Video duration (${Math.round(duration / 60)} min) exceeds maximum allowed (${Math.round(maxDurationSeconds / 60)} min).`,
    })
  }

  const clientsToTry: Array<'IOS' | 'ANDROID' | 'TV_EMBEDDED' | 'YTMUSIC'> = [
    'IOS',
    'ANDROID',
    'YTMUSIC',
    'TV_EMBEDDED',
  ]

  let lastErr: any = null
  for (const client of clientsToTry) {
    try {
      const webStream = await yt.download(videoId, {
        type: 'audio',
        quality: 'best',
        client: client as any,
      })
      await pipeline(Readable.fromWeb(webStream as any), createWriteStream(destPath))
      const stat = await fs.stat(destPath)
      if (stat.size > 1024) {
        const { title, artist } = cleanYouTubeTitleAndArtist(
          basic.basic_info.title || 'Untitled Track',
          basic.basic_info.author || 'YouTube',
        )
        return {
          title,
          artist,
          duration,
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        }
      }
    }
    catch (err) {
      lastErr = err
    }
  }

  throw lastErr || new Error('Innertube download clients failed.')
}

async function tryDownloadViaLocalYtDlp(
  videoId: string,
  canonicalUrl: string,
  destPath: string,
  maxDurationSeconds: number,
) {
  const candidates = ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp']
  let ytdlpBin: string | null = null
  for (const bin of candidates) {
    try {
      await fs.access(bin)
      ytdlpBin = bin
      break
    }
    catch {
      // ignore
    }
  }

  if (!ytdlpBin) {
    throw new Error('yt-dlp binary not present on this host')
  }

  const { proxy } = getYouTubeRuntimeAuth()
  const metaArgs = [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    ...(proxy ? ['--proxy', proxy] : []),
    canonicalUrl,
  ]

  const metaJson = await new Promise<any>((resolve, reject) => {
    const proc = spawn(ytdlpBin!, metaArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    proc.stdout.on('data', d => (out += d.toString()))
    proc.stderr.on('data', d => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(out))
        }
        catch (e) {
          reject(e)
        }
      }
      else {
        reject(new Error(err || `yt-dlp metadata exited ${code}`))
      }
    })
  })

  const duration = Number(metaJson.duration || 0)
  if (duration > maxDurationSeconds) {
    throw createError({
      statusCode: 400,
      statusMessage: `Video duration (${Math.round(duration / 60)} min) exceeds maximum allowed (${Math.round(maxDurationSeconds / 60)} min).`,
    })
  }

  await fs.rm(destPath, { force: true }).catch(() => {})

  await new Promise<void>((resolve, reject) => {
    const dlArgs = [
      '-f',
      'bestaudio/best',
      '--no-playlist',
      '--no-part',
      '-o',
      destPath,
      ...(proxy ? ['--proxy', proxy] : []),
      canonicalUrl,
    ]
    const proc = spawn(ytdlpBin!, dlArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', d => (err += d.toString()))
    proc.on('error', reject)
    proc.on('close', code => (code === 0 ? resolve() : reject(new Error(err || `yt-dlp exited ${code}`))))
  })

  const { title, artist } = cleanYouTubeTitleAndArtist(
    metaJson.track || metaJson.title || 'Untitled Track',
    metaJson.artist || metaJson.uploader || metaJson.channel || 'YouTube',
  )

  return {
    title,
    artist,
    duration,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  }
}

export async function downloadYouTubeRawAudio(
  videoId: string,
  canonicalUrl: string,
  destPath: string,
  maxDurationSeconds: number,
) {
  const errors: string[] = []

  // Strategy 1: @distube/ytdl-core
  try {
    return await tryDownloadViaYtdlCore(videoId, canonicalUrl, destPath, maxDurationSeconds)
  }
  catch (err: any) {
    if (err?.statusCode === 400) throw err
    errors.push(`ytdl-core: ${err?.message || String(err)}`)
  }

  // Strategy 2: youtubei.js (Innertube multi-client)
  try {
    await fs.rm(destPath, { force: true }).catch(() => {})
    return await tryDownloadViaInnertube(videoId, destPath, maxDurationSeconds)
  }
  catch (err: any) {
    if (err?.statusCode === 400) throw err
    errors.push(`innertube: ${err?.message || String(err)}`)
  }

  // Strategy 3: Optional local yt-dlp fallback (dev / self-hosted environments)
  try {
    await fs.rm(destPath, { force: true }).catch(() => {})
    return await tryDownloadViaLocalYtDlp(videoId, canonicalUrl, destPath, maxDurationSeconds)
  }
  catch (err: any) {
    if (err?.statusCode === 400) throw err
    errors.push(`yt-dlp: ${err?.message || String(err)}`)
  }

  const combined = errors.join(' | ')
  const isBotBlock = /bot|sign in|403|429|confirm/i.test(combined)

  throw createError({
    statusCode: 502,
    statusMessage: isBotBlock
      ? 'YouTube rate-limited or bot-checked this server IP. Configure YOUTUBE_COOKIES or YOUTUBE_PROXY in your Vercel environment variables.'
      : `Could not extract YouTube audio stream (${errors[0] || 'unknown error'}).`,
  })
}
