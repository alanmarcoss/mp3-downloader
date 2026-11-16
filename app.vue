<script setup lang="ts">
import { Toaster } from 'vue-sonner'

const colorMode = useColorMode()
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <NuxtPage />
    <ClientOnly>
      <Toaster
        position="bottom-right"
        :theme="(colorMode.value as 'light' | 'dark') || 'dark'"
        rich-colors
      />
    </ClientOnly>
  </div>
</template>
