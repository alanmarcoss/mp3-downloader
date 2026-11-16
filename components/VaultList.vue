<script setup lang="ts">
import {
  Clock,
  Copy,
  Download,
  History,
  Music2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { TrackMetadata } from '~/types/track'
import { formatBytes, formatCountdown, formatDuration } from '~/utils/format'

const props = defineProps<{
  items: TrackMetadata[]
  now: number
  isExpired: (track: TrackMetadata) => boolean
  busyKey: string | null
}>()

const emit = defineEmits<{
  (e: 'recache', track: TrackMetadata): void
  (e: 'remove', cacheKey: string): void
  (e: 'clear'): void
}>()

const filterTab = ref<'all' | 'youtube' | 'soundcloud'>('all')
const { activeKey, isPlaying, togglePlay, stopIfActive } = useAudioPreview()

const filteredItems = computed(() => {
  if (filterTab.value === 'all') return props.items
  return props.items.filter(item => item.provider === filterTab.value)
})

async function copyTrackLink(track: TrackMetadata) {
  try {
    const absoluteUrl = track.downloadUrl.startsWith('http')
      ? track.downloadUrl
      : `${window.location.origin}${track.downloadUrl}`
    await navigator.clipboard.writeText(absoluteUrl)
    toast.success('Copied 24h download link')
  }
  catch {
    toast.error('Failed to copy link')
  }
}

function handleRemove(cacheKey: string) {
  stopIfActive(cacheKey)
  emit('remove', cacheKey)
}
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
      <div class="flex items-center gap-2.5">
        <div class="flex h-8 w-8 items-center justify-center rounded-lg border bg-card text-muted-foreground">
          <History class="h-4 w-4" />
        </div>
        <div>
          <h2 class="text-sm font-semibold tracking-tight">
            24-Hour Download Vault
          </h2>
          <p class="text-xs text-muted-foreground">
            Saved in this browser · Cached MP3s auto-purge from cloud storage after 24 hours
          </p>
        </div>
      </div>

      <div v-if="items.length > 0" class="flex items-center gap-2">
        <Tabs v-model="filterTab" default-value="all">
          <TabsList>
            <TabsTrigger value="all">
              All ({{ items.length }})
            </TabsTrigger>
            <TabsTrigger value="youtube">
              YouTube
            </TabsTrigger>
            <TabsTrigger value="soundcloud">
              SoundCloud
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Button
          variant="ghost"
          size="sm"
          class="text-xs text-muted-foreground hover:text-destructive"
          @click="emit('clear')"
        >
          Clear
        </Button>
      </div>
    </div>

    <!-- Empty state -->
    <Card v-if="filteredItems.length === 0" class="border-dashed bg-card/40">
      <CardContent class="flex flex-col items-center justify-center py-10 text-center">
        <div class="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Music2 class="h-5 w-5" />
        </div>
        <p class="text-sm font-medium">
          {{ items.length === 0 ? 'Your 24-hour vault is empty' : `No ${filterTab} downloads yet` }}
        </p>
        <p class="mt-1 max-w-sm text-xs text-muted-foreground">
          Paste any YouTube or SoundCloud track link above. Converted MP3s remain ready for instant re-download across devices for 24 hours.
        </p>
      </CardContent>
    </Card>

    <!-- Vault items -->
    <div v-else class="divide-y rounded-xl border bg-card shadow-sm">
      <div
        v-for="track in filteredItems"
        :key="track.cacheKey"
        class="flex flex-col gap-3 p-3.5 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center"
      >
        <div class="flex min-w-0 flex-1 items-center gap-3">
          <!-- Thumbnail + mini play button -->
          <div class="relative h-12 w-12 shrink-0 overflow-hidden rounded-md border bg-muted">
            <img
              v-if="track.thumbnail"
              :src="track.thumbnail"
              :alt="track.title"
              class="h-full w-full object-cover"
              :class="isExpired(track) ? 'grayscale opacity-50' : ''"
            >
            <div v-else class="flex h-full w-full items-center justify-center text-muted-foreground">
              <Music2 class="h-4 w-4" />
            </div>

            <button
              v-if="!isExpired(track)"
              type="button"
              class="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity hover:opacity-100 focus:opacity-100"
              :class="activeKey === track.cacheKey && isPlaying ? '!opacity-100' : ''"
              :aria-label="activeKey === track.cacheKey && isPlaying ? 'Pause' : 'Play'"
              @click="togglePlay(track)"
            >
              <Pause v-if="activeKey === track.cacheKey && isPlaying" class="h-4 w-4 fill-current" />
              <Play v-else class="ml-0.5 h-4 w-4 fill-current" />
            </button>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <PlatformBadge :provider="track.provider" compact />
              <p class="truncate text-sm font-medium" :title="track.title">
                {{ track.title }}
              </p>
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span class="truncate max-w-[180px]">{{ track.artist }}</span>
              <span class="opacity-40">•</span>
              <span class="font-mono">{{ formatDuration(track.duration) }}</span>
              <span class="opacity-40">•</span>
              <span class="font-mono">{{ track.bitrate }}k</span>
              <span class="opacity-40">•</span>
              <span class="font-mono">{{ formatBytes(track.fileSize) }}</span>
            </div>
          </div>
        </div>

        <!-- Right side status + actions -->
        <div class="flex items-center justify-between gap-2 sm:justify-end">
          <Badge
            v-if="isExpired(track)"
            variant="outline"
            class="border-amber-500/30 bg-amber-500/10 font-mono text-[11px] text-amber-600 dark:text-amber-400"
          >
            Expired (24h)
          </Badge>
          <Badge
            v-else
            variant="outline"
            class="font-mono text-[11px] text-muted-foreground"
          >
            <Clock class="h-3 w-3" />
            {{ formatCountdown(track.expiresAt, now) }}
          </Badge>

          <div class="flex items-center gap-1">
            <template v-if="!isExpired(track)">
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                title="Copy 24h link"
                @click="copyTrackLink(track)"
              >
                <Copy class="h-3.5 w-3.5" />
              </Button>

              <Button
                as="a"
                :href="track.downloadUrl"
                :download="track.fileName"
                variant="secondary"
                size="sm"
                class="h-8 gap-1.5 px-2.5 text-xs"
              >
                <Download class="h-3.5 w-3.5" />
                MP3
              </Button>
            </template>

            <Button
              v-else
              variant="outline"
              size="sm"
              class="h-8 gap-1.5 px-2.5 text-xs"
              :disabled="busyKey === track.cacheKey"
              @click="emit('recache', track)"
            >
              <RefreshCw class="h-3.5 w-3.5" :class="busyKey === track.cacheKey ? 'animate-spin' : ''" />
              Re-cache
            </Button>

            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8 text-muted-foreground hover:text-destructive"
              title="Remove from history"
              @click="handleRemove(track.cacheKey)"
            >
              <Trash2 class="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
