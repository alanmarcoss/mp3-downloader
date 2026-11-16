import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertValidCacheKey, buildCacheKey, resolveAndParseMediaUrl } from '~/server/utils/cacheKey'

describe('server/utils/cacheKey', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('produces identical cache keys for equivalent YouTube URLs with the same bitrate', async () => {
    const a = await resolveAndParseMediaUrl('https://youtu.be/dQw4w9WgXcQ?si=111')
    const b = await resolveAndParseMediaUrl('https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share')

    expect(buildCacheKey(a, 192)).toBe('yt-dQw4w9WgXcQ-192')
    expect(buildCacheKey(b, 192)).toBe('yt-dQw4w9WgXcQ-192')
    expect(buildCacheKey(a, 320)).toBe('yt-dQw4w9WgXcQ-320')
  })

  it('expands SoundCloud shortlinks to match the canonical SoundCloud cache key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        url: 'https://soundcloud.com/flume/never-be-like-you?si=xyz',
      }),
    )

    const fromShort = await resolveAndParseMediaUrl('https://on.soundcloud.com/AbCdEf')
    const fromFull = await resolveAndParseMediaUrl('https://soundcloud.com/flume/never-be-like-you')

    expect(fromShort.canonicalUrl).toBe('https://soundcloud.com/flume/never-be-like-you')
    expect(buildCacheKey(fromShort, 192)).toBe(buildCacheKey(fromFull, 192))
    expect(buildCacheKey(fromFull, 192)).toMatch(/^sc-[0-9a-f]{16}-192$/)
  })

  it('throws 400 errors for playlists and invalid URLs', async () => {
    await expect(resolveAndParseMediaUrl('https://soundcloud.com/user/sets/my-set')).rejects.toMatchObject({
      statusCode: 400,
    })
    await expect(resolveAndParseMediaUrl('not-a-valid-url')).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('prevents path traversal via assertValidCacheKey', () => {
    expect(() => assertValidCacheKey('yt-dQw4w9WgXcQ-192')).not.toThrow()
    expect(() => assertValidCacheKey('sc-0123456789abcdef-320')).not.toThrow()
    expect(() => assertValidCacheKey('../etc/passwd')).toThrow()
    expect(() => assertValidCacheKey('yt-dQw4w9WgXcQ-999')).toThrow()
  })
})
