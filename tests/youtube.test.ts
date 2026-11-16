import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTestState } from './setup'

const ytdlMocks = vi.hoisted(() => ({
  getBasicInfo: vi.fn(),
  getInfo: vi.fn(),
  downloadFromInfo: vi.fn(),
  createAgent: vi.fn(),
  createProxyAgent: vi.fn(),
}))

vi.mock('@distube/ytdl-core', () => ({
  default: ytdlMocks,
}))

vi.mock('youtubei.js', () => ({
  Innertube: {
    create: vi.fn().mockRejectedValue(new Error('Sign in to confirm you are not a bot')),
  },
  UniversalCache: class {},
}))

import { downloadYouTubeRawAudio, inspectYouTubeTrack } from '~/server/utils/youtube'

describe('server/utils/youtube', () => {
  beforeEach(() => {
    resetTestState()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('cleans "(Official Music Video)" and "- Topic" suffixes during inspectYouTubeTrack', async () => {
    ytdlMocks.getBasicInfo.mockResolvedValueOnce({
      videoDetails: {
        title: 'Daft Punk - Digital Love (Official Audio)',
        lengthSeconds: '301',
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
    ytdlMocks.getBasicInfo.mockRejectedValueOnce(new Error('429 Too Many Requests'))
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
    ytdlMocks.getInfo.mockResolvedValueOnce({
      videoDetails: {
        isLiveContent: true,
        lengthSeconds: '0',
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
