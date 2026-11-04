<script setup lang="ts">
import { ArrowDown, ArrowUp, Minus } from '@lucide/vue'
import { computed } from 'vue'
import { delta as compare, formatCount } from '@/lib/metrics'

const props = defineProps<{ label: string; value: number; previous: number; period: number }>()
const d = computed(() => compare(props.value, props.previous))
</script>

<template>
  <div class="rounded-xl border bg-card p-4">
    <div class="text-sm text-muted-foreground">{{ label }}</div>
    <div class="mt-1 text-3xl font-semibold tracking-tight">{{ formatCount(value) }}</div>
    <div class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground" :title="`Previous ${period} days: ${previous.toLocaleString('en-US')}`">
      <ArrowUp v-if="d.direction === 'up' || d.direction === 'new'" class="size-3.5" />
      <ArrowDown v-else-if="d.direction === 'down'" class="size-3.5" />
      <Minus v-else class="size-3.5" />
      <span class="whitespace-nowrap font-medium text-foreground">{{ d.text }}</span>
      <span class="whitespace-nowrap">vs prev. {{ period }}d</span>
    </div>
  </div>
</template>
