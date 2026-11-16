<script setup lang="ts">
import {
  Check,
  Clock,
  Download,
  ExternalLink,
  Music2,
  Pause,
  Play,
  Share2,
  Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { TrackMetadata } from '~/types/track'
import { formatBytes, formatCountdown, formatDuration } from '~/utils/format'

const props = defineProps<{
  track: TrackMetadata
  wasCachedHit: boolean
  now: number
}>()

const {
  activeKey,
  isPlaying,
  currentTime,
  duration,
  progressPercent,
  togglePlay,
  seekToPercent,
} = useAudioPreview()

const copied = ref(false)
const isThisActive = computed(() => activeKey.value === props.track.cacheKey)
const isThisPlaying = computed(() => isThisActive.value && isPlaying.value)
const countdownLabel = computed(() => formatCountdown(props.track.expiresAt, props.now))

function handleScrubClick(event: MouseEvent) {
  if (!isThisActive.value) {
    togglePlay(props.track)
    return
  }
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const pct = ((event.clientX - rect.left) / rect.width) * 100
  seekToPercent(pct)
}

async function copyShareUrl() {
  try {
    const absoluteUrl = props.track.downloadUrl.startsWith('http')
      ? props.track.downloadUrl
      : `${window.location.origin}${props.track.downloadUrl}`
    await navigator.clipboard.writeText(absoluteUrl)
    copied.value = true
    toast.success('Download link copied to clipboard')
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
  catch {
    toast.error('Could not copy link')
  }
}
</script>

<template>
  <Card class="overflow-hidden border-primary/15 bg-card/90 shadow-md backdrop-blur">
    <div class="flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
      <!-- Artwork + Play button -->
      <div class="relative mx-auto h-28 w-28 shrink-0 overflow-hidden rounded-lg border bg-muted sm:mx-0">
        <img
          v-if="track.thumbnail"
          :src="track.thumbnail"
          :alt="track.title"
          class="h-full w-full object-cover transition-transform duration-300"
          :class="isThisPlaying ? 'scale-105' : ''"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-muted-foreground">
          <Music2 class="h-8 w-8" />
        </div>

        <button
          type="button"
          class="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-95 transition hover:bg-black/55"
          :aria-label="isThisPlaying ? 'Pause preview' : 'Play preview'"
          @click="togglePlay(track)"
        >
          <span class="flex h-11 w-11 items-center justify-center rounded-full bg-white/95 text-zinc-950 shadow-lg transition-transform hover:scale-105">
            <Pause v-if="isThisPlaying" class="h-5 w-5 fill-current" />
            <Play v-else class="ml-0.5 h-5 w-5 fill-current" />
          </span>
        </button>
      </div>

      <!-- Track details & player -->
      <div class="min-w-0 flex-1 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
          <PlatformBadge :provider="track.provider" />
          <Badge variant="secondary" class="font-mono text-[11px]">
            {{ track.bitrate }} kbps MP3
          </Badge>
          <Badge
            v-if="wasCachedHit"
            variant="outline"
            class="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          >
            <Zap class="h-3 w-3" />
            Instant
          </Badge>
          <Badge
            variant="outline"
            class="ml-auto font-mono text-[11px] text-muted-foreground"
          >
            <Clock class="h-3 w-3" />
            {{ countdownLabel }}
          </Badge>
        </div>

        <div>
          <h2 class="truncate text-base font-semibold tracking-tight sm:text-lg" :title="track.title">
            {{ track.title }}
          </h2>
          <p class="truncate text-sm text-muted-foreground">
            {{ track.artist }}
            <span class="mx-1.5 opacity-40">•</span>
            <span class="font-mono text-xs">{{ formatDuration(track.duration) }}</span>
            <span class="mx-1.5 opacity-40">•</span>
            <span class="font-mono text-xs">{{ formatBytes(track.fileSize) }}</span>
          </p>
        </div>

        <!-- Scrubber bar -->
        <div class="space-y-1">
          <div
            class="group relative h-2 w-full cursor-pointer overflow-hidden rounded-full bg-secondary"
            @click="handleScrubClick"
          >
            <div
              class="h-full rounded-full bg-primary transition-all duration-100"
              :style="{ width: `${isThisActive ? progressPercent : 0}%` }"
            />
          </div>
          <div class="flex justify-between font-mono text-[11px] text-muted-foreground">
            <span>{{ isThisActive ? formatDuration(currentTime) : '0:00' }}</span>
            <span>{{ formatDuration(isThisActive && duration ? duration : track.duration) }}</span>
          </div>
        </div>

        <!-- Action buttons -->
        <div class="flex flex-wrap items-center gap-2 pt-0.5">
          <Button as="a" :href="track.downloadUrl" :download="track.fileName" class="gap-2">
            <Download class="h-4 w-4" />
            Download MP3
          </Button>

          <Button variant="outline" size="default" @click="copyShareUrl">
            <Check v-if="copied" class="h-4 w-4 text-emerald-500" />
            <Share2 v-else class="h-4 w-4" />
            {{ copied ? 'Copied' : 'Copy Link' }}
          </Button>

          <Button
            as="a"
            :href="track.canonicalUrl"
            target="_blank"
            rel="noopener noreferrer"
            variant="ghost"
            size="icon"
            title="Open original track"
          >
            <ExternalLink class="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  </Card>
</template>
