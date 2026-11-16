import { promises as fs } from 'node:fs'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { del, list, put } from '@vercel/blob'
import type { AudioBitrate, Provider, TrackMetadata } from '~/types/track'
import { assertValidCacheKey } from '~/server/utils/cacheKey'

const LOCAL_CACHE_ROOT = path.resolve(process.cwd(), '.data', 'cache', 'tracks')

export function getStorageConfig() {
  const config = useRuntimeConfig()
  const token = (config.blobReadWriteToken || process.env.BLOB_READ_WRITE_TOKEN || '').trim()
  const ttlHours = Number(config.cacheTtlHours || 24)
  const ttlMs = Math.max(1, ttlHours) * 60 * 60 * 1000

  return {
    token,
    isVercelBlob: Boolean(token),
    storageMode: (token ? 'vercel-blob' : 'local-disk') as 'vercel-blob' | 'local-disk',
    ttlHours,
    ttlMs,
  }
}

export async function getCachedTrack(cacheKey: string): Promise<TrackMetadata | null> {
  assertValidCacheKey(cacheKey)
  const { token, isVercelBlob } = getStorageConfig()

  if (isVercelBlob) {
    try {
      const { blobs } = await list({
        prefix: `tracks/${cacheKey}/`,
        token,
      })

      const metaBlob = blobs.find(b => b.pathname === `tracks/${cacheKey}/meta.json`)
      const audioBlob = blobs.find(b => b.pathname.endsWith('.mp3'))

      if (!metaBlob || !audioBlob) {
        return null
      }

      const res = await fetch(metaBlob.url, { cache: 'no-store' })
      if (!res.ok) return null
      const meta = (await res.json()) as TrackMetadata

      if (Date.now() >= meta.expiresAt) {
        await del(
          blobs.map(b => b.url),
          { token },
        ).catch(() => {})
        return null
      }

      return {
        ...meta,
        streamUrl: audioBlob.url,
        downloadUrl: audioBlob.downloadUrl || `${audioBlob.url}?download=1`,
        storageMode: 'vercel-blob',
      }
    }
    catch {
      return null
    }
  }

  // Local disk fallback (.data/cache/tracks/<cacheKey>/)
  const dir = path.join(LOCAL_CACHE_ROOT, cacheKey)
  const metaPath = path.join(dir, 'meta.json')
  const audioPath = path.join(dir, 'audio.mp3')

  try {
    const [rawMeta] = await Promise.all([
      fs.readFile(metaPath, 'utf8'),
      fs.access(audioPath),
    ])
    const meta = JSON.parse(rawMeta) as TrackMetadata

    if (Date.now() >= meta.expiresAt) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
      return null
    }

    return {
      ...meta,
      streamUrl: `/api/files/${cacheKey}`,
      downloadUrl: `/api/files/${cacheKey}?download=1`,
      storageMode: 'local-disk',
    }
  }
  catch {
    return null
  }
}

export interface SaveTrackInput {
  cacheKey: string
  provider: Provider
  sourceUrl: string
  canonicalUrl: string
  title: string
  artist: string
  duration: number
  thumbnail: string
  bitrate: AudioBitrate
  fileName: string
  mp3FilePath: string
}

export async function saveCachedTrack(input: SaveTrackInput): Promise<TrackMetadata> {
  assertValidCacheKey(input.cacheKey)
  const { token, isVercelBlob, ttlMs } = getStorageConfig()

  const stat = await fs.stat(input.mp3FilePath)
  const now = Date.now()
  const expiresAt = now + ttlMs

  if (isVercelBlob) {
    const safeBlobName = input.fileName.endsWith('.mp3') ? input.fileName : `${input.fileName}.mp3`
    const audioStream = createReadStream(input.mp3FilePath)

    const audioBlob = await put(`tracks/${input.cacheKey}/${safeBlobName}`, audioStream, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'audio/mpeg',
      cacheControlMaxAge: Math.floor(ttlMs / 1000),
      token,
    })

    const metadata: TrackMetadata = {
      id: input.cacheKey,
      cacheKey: input.cacheKey,
      provider: input.provider,
      sourceUrl: input.sourceUrl,
      canonicalUrl: input.canonicalUrl,
      title: input.title,
      artist: input.artist,
      duration: input.duration,
      thumbnail: input.thumbnail,
      bitrate: input.bitrate,
      fileSize: stat.size,
      fileName: safeBlobName,
      streamUrl: audioBlob.url,
      downloadUrl: audioBlob.downloadUrl || `${audioBlob.url}?download=1`,
      storageMode: 'vercel-blob',
      createdAt: now,
      expiresAt,
    }

    await put(`tracks/${input.cacheKey}/meta.json`, JSON.stringify(metadata), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      cacheControlMaxAge: 60,
      token,
    })

    return metadata
  }

  // Local disk fallback
  const dir = path.join(LOCAL_CACHE_ROOT, input.cacheKey)
  await fs.mkdir(dir, { recursive: true })

  const safeFileName = input.fileName.endsWith('.mp3') ? input.fileName : `${input.fileName}.mp3`
  const destAudioPath = path.join(dir, 'audio.mp3')
  await fs.copyFile(input.mp3FilePath, destAudioPath)

  const metadata: TrackMetadata = {
    id: input.cacheKey,
    cacheKey: input.cacheKey,
    provider: input.provider,
    sourceUrl: input.sourceUrl,
    canonicalUrl: input.canonicalUrl,
    title: input.title,
    artist: input.artist,
    duration: input.duration,
    thumbnail: input.thumbnail,
    bitrate: input.bitrate,
    fileSize: stat.size,
    fileName: safeFileName,
    streamUrl: `/api/files/${input.cacheKey}`,
    downloadUrl: `/api/files/${input.cacheKey}?download=1`,
    storageMode: 'local-disk',
    createdAt: now,
    expiresAt,
  }

  await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify(metadata, null, 2), 'utf8')
  return metadata
}

export async function cleanupExpiredTracks(): Promise<{
  storageMode: 'vercel-blob' | 'local-disk'
  scanned: number
  deleted: number
}> {
  const { token, isVercelBlob, ttlMs } = getStorageConfig()
  const cutoff = Date.now() - ttlMs

  if (isVercelBlob) {
    let cursor: string | undefined
    let scanned = 0
    const urlsToDelete: string[] = []

    do {
      const page = await list({
        prefix: 'tracks/',
        cursor,
        limit: 500,
        token,
      })
      scanned += page.blobs.length
      for (const blob of page.blobs) {
        const uploadedTime = new Date(blob.uploadedAt).getTime()
        if (uploadedTime <= cutoff) {
          urlsToDelete.push(blob.url)
        }
      }
      cursor = page.hasMore ? page.cursor : undefined
    } while (cursor)

    if (urlsToDelete.length > 0) {
      // Delete in chunks of 100
      for (let i = 0; i < urlsToDelete.length; i += 100) {
        const batch = urlsToDelete.slice(i, i + 100)
        await del(batch, { token })
      }
    }

    return {
      storageMode: 'vercel-blob',
      scanned,
      deleted: urlsToDelete.length,
    }
  }

  // Local disk cleanup
  let scanned = 0
  let deleted = 0
  try {
    const entries = await fs.readdir(LOCAL_CACHE_ROOT, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      scanned++
      const dir = path.join(LOCAL_CACHE_ROOT, entry.name)
      const metaPath = path.join(dir, 'meta.json')
      try {
        const raw = await fs.readFile(metaPath, 'utf8')
        const meta = JSON.parse(raw) as TrackMetadata
        if (Date.now() >= meta.expiresAt) {
          await fs.rm(dir, { recursive: true, force: true })
          deleted++
        }
      }
      catch {
        const stat = await fs.stat(dir)
        if (stat.mtimeMs <= cutoff) {
          await fs.rm(dir, { recursive: true, force: true })
          deleted++
        }
      }
    }
  }
  catch {
    // Directory doesn't exist yet
  }

  return {
    storageMode: 'local-disk',
    scanned,
    deleted,
  }
}

export function getLocalAudioPaths(cacheKey: string) {
  assertValidCacheKey(cacheKey)
  const dir = path.join(LOCAL_CACHE_ROOT, cacheKey)
  return {
    dir,
    metaPath: path.join(dir, 'meta.json'),
    audioPath: path.join(dir, 'audio.mp3'),
  }
}
