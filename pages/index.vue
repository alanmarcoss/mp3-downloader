<script setup lang="ts">
import { useDebounceFn, useLocalStorage } from '@vueuse/core'
import {
  AlertCircle,
  AudioWaveform,
  ClipboardPaste,
  Download,
  Loader2,
  Moon,
  Sun,
  X,
  Zap,
} from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { AudioBitrate, ExtractResponse, InspectResponse, TrackMetadata } from '~/types/track'
import { formatDuration } from '~/utils/format'
import { parseMediaUrl } from '~/utils/url'

const colorMode = useColorMode()
const {
  items: vaultItems,
  now,
  isTrackExpired,
  upsertTrack,
  removeTrack,
  clearVault,
  syncWithServer,
} = useDownloadVault()

const urlInput = ref('')
const bitrate = useLocalStorage<string>('wavelength:bitrate', '192')
const autoDownload = useLocalStorage<boolean>('wavelength:auto-download', true)

const isInspecting = ref(false)
const preview = ref<InspectResponse | null>(null)

const isExtracting = ref(false)
const busyRecacheKey = ref<string | null>(null)
const progressValue = ref(0)
const progressStage = ref('')
const errorMessage = ref<string | null>(null)

const activeResult = ref<{ track: TrackMetadata, cached: boolean } | null>(null)

const parsedInput = computed(() => parseMediaUrl(urlInput.value))
const selectedBitrateNum = computed<AudioBitrate>(() => {
  const n = Number(bitrate.value)
  return (n === 128 || n === 320 ? n : 192) as AudioBitrate
})

let progressTimer: ReturnType<typeof setInterval> | null = null

function startProgressSimulation() {
  progressValue.value = 12
  progressStage.value = 'Fetching track...'
  if (progressTimer) clearInterval(progressTimer)

  progressTimer = setInterval(() => {
    if (progressValue.value < 45) {
      progressValue.value += 7
      progressStage.value = 'Downloading audio...'
    }
    else if (progressValue.value < 78) {
      progressValue.value += 5
      progressStage.value = `Converting to ${selectedBitrateNum.value} kbps MP3...`
    }
    else if (progressValue.value < 92) {
      progressValue.value += 2
      progressStage.value = 'Preparing file...'
    }
  }, 600)
}

function stopProgressSimulation() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
  progressValue.value = 100
  setTimeout(() => {
    if (!isExtracting.value) {
      progressValue.value = 0
      progressStage.value = ''
    }
  }, 400)
}

const triggerInspect = useDebounceFn(async () => {
  const raw = urlInput.value.trim()
  if (!raw) {
    preview.value = null
    return
  }

  const parsed = parseMediaUrl(raw)
  if (!parsed || parsed.isPlaylist) {
    preview.value = null
    return
  }

  isInspecting.value = true
  try {
    const res = await $fetch<InspectResponse>('/api/inspect', {
      method: 'POST',
      body: {
        url: raw,
        bitrate: selectedBitrateNum.value,
      },
    })
    // Only apply if input still matches
    if (urlInput.value.trim() === raw) {
      preview.value = res
    }
  }
  catch {
    // Non-blocking preview failure
  }
  finally {
    isInspecting.value = false
  }
}, 400)

watch([urlInput, bitrate], () => {
  errorMessage.value = null
  if (!urlInput.value.trim()) {
    preview.value = null
    return
  }
  triggerInspect()
})

function triggerBrowserDownload(track: TrackMetadata) {
  if (!import.meta.client) return
  const anchor = document.createElement('a')
  anchor.href = track.downloadUrl
  anchor.download = track.fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

async function handlePasteClipboard() {
  try {
    const text = await navigator.clipboard.readText()
    if (text?.trim()) {
      urlInput.value = text.trim()
    }
  }
  catch {
    toast.error('Clipboard permission denied — press Cmd/Ctrl+V in the input')
  }
}

async function handleExtract(customUrl?: string, customBitrate?: AudioBitrate, forceRefresh = false) {
  const targetUrl = (customUrl ?? urlInput.value).trim()
  const targetBitrate = customBitrate ?? selectedBitrateNum.value

  if (!targetUrl) {
    errorMessage.value = 'Paste a YouTube or SoundCloud track URL to get started.'
    return
  }

  const parsed = parseMediaUrl(targetUrl)
  if (!parsed) {
    errorMessage.value = 'Unsupported link. Please enter a valid YouTube or SoundCloud track URL.'
    return
  }
  if (parsed.isPlaylist) {
    errorMessage.value = 'Playlists and sets are not supported in v1. Please paste a single track URL.'
    return
  }

  errorMessage.value = null
  isExtracting.value = true
  startProgressSimulation()

  try {
    const response = await $fetch<ExtractResponse>('/api/extract', {
      method: 'POST',
      body: {
        url: targetUrl,
        bitrate: targetBitrate,
        forceRefresh,
      },
    })

    activeResult.value = response
    upsertTrack(response.track)

    if (!customUrl) {
      preview.value = null
    }

    toast.success(
      response.cached
        ? 'MP3 ready!'
        : `"${response.track.title}" is ready`,
    )

    if (autoDownload.value) {
      triggerBrowserDownload(response.track)
    }
  }
  catch (err: any) {
    const msg =
      err?.data?.statusMessage ||
      err?.data?.message ||
      err?.statusMessage ||
      err?.message ||
      'Conversion failed. Please verify the track is public and try again.'
    errorMessage.value = msg
    toast.error(msg)
  }
  finally {
    isExtracting.value = false
    stopProgressSimulation()
  }
}

async function handleRecacheTrack(track: TrackMetadata) {
  busyRecacheKey.value = track.cacheKey
  try {
    await handleExtract(track.canonicalUrl, track.bitrate, true)
  }
  finally {
    busyRecacheKey.value = null
  }
}

function toggleTheme() {
  colorMode.preference = colorMode.value === 'dark' ? 'light' : 'dark'
}

onMounted(() => {
  syncWithServer()
})
</script>

<template>
  <div class="relative min-h-screen overflow-x-hidden">
    <!-- Subtle top radial glow -->
    <div
      class="pointer-events-none absolute inset-x-0 -top-40 -z-10 h-96 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/[0.07] via-background to-transparent"
    />

    <!-- Top Navigation Bar -->
    <header class="border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div class="container flex h-14 max-w-3xl items-center justify-between">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <AudioWaveform class="h-4 w-4" />
          </div>
          <span class="text-sm font-semibold tracking-tight">Wavelength</span>
        </div>

        <Button
          variant="ghost"
          size="icon"
          class="h-8 w-8"
          aria-label="Toggle color theme"
          @click="toggleTheme"
        >
          <ClientOnly>
            <Sun v-if="colorMode.value === 'dark'" class="h-4 w-4" />
            <Moon v-else class="h-4 w-4" />
            <template #fallback>
              <Sun class="h-4 w-4" />
            </template>
          </ClientOnly>
        </Button>
      </div>
    </header>

    <!-- Main Workspace -->
    <main class="container max-w-3xl space-y-8 py-10 sm:py-14">
      <!-- Hero Heading -->
      <section class="space-y-2.5 text-center">
        <h1 class="text-3xl font-bold tracking-tight sm:text-4xl">
          YouTube &amp; SoundCloud to MP3
        </h1>
        <p class="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
          Paste a track link below to convert and download high-quality MP3 audio.
        </p>
      </section>

      <!-- Converter Card -->
      <Card class="border-border/80 shadow-lg">
        <CardContent class="space-y-4 p-5 sm:p-6">
          <form class="space-y-4" @submit.prevent="handleExtract()">
            <!-- URL Input Row -->
            <div class="flex flex-col gap-2.5 sm:flex-row">
              <div class="relative flex-1">
                <Input
                  v-model="urlInput"
                  type="url"
                  placeholder="https://youtube.com/watch?v=... or https://soundcloud.com/..."
                  class="h-12 pr-28 text-sm font-normal"
                  :disabled="isExtracting"
                  autocomplete="off"
                  spellcheck="false"
                />

                <!-- Inline Right Controls (Detected Provider / Paste / Clear) -->
                <div class="absolute inset-y-0 right-2 flex items-center gap-1.5">
                  <PlatformBadge
                    v-if="parsedInput && !parsedInput.isPlaylist"
                    :provider="parsedInput.provider"
                  />

                  <Button
                    v-if="!urlInput"
                    type="button"
                    variant="secondary"
                    size="xs"
                    class="h-7 gap-1 px-2.5 text-xs"
                    @click="handlePasteClipboard"
                  >
                    <ClipboardPaste class="h-3.5 w-3.5" />
                    Paste
                  </Button>

                  <Button
                    v-else
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 text-muted-foreground hover:text-foreground"
                    aria-label="Clear URL"
                    :disabled="isExtracting"
                    @click="urlInput = ''"
                  >
                    <X class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                class="h-12 shrink-0 gap-2 px-6 font-medium"
                :disabled="isExtracting || !urlInput.trim()"
              >
                <Loader2 v-if="isExtracting" class="h-4 w-4 animate-spin" />
                <Download v-else class="h-4 w-4" />
                <span>{{ isExtracting ? 'Converting...' : 'Convert MP3' }}</span>
              </Button>
            </div>

            <!-- Options Bar: Quality & Auto-Download -->
            <div class="flex flex-wrap items-center justify-between gap-3 pt-0.5">
              <div class="flex items-center gap-2.5">
                <span class="text-xs font-medium text-muted-foreground">Bitrate</span>
                <Tabs v-model="bitrate" default-value="192">
                  <TabsList class="h-8">
                    <TabsTrigger value="128" class="px-2.5 font-mono text-xs" :disabled="isExtracting">
                      128k
                    </TabsTrigger>
                    <TabsTrigger value="192" class="px-2.5 font-mono text-xs" :disabled="isExtracting">
                      192k
                    </TabsTrigger>
                    <TabsTrigger value="320" class="px-2.5 font-mono text-xs" :disabled="isExtracting">
                      320k HQ
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <ClientOnly>
                <label class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground select-none">
                  <Switch v-model="autoDownload" />
                  <span>Auto-download when ready</span>
                </label>
              </ClientOnly>
            </div>
          </form>

          <!-- Live URL Auto-Inspect Preview -->
          <div
            v-if="(isInspecting || preview) && !isExtracting"
            class="flex items-center gap-3 rounded-lg border bg-muted/40 p-3 text-xs transition-all"
          >
            <template v-if="isInspecting && !preview">
              <Loader2 class="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
              <span class="text-muted-foreground">Fetching track metadata...</span>
            </template>

            <template v-else-if="preview">
              <img
                v-if="preview.thumbnail"
                :src="preview.thumbnail"
                :alt="preview.title"
                class="h-10 w-10 shrink-0 rounded object-cover border"
              >
              <div class="min-w-0 flex-1">
                <p class="truncate font-medium text-foreground">
                  {{ preview.title }}
                </p>
                <p class="truncate text-muted-foreground">
                  {{ preview.artist }}
                  <template v-if="preview.duration > 0">
                    · <span class="font-mono">{{ formatDuration(preview.duration) }}</span>
                  </template>
                </p>
              </div>
              <Badge
                v-if="preview.cachedTrack"
                variant="outline"
                class="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              >
                <Zap class="h-3 w-3" />
                Instant
              </Badge>
            </template>
          </div>

          <!-- Conversion Progress Bar -->
          <div v-if="isExtracting" class="space-y-2 rounded-lg border bg-muted/35 p-3.5">
            <div class="flex items-center justify-between text-xs">
              <span class="font-medium text-foreground">{{ progressStage }}</span>
              <span class="font-mono text-muted-foreground">{{ progressValue }}%</span>
            </div>
            <Progress :model-value="progressValue" />
          </div>

          <!-- Error Alert -->
          <div
            v-if="errorMessage"
            class="flex items-start gap-2.5 rounded-lg border border-destructive/35 bg-destructive/10 p-3.5 text-xs text-destructive dark:text-red-400"
          >
            <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
            <div class="space-y-1">
              <p class="font-medium leading-relaxed">
                {{ errorMessage }}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- Active Converted / Cached Track Card -->
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-2"
        enter-to-class="opacity-100 translate-y-0"
      >
        <section v-if="activeResult" class="space-y-2.5">
          <div class="flex items-center justify-between">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Ready to Download
            </h2>
          </div>
          <ActiveTrackCard
            :track="activeResult.track"
            :was-cached-hit="activeResult.cached"
            :now="now"
          />
        </section>
      </Transition>

      <Separator />

      <!-- Recent Downloads -->
      <ClientOnly>
        <VaultList
          :items="vaultItems"
          :now="now"
          :is-expired="isTrackExpired"
          :busy-key="busyRecacheKey"
          @recache="handleRecacheTrack"
          @remove="removeTrack"
          @clear="clearVault"
        />
      </ClientOnly>
    </main>
  </div>
</template>
