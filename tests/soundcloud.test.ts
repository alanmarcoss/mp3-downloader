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

  it('skips 404 abr_sq (audio/mpegurl) transcodings, passes track_authorization, and falls back to working aac_160k HLS', async () => {
    const requestedStreamUrls: string[] = []

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/resolve?')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: 293,
              kind: 'track',
              title: 'Flickermood',
              duration: 240_000,
              track_authorization: 'jwt_track_auth_token',
              permalink_url: 'https://soundcloud.com/forss/flickermood',
              user: { username: 'Forss' },
              media: {
                transcodings: [
                  {
                    url: 'https://api-v2.soundcloud.com/media/abr_sq/stream/hls',
                    preset: 'abr_sq',
                    duration: 240_000,
                    format: { protocol: 'hls', mime_type: 'audio/mpegurl' },
                  },
                  {
                    url: 'https://api-v2.soundcloud.com/media/dead_prog/stream/progressive',
                    preset: 'mp3_1_0',
                    duration: 240_000,
                    format: { protocol: 'progressive', mime_type: 'audio/mpeg' },
                  },
                  {
                    url: 'https://api-v2.soundcloud.com/media/aac_160k/stream/hls',
                    preset: 'aac_160k',
                    duration: 240_000,
                    format: { protocol: 'hls', mime_type: 'audio/mp4; codecs="mp4a.40.2"' },
                  },
                ],
              },
            }),
          }
        }
        if (url.includes('/stream/')) {
          requestedStreamUrls.push(url)
          if (url.includes('dead_prog') || url.includes('abr_sq')) {
            return { ok: false, status: 404 }
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ url: 'https://cf-hls.sndcdn.com/fmp4.m3u8' }),
          }
        }
        if (url.includes('fmp4.m3u8')) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:10.0,\ndata000.m4s\n#EXT-X-ENDLIST',
          }
        }
        if (url.endsWith('init.mp4')) {
          return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('INIT-') }
        }
        if (url.endsWith('data000.m4s')) {
          return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('M4S') }
        }
        throw new Error(`Unexpected URL: ${url}`)
      }),
    )

    const dest = path.join(os.tmpdir(), `sc-fallback-${Date.now()}.m4a`)
    try {
      await downloadSoundCloudRawAudio('https://soundcloud.com/forss/flickermood', dest, 3600)
      expect(await fs.readFile(dest, 'utf8')).toBe('INIT-M4S')
      expect(requestedStreamUrls.every(u => u.includes('track_authorization=jwt_track_auth_token'))).toBe(true)
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
