import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestState } from './setup'

const ytdlInstanceMocks = vi.hoisted(() => ({
  getInfo: vi.fn(),
  download: vi.fn(),
}))

vi.mock('@distube/ytdl-core', () => ({
  Ytdl: class {
    getInfo = ytdlInstanceMocks.getInfo
    download = ytdlInstanceMocks.download
  },
}))

vi.mock('youtubei.js', () => ({
  Innertube: {
    create: vi.fn().mockRejectedValue(new Error('Sign in to confirm you are not a bot')),
  },
  Platform: { shim: {} },
  UniversalCache: class {},
}))

import {
  downloadYouTubeRawAudio,
  inspectYouTubeTrack,
  parseYouTubeCookies,
} from '~/server/utils/youtube'

describe('server/utils/youtube', () => {
  beforeEach(() => {
    resetTestState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses YOUTUBE_COOKIES in JSON, Netscape cookies.txt, raw header, and base64 formats', () => {
    // 1. JSON array
    const jsonCookies = parseYouTubeCookies(
      JSON.stringify([
        { name: 'SID', value: 'sid123', domain: '.youtube.com' },
        { name: 'SAPISID', value: 'sapi456', domain: '.youtube.com' },
      ]),
    )
    expect(jsonCookies.header).toBe('SID=sid123; SAPISID=sapi456')

    // 2. Netscape cookies.txt
    const netscapeRaw = [
      '# Netscape HTTP Cookie File',
      '.youtube.com\tTRUE\t/\tTRUE\t1800000000\tVISITOR_INFO1_LIVE\tabc',
      '#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t1800000000\t__Secure-3PSID\txyz',
    ].join('\n')
    const netscapeCookies = parseYouTubeCookies(netscapeRaw)
    expect(netscapeCookies.header).toBe('VISITOR_INFO1_LIVE=abc; __Secure-3PSID=xyz')

    // 3. Base64-encoded Netscape cookies.txt
    const b64Cookies = parseYouTubeCookies(Buffer.from(netscapeRaw, 'utf8').toString('base64'))
    expect(b64Cookies.header).toBe('VISITOR_INFO1_LIVE=abc; __Secure-3PSID=xyz')

    // 4. Raw Cookie header string
    const rawHeader = parseYouTubeCookies('Cookie: SID=111; HSID=222')
    expect(rawHeader.header).toBe('SID=111; HSID=222')
  })

  it('cleans "(Official Music Video)" and "- Topic" suffixes during inspectYouTubeTrack', async () => {
    ytdlInstanceMocks.getInfo.mockResolvedValueOnce({
      videoDetails: {
        title: 'Daft Punk - Digital Love (Official Audio)',
        lengthSeconds: 301,
        author: { name: 'Daft Punk - Topic' },
      },
    })

    const meta = await inspectYouTubeTrack(
      'Fxz9P1fG66I',
      'https://www.youtube.com/watch?v=Fxz9P1fG66I',
    )

    expect(meta).toEqual({
      title: 'Digital Love',
      artist: 'Daft Punk',
      duration: 301,
      thumbnail: 'https://i.ytimg.com/vi/Fxz9P1fG66I/hqdefault.jpg',
    })
  })

  it('falls back seamlessly to YouTube oEmbed when ytdl-core is rate-limited', async () => {
    ytdlInstanceMocks.getInfo.mockRejectedValueOnce(new Error('429 Too Many Requests'))
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          title: 'Bicep - Glue (Official Music Video)',
          author_name: 'FeelMyBicep',
        }),
      }),
    )

    const meta = await inspectYouTubeTrack(
      'A7ZxRs45tTg',
      'https://www.youtube.com/watch?v=A7ZxRs45tTg',
    )

    expect(meta.title).toBe('Glue')
    expect(meta.artist).toBe('Bicep')
    expect(meta.thumbnail).toBe('https://i.ytimg.com/vi/A7ZxRs45tTg/hqdefault.jpg')
  })

  it('rejects live streams with HTTP 400 without retrying fallbacks', async () => {
    ytdlInstanceMocks.getInfo.mockResolvedValueOnce({
      videoDetails: {
        isLive: true,
        lengthSeconds: 0,
      },
    })

    await expect(
      downloadYouTubeRawAudio(
        'jfKfPfyJRdk',
        'https://www.youtube.com/watch?v=jfKfPfyJRdk',
        '/tmp/unused',
        3600,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Live streams cannot be converted to MP3.',
    })
  })
})
