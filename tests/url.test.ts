import { describe, expect, it } from 'vitest'
import { detectProvider, extractYouTubeId, parseMediaUrl } from '~/utils/url'

describe('utils/url', () => {
  describe('YouTube URL parsing', () => {
    it('normalizes standard youtube.com watch URLs and strips extra query params', () => {
      const parsed = parseMediaUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&si=abc123')
      expect(parsed).toEqual({
        provider: 'youtube',
        youtubeId: 'dQw4w9WgXcQ',
        canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      })
    })

    it('supports youtu.be short links, YouTube Music, Shorts, and URLs without protocol', () => {
      expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?si=xyz')).toBe('dQw4w9WgXcQ')
      expect(parseMediaUrl('music.youtube.com/watch?v=dQw4w9WgXcQ')?.canonicalUrl).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      )
      expect(parseMediaUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.youtubeId).toBe(
        'dQw4w9WgXcQ',
      )
    })

    it('detects YouTube playlist URLs so v1 can reject them cleanly', () => {
      const parsed = parseMediaUrl('https://www.youtube.com/playlist?list=PL1234567890')
      expect(parsed?.provider).toBe('youtube')
      expect(parsed?.isPlaylist).toBe(true)
    })

    it('returns null for malformed YouTube video IDs', () => {
      expect(parseMediaUrl('https://www.youtube.com/watch?v=too_short')).toBeNull()
    })
  })

  describe('SoundCloud URL parsing', () => {
    it('normalizes standard SoundCloud track links and strips tracking params', () => {
      const parsed = parseMediaUrl(
        'https://m.soundcloud.com/kaytranada/lite-spots?si=deadbeef&utm_source=clipboard',
      )
      expect(parsed).toEqual({
        provider: 'soundcloud',
        canonicalUrl: 'https://soundcloud.com/kaytranada/lite-spots',
      })
    })

    it('preserves secret token segments (/s-xxxxx) on private SoundCloud links', () => {
      const parsed = parseMediaUrl('https://soundcloud.com/artist/unreleased-demo/s-AbCdEf123?si=123')
      expect(parsed?.canonicalUrl).toBe('https://soundcloud.com/artist/unreleased-demo/s-AbCdEf123')
    })

    it('flags mobile shortlinks (on.soundcloud.com & snd.sc) for server-side expansion', () => {
      const parsed = parseMediaUrl('https://on.soundcloud.com/9XzK1')
      expect(parsed).toEqual({
        provider: 'soundcloud',
        canonicalUrl: 'https://on.soundcloud.com/9XzK1',
        isShortLink: true,
      })
    })

    it('flags SoundCloud sets/albums as playlists', () => {
      const parsed = parseMediaUrl('https://soundcloud.com/artist/sets/summer-ep')
      expect(parsed?.provider).toBe('soundcloud')
      expect(parsed?.isPlaylist).toBe(true)
    })

    it('rejects reserved non-track SoundCloud routes and unsupported domains', () => {
      expect(parseMediaUrl('https://soundcloud.com/discover')).toBeNull()
      expect(parseMediaUrl('https://spotify.com/track/123')).toBeNull()
      expect(detectProvider('')).toBeNull()
    })
  })
})
