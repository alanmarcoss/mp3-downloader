import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestState } from './setup'

const blobMocks = vi.hoisted(() => ({
  put: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@vercel/blob', () => blobMocks)

import {
  cleanupExpiredTracks,
  getCachedTrack,
  getLocalAudioPaths,
  saveCachedTrack,
} from '~/server/utils/storage'

describe('server/utils/storage (24h Cache Engine)', () => {
  let tempSampleMp3: string

  beforeEach(async () => {
    resetTestState()
    vi.clearAllMocks()
    tempSampleMp3 = path.join(os.tmpdir(), `vitest-sample-${Date.now()}.mp3`)
    await fs.writeFile(tempSampleMp3, Buffer.from('ID3-mock-mp3-payload-bytes'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tempSampleMp3, { force: true }).catch(() => {})
    // Clean any test keys written to .data/cache/tracks
    await fs.rm(getLocalAudioPaths('yt-TestLocalKey1-192').dir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(getLocalAudioPaths('yt-TestExpired01-192').dir, { recursive: true, force: true }).catch(() => {})
  })

  describe('Local Disk Fallback Mode', () => {
    it('saves, retrieves, and enforces 24-hour expiration on local disk', async () => {
      const saved = await saveCachedTrack({
        cacheKey: 'yt-TestLocalKey1-192',
        provider: 'youtube',
        sourceUrl: 'https://youtu.be/TestLocalKey1',
        canonicalUrl: 'https://www.youtube.com/watch?v=TestLocalKey1',
        title: 'Midnight City',
        artist: 'M83',
        duration: 243,
        thumbnail: 'https://i.ytimg.com/vi/TestLocalKey1/hqdefault.jpg',
        bitrate: 192,
        fileName: 'M83 - Midnight City.mp3',
        mp3FilePath: tempSampleMp3,
      })

      expect(saved.storageMode).toBe('local-disk')
      expect(saved.expiresAt - saved.createdAt).toBe(24 * 60 * 60 * 1000)

      const hit = await getCachedTrack('yt-TestLocalKey1-192')
      expect(hit).not.toBeNull()
      expect(hit?.title).toBe('Midnight City')
      expect(hit?.downloadUrl).toBe('/api/files/yt-TestLocalKey1-192?download=1')

      // Simulate expiry past 24 hours
      const { metaPath } = getLocalAudioPaths('yt-TestLocalKey1-192')
      const expiredMeta = { ...saved, expiresAt: Date.now() - 5000 }
      await fs.writeFile(metaPath, JSON.stringify(expiredMeta), 'utf8')

      const expiredLookup = await getCachedTrack('yt-TestLocalKey1-192')
      expect(expiredLookup).toBeNull()
    })

    it('sweeps expired tracks during cleanupExpiredTracks() while keeping active ones', async () => {
      await saveCachedTrack({
        cacheKey: 'yt-TestLocalKey1-192',
        provider: 'youtube',
        sourceUrl: 'https://youtu.be/TestLocalKey1',
        canonicalUrl: 'https://www.youtube.com/watch?v=TestLocalKey1',
        title: 'Active Song',
        artist: 'Artist',
        duration: 180,
        thumbnail: '',
        bitrate: 192,
        fileName: 'Active Song.mp3',
        mp3FilePath: tempSampleMp3,
      })

      const expired = await saveCachedTrack({
        cacheKey: 'yt-TestExpired01-192',
        provider: 'youtube',
        sourceUrl: 'https://youtu.be/TestExpired01',
        canonicalUrl: 'https://www.youtube.com/watch?v=TestExpired01',
        title: 'Old Song',
        artist: 'Artist',
        duration: 180,
        thumbnail: '',
        bitrate: 192,
        fileName: 'Old Song.mp3',
        mp3FilePath: tempSampleMp3,
      })

      const { metaPath } = getLocalAudioPaths('yt-TestExpired01-192')
      await fs.writeFile(metaPath, JSON.stringify({ ...expired, expiresAt: Date.now() - 10_000 }), 'utf8')

      const report = await cleanupExpiredTracks()
      expect(report.storageMode).toBe('local-disk')
      expect(report.deleted).toBeGreaterThanOrEqual(1)

      expect(await getCachedTrack('yt-TestExpired01-192')).toBeNull()
      expect(await getCachedTrack('yt-TestLocalKey1-192')).not.toBeNull()
    })
  })

  describe('Vercel Blob Mode', () => {
    beforeEach(() => {
      resetTestState({
        blobReadWriteToken: 'vercel_blob_rw_test_token',
        cacheTtlHours: 24,
      })
    })

    it('uploads MP3 and meta.json to Vercel Blob with deterministic paths', async () => {
      blobMocks.put
        .mockResolvedValueOnce({
          url: 'https://public.blob.vercel-storage.com/tracks/yt-dQw4w9WgXcQ-192/Song.mp3',
          downloadUrl: 'https://public.blob.vercel-storage.com/tracks/yt-dQw4w9WgXcQ-192/Song.mp3?download=1',
        })
        .mockResolvedValueOnce({
          url: 'https://public.blob.vercel-storage.com/tracks/yt-dQw4w9WgXcQ-192/meta.json',
        })

      const saved = await saveCachedTrack({
        cacheKey: 'yt-dQw4w9WgXcQ-192',
        provider: 'youtube',
        sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        artist: 'Rick Astley',
        duration: 213,
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
        bitrate: 192,
        fileName: 'Song.mp3',
        mp3FilePath: tempSampleMp3,
      })

      expect(saved.storageMode).toBe('vercel-blob')
      expect(saved.downloadUrl).toContain('?download=1')
      expect(blobMocks.put).toHaveBeenCalledTimes(2)
      expect(blobMocks.put.mock.calls[0][0]).toBe('tracks/yt-dQw4w9WgXcQ-192/Song.mp3')
      expect(blobMocks.put.mock.calls[0][2]).toMatchObject({
        access: 'public',
        addRandomSuffix: false,
        contentType: 'audio/mpeg',
      })
    })

    it('deletes expired Vercel Blobs on read and during cron cleanup', async () => {
      const expiredMeta = {
        id: 'yt-dQw4w9WgXcQ-192',
        cacheKey: 'yt-dQw4w9WgXcQ-192',
        expiresAt: Date.now() - 60_000,
      }

      blobMocks.list.mockResolvedValueOnce({
        blobs: [
          {
            pathname: 'tracks/yt-dQw4w9WgXcQ-192/meta.json',
            url: 'https://blob.test/meta.json',
            uploadedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
          },
          {
            pathname: 'tracks/yt-dQw4w9WgXcQ-192/Song.mp3',
            url: 'https://blob.test/Song.mp3',
            uploadedAt: new Date(Date.now() - 25 * 3_600_000).toISOString(),
          },
        ],
        hasMore: false,
      })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => expiredMeta,
        }),
      )
      blobMocks.del.mockResolvedValue(undefined)

      const res = await getCachedTrack('yt-dQw4w9WgXcQ-192')
      expect(res).toBeNull()
      expect(blobMocks.del).toHaveBeenCalledWith(
        ['https://blob.test/meta.json', 'https://blob.test/Song.mp3'],
        { token: 'vercel_blob_rw_test_token' },
      )

      // Test cron cleanup batch deletion
      blobMocks.del.mockClear()
      blobMocks.list.mockResolvedValueOnce({
        blobs: [
          {
            pathname: 'tracks/old/Song.mp3',
            url: 'https://blob.test/old.mp3',
            uploadedAt: new Date(Date.now() - 26 * 3_600_000).toISOString(),
          },
          {
            pathname: 'tracks/fresh/Song.mp3',
            url: 'https://blob.test/fresh.mp3',
            uploadedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          },
        ],
        hasMore: false,
      })

      const cleanup = await cleanupExpiredTracks()
      expect(cleanup).toEqual({
        storageMode: 'vercel-blob',
        scanned: 2,
        deleted: 1,
      })
      expect(blobMocks.del).toHaveBeenCalledWith(
        ['https://blob.test/old.mp3'],
        { token: 'vercel_blob_rw_test_token' },
      )
    })
  })
})
