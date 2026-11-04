<script setup lang="ts">
import { computed } from 'vue'
import { formatCount } from '@/lib/metrics'

export interface BarItem { key: string | number; label: string; value: number; note?: string; to?: string }

const props = defineProps<{ items: BarItem[]; empty: string; color?: string }>()
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)))
</script>

<template>
  <p v-if="!items.length" class="py-6 text-center text-sm text-muted-foreground">{{ empty }}</p>
  <ul v-else class="space-y-2.5">
    <li v-for="item in items" :key="item.key" class="space-y-1" :title="`${item.label}: ${item.value.toLocaleString('en-US')}`">
      <div class="flex items-baseline justify-between gap-3 text-sm">
        <RouterLink v-if="item.to" :to="item.to" class="min-w-0 truncate hover:underline">{{ item.label }}</RouterLink>
        <span v-else class="min-w-0 truncate">{{ item.label }}</span>
        <span class="shrink-0 font-semibold tabular-nums">{{ formatCount(item.value) }}<span v-if="item.note" class="ml-2 font-normal text-muted-foreground">{{ item.note }}</span></span>
      </div>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full" :style="{ width: `${Math.max(2, (item.value / max) * 100)}%`, background: color ?? 'var(--viz-1)' }" />
      </div>
    </li>
  </ul>
</template>
