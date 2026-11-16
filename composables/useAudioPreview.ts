import type { TrackMetadata } from '~/types/track'

let sharedAudio: HTMLAudioElement | null = null

export function useAudioPreview() {
  const activeKey = useState<string | null>('audio-active-key', () => null)
  const isPlaying = useState<boolean>('audio-is-playing', () => false)
  const currentTime = useState<number>('audio-current-time', () => 0)
  const duration = useState<number>('audio-duration', () => 0)

  function ensureAudioElement(): HTMLAudioElement | null {
    if (!import.meta.client) return null
    if (!sharedAudio) {
      sharedAudio = new Audio()
      sharedAudio.preload = 'metadata'

      sharedAudio.addEventListener('timeupdate', () => {
        currentTime.value = sharedAudio?.currentTime || 0
      })
      sharedAudio.addEventListener('loadedmetadata', () => {
        duration.value = sharedAudio?.duration || 0
      })
      sharedAudio.addEventListener('play', () => {
        isPlaying.value = true
      })
      sharedAudio.addEventListener('pause', () => {
        isPlaying.value = false
      })
      sharedAudio.addEventListener('ended', () => {
        isPlaying.value = false
        currentTime.value = 0
      })
    }
    return sharedAudio
  }

  async function togglePlay(track: TrackMetadata) {
    const audio = ensureAudioElement()
    if (!audio) return

    if (activeKey.value === track.cacheKey) {
      if (audio.paused) {
        await audio.play().catch(() => {})
      }
      else {
        audio.pause()
      }
      return
    }

    audio.pause()
    activeKey.value = track.cacheKey
    currentTime.value = 0
    duration.value = track.duration || 0
    audio.src = track.streamUrl
    await audio.play().catch(() => {})
  }

  function seekToPercent(percent: number) {
    const audio = ensureAudioElement()
    if (!audio || !audio.duration || !Number.isFinite(audio.duration)) return
    const clamped = Math.max(0, Math.min(100, percent))
    audio.currentTime = (clamped / 100) * audio.duration
    currentTime.value = audio.currentTime
  }

  function stopIfActive(cacheKey: string) {
    if (activeKey.value === cacheKey && sharedAudio) {
      sharedAudio.pause()
      sharedAudio.removeAttribute('src')
      activeKey.value = null
      isPlaying.value = false
      currentTime.value = 0
    }
  }

  const progressPercent = computed(() => {
    if (!duration.value || duration.value <= 0) return 0
    return Math.min(100, (currentTime.value / duration.value) * 100)
  })

  return {
    activeKey,
    isPlaying,
    currentTime,
    duration,
    progressPercent,
    togglePlay,
    seekToPercent,
    stopIfActive,
  }
}
