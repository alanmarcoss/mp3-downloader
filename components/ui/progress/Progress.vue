<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { ProgressIndicator, ProgressRoot, type ProgressRootProps } from 'reka-ui'
import { computed } from 'vue'
import { cn } from '~/lib/utils'

const props = withDefaults(
  defineProps<ProgressRootProps & { class?: HTMLAttributes['class'] }>(),
  {
    modelValue: 0,
  },
)

const delegatedProps = computed(() => {
  const { class: _, ...delegated } = props
  return delegated
})
</script>

<template>
  <ProgressRoot
    v-bind="delegatedProps"
    :class="cn('relative h-1.5 w-full overflow-hidden rounded-full bg-primary/15', props.class)"
  >
    <ProgressIndicator
      class="h-full w-full flex-1 bg-primary transition-all duration-300 ease-out"
      :style="`transform: translateX(-${100 - (props.modelValue ?? 0)}%);`"
    />
  </ProgressRoot>
</template>
