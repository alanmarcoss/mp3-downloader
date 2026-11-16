import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestState } from './setup'
import { downloadSoundCloudRawAudio, inspectSoundCloudTrack } from '~/server/utils/soundcloud'

describe('server/utils/soundcloud', () => {
  beforeEach(() => {
    resetTestState({
      soundcloudClientId: '0123456789abcdef0123456789abcdef',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves SoundCloud track metadata, upgrades artwork to 500x500, and splits Artist - Title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 99,
          kind: 'track',
          title: 'Kaytranada - Lite Spots',
          duration: 230_400,
          artwork_url: 'https://i1.sndcdn.com/artworks-abc-large.jpg',
          permalink_url: 'https://soundcloud.com/kaytranada/lite-spots',
          user: { username: 'KAYTRANADA' },
        }),
      }),
    )

    const meta = await inspectSoundCloudTrack('https://soundcloud.com/kaytranada/lite-spots')
    expect(meta).toEqual({
      title: 'Lite Spots',
      artist: 'Kaytranada',
      duration: 230,
      thumbnail: 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg',
    })
  })

  it('assembles HLS .m3u8 audio segments in exact order when progressive stream is unavailable', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/resolve?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: 101,
            kind: 'track',
            title: 'Club Edit',
            duration: 120_000,
            artwork_url: null,
            permalink_url: 'https://soundcloud.com/dj/club-edit',
            user: { username: 'DJ Test', avatar_url: 'https://i1.sndcdn.com/avatars-1-large.jpg' },
            media: {
              transcodings: [
                {
                  url: 'https://api-v2.soundcloud.com/media/hls-stream',
                  preset: 'mp3_0_1',
                  duration: 120_000,
                  format: { protocol: 'hls', mime_type: 'audio/mpeg' },
                },
              ],
            },
          }),
        }
      }
      if (url.includes('/media/hls-stream')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: 'https://cf-hls.sndcdn.com/playlist.m3u8' }),
        }
      }
      if (url.includes('playlist.m3u8')) {
        return {
          ok: true,
          status: 200,
          text: async () =>
            '#EXTM3U\n#EXTINF:10.0,\nseg1.mp3\n#EXTINF:10.0,\nhttps://cf-hls.sndcdn.com/seg2.mp3\n#EXT-X-ENDLIST',
        }
      }
      if (url.endsWith('seg1.mp3')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('PART1-') }
      }
      if (url.endsWith('seg2.mp3')) {
        return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('PART2') }
      }
      throw new Error(`Unexpected URL: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const dest = path.join(os.tmpdir(), `sc-hls-test-${Date.now()}.mp3`)
    try {
      const meta = await downloadSoundCloudRawAudio(
        'https://soundcloud.com/dj/club-edit',
        dest,
        3600,
      )
      expect(meta.title).toBe('Club Edit')
      expect(meta.artist).toBe('DJ Test')
      const content = await fs.readFile(dest, 'utf8')
      expect(content).toBe('PART1-PART2')
    }
    finally {
      await fs.rm(dest, { force: true }).catch(() => {})
    }
  })

  it('rejects tracks exceeding maxDurationSeconds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          id: 102,
          kind: 'track',
          title: '4 Hour Mix',
          duration: 4 * 3600 * 1000,
          permalink_url: 'https://soundcloud.com/dj/mix',
        }),
      }),
    )

    await expect(
      downloadSoundCloudRawAudio('https://soundcloud.com/dj/mix', '/tmp/unused', 3600),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
