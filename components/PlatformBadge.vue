<script setup lang="ts">
import type { Provider } from '~/types/track'
import { cn } from '~/lib/utils'

const props = defineProps<{
  provider: Provider
  compact?: boolean
  class?: string
}>()
</script>

<template>
  <span
    :class="
      cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium tracking-tight transition-colors',
        props.provider === 'youtube'
          ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400'
          : 'border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400',
        props.class,
      )
    "
  >
    <!-- YouTube Play Emblem -->
    <svg
      v-if="props.provider === 'youtube'"
      viewBox="0 0 24 24"
      fill="currentColor"
      class="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
    <!-- SoundCloud Cloud Emblem -->
    <svg
      v-else
      viewBox="0 0 24 24"
      fill="currentColor"
      class="h-3.5 w-3.5 shrink-0"
      aria-hidden="true"
    >
      <path d="M11.56 8.87V17h8.76c1.85-.13 2.68-1.27 2.68-2.67 0-1.48-1.12-2.67-2.58-2.67-.35 0-.7.08-1.01.21-.24-2.52-2.36-4.5-4.95-4.5-1.12 0-2.15.37-2.9.9zm-2.18.93V17h1.25V9.36c-.44.12-.86.27-1.25.44zm-2.14 1.46V17h1.21v-6.06c-.43.1-.83.21-1.21.32zm-2.12 1.25V17h1.18v-4.74c-.42.08-.81.16-1.18.25zm-2.11 1.32V17h1.15v-3.17h-.15c-.35 0-.69.06-1 .17zM1 14.95V17h1.09v-2.16c-.41.04-.77.08-1.09.11z" />
    </svg>
    <span v-if="!props.compact">
      {{ props.provider === 'youtube' ? 'YouTube' : 'SoundCloud' }}
    </span>
  </span>
</template>
