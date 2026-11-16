export type Provider = 'youtube' | 'soundcloud'

export type AudioBitrate = 128 | 192 | 320

export interface TrackMetadata {
  id: string
  cacheKey: string
  provider: Provider
  sourceUrl: string
  canonicalUrl: string
  title: string
  artist: string
  duration: number
  thumbnail: string
  bitrate: AudioBitrate
  fileSize: number
  fileName: string
  downloadUrl: string
  streamUrl: string
  storageMode: 'vercel-blob' | 'local-disk'
  createdAt: number
  expiresAt: number
}

export interface ExtractRequest {
  url: string
  bitrate?: AudioBitrate
  forceRefresh?: boolean
}

export interface ExtractResponse {
  track: TrackMetadata
  cached: boolean
}

export interface InspectResponse {
  provider: Provider
  canonicalUrl: string
  cacheKey: string
  title: string
  artist: string
  duration: number
  thumbnail: string
  cachedTrack: TrackMetadata | null
}

export interface CacheStatusResponse {
  storageMode: 'vercel-blob' | 'local-disk'
  ttlHours: number
  statuses: Record<
    string,
    {
      active: boolean
      expiresAt?: number
      downloadUrl?: string
      streamUrl?: string
    }
  >
}
