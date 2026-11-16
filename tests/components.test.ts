import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetTestState } from './setup'
import ActiveTrackCard from '~/components/ActiveTrackCard.vue'
import PlatformBadge from '~/components/PlatformBadge.vue'
import { Badge } from '~/components/ui/badge'
import { Button } from '~/components/ui/button'
import { Card } from '~/components/ui/card'
import { useAudioPreview } from '~/composables/useAudioPreview'
import { useDownloadVault } from '~/composables/useDownloadVault'
import type { TrackMetadata } from '~/types/track'

;(globalThis as any).useAudioPreview = useAudioPreview

const sampleTrack: TrackMetadata = {
  id: 'yt-dQw4w9WgXcQ-320',
  cacheKey: 'yt-dQw4w9WgXcQ-320',
  provider: 'youtube',
  sourceUrl: 'https://youtu.be/dQw4w9WgXcQ',
  canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  title: 'Veridis Quo',
  artist: 'Daft Punk',
  duration: 345,
  thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  bitrate: 320,
  fileSize: 13_800_000,
  fileName: 'Daft Punk - Veridis Quo.mp3',
  streamUrl: 'https://blob.vercel-storage.com/tracks/veridis.mp3',
  downloadUrl: 'https://blob.vercel-storage.com/tracks/veridis.mp3?download=1',
  storageMode: 'vercel-blob',
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_000_000_000 + 24 * 3_600_000,
}

describe('UI Components & Vault Composable', () => {
  beforeEach(() => {
    resetTestState()
    localStorage.clear()
  })

  it('renders PlatformBadge for YouTube and SoundCloud including compact mode', () => {
    const yt = mount(PlatformBadge, { props: { provider: 'youtube' } })
    expect(yt.text()).toContain('YouTube')

    const scCompact = mount(PlatformBadge, { props: { provider: 'soundcloud', compact: true } })
    expect(scCompact.text()).toBe('')
    expect(scCompact.find('svg').exists()).toBe(true)
  })

  it('renders ActiveTrackCard with metadata, Instant Cache Hit badge, countdown, and download anchor', () => {
    const wrapper = mount(ActiveTrackCard, {
      props: {
        track: sampleTrack,
        wasCachedHit: true,
        now: sampleTrack.createdAt + 60_000,
      },
      global: {
        components: { Badge, Button, Card, PlatformBadge },
      },
    })

    expect(wrapper.text()).toContain('Veridis Quo')
    expect(wrapper.text()).toContain('Daft Punk')
    expect(wrapper.text()).toContain('320 kbps MP3')
    expect(wrapper.text()).toContain('Instant Cache Hit')
    expect(wrapper.text()).toContain('23h 59m left')

    const downloadAnchor = wrapper.find('a[download]')
    expect(downloadAnchor.exists()).toBe(true)
    expect(downloadAnchor.attributes('href')).toBe(sampleTrack.downloadUrl)
    expect(downloadAnchor.attributes('download')).toBe('Daft Punk - Veridis Quo.mp3')
  })

  it('manages per-browser download history and expiration in useDownloadVault', () => {
    const vault = useDownloadVault()
    expect(vault.items.value).toHaveLength(0)

    vault.upsertTrack(sampleTrack)
    expect(vault.items.value).toHaveLength(1)

    vault.now.value = sampleTrack.createdAt + 1000
    expect(vault.isTrackExpired(sampleTrack)).toBe(false)

    vault.now.value = sampleTrack.expiresAt + 1000
    expect(vault.isTrackExpired(sampleTrack)).toBe(true)

    vault.removeTrack(sampleTrack.cacheKey)
    expect(vault.items.value).toHaveLength(0)
  })
})
