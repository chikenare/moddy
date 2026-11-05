<script setup lang="ts">
import { ArrowDown, ArrowUp, Minus } from '@lucide/vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { delta as compare, formatCount } from '@/lib/metrics'

const props = defineProps<{ label: string; value: number; previous: number; period: number }>()
const { t, locale } = useI18n()
const d = computed(() => compare(props.value, props.previous))
const change = computed(() => d.value.direction === 'flat' ? t('chart.noChange') : d.value.direction === 'new' ? t('chart.new') : d.value.text)
</script>

<template>
  <div class="rounded-xl border bg-card p-4">
    <div class="text-sm text-muted-foreground">{{ label }}</div>
    <div class="mt-1 text-3xl font-semibold tracking-tight">{{ formatCount(value, locale) }}</div>
    <div class="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground" :title="t('chart.previous', { period, value: previous.toLocaleString(locale) })">
      <ArrowUp v-if="d.direction === 'up' || d.direction === 'new'" class="size-3.5" />
      <ArrowDown v-else-if="d.direction === 'down'" class="size-3.5" />
      <Minus v-else class="size-3.5" />
      <span class="whitespace-nowrap font-medium text-foreground">{{ change }}</span>
      <span class="whitespace-nowrap">{{ t('chart.versus', { period }) }}</span>
    </div>
  </div>
</template>
