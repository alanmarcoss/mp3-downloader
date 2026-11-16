import { describe, expect, it } from 'vitest'
import { formatBytes, formatCountdown, formatDuration, sanitizeFilename } from '~/utils/format'

describe('utils/format', () => {
  it('formats durations across seconds, minutes, and hours', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(-5)).toBe('0:00')
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(3729)).toBe('1:02:09')
  })

  it('formats byte sizes cleanly', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024 * 500)).toBe('500.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('formats 24h countdown timers accurately', () => {
    const base = 1_700_000_000_000
    expect(formatCountdown(base - 1000, base)).toBe('Expired')
    expect(formatCountdown(base + 45_000, base)).toBe('45s left')
    expect(formatCountdown(base + 14 * 60_000 + 12_000, base)).toBe('14m 12s left')
    expect(formatCountdown(base + 23 * 3_600_000 + 59 * 60_000, base)).toBe('23h 59m left')
  })

  it('sanitizes filenames safely for downloads and object storage', () => {
    expect(sanitizeFilename('Artist: "Track" / Live *2026*?')).toBe('Artist Track Live 2026')
    expect(sanitizeFilename('   ')).toBe('audio-track')
  })
})
