<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import { formatCount, niceMax, shortDay } from '@/lib/metrics'

export interface LineSeries { name: string; color: string; values: number[] }

const props = defineProps<{ days: string[]; series: LineSeries[]; label: string; height?: number }>()

const box = ref<HTMLElement | null>(null)
const { width } = useElementSize(box)
const H = computed(() => props.height ?? 200)
const PAD = { top: 10, right: 12, bottom: 24, left: 36 }
const w = computed(() => Math.max(width.value, 200))
const innerW = computed(() => w.value - PAD.left - PAD.right)
const innerH = computed(() => H.value - PAD.top - PAD.bottom)

const max = computed(() => niceMax(Math.max(0, ...props.series.flatMap((s) => s.values))))
const ticks = computed(() => [0, 1, 2, 3, 4].map((i) => (max.value / 4) * i))
const x = (i: number) => PAD.left + (props.days.length < 2 ? innerW.value / 2 : (innerW.value * i) / (props.days.length - 1))
const y = (v: number) => PAD.top + innerH.value - (innerH.value * v) / max.value

const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
const areaPath = (values: number[]) =>
  `${path(values)} L${x(values.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`

// About 5 labels fit at any width; fewer on a narrow screen.
const xLabels = computed(() => {
  const count = w.value < 420 ? 3 : 5
  const last = props.days.length - 1
  if (last < 1) return [0]
  return [...new Set(Array.from({ length: count }, (_, k) => Math.round((last * k) / (count - 1))))]
})

const active = ref<number | null>(null)
function move(e: PointerEvent) {
  const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
  const ratio = (e.clientX - rect.left - PAD.left) / innerW.value
  active.value = Math.min(props.days.length - 1, Math.max(0, Math.round(ratio * (props.days.length - 1))))
}
function key(e: KeyboardEvent) {
  const last = props.days.length - 1
  if (e.key === 'ArrowLeft') active.value = Math.max(0, (active.value ?? last) - 1)
  else if (e.key === 'ArrowRight') active.value = Math.min(last, (active.value ?? -1) + 1)
  else if (e.key === 'Escape') active.value = null
  else return
  e.preventDefault()
}

// The tooltip flips to the left of the crosshair near the right edge.
const tipLeft = computed(() => (active.value !== null && x(active.value) > w.value * 0.6))
const single = computed(() => props.series.length === 1)
</script>

<template>
  <div class="space-y-2">
    <div v-if="series.length > 1" class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span v-for="s in series" :key="s.name" class="inline-flex items-center gap-1.5">
        <span class="h-0.5 w-3 rounded-full" :style="{ background: s.color }" />{{ s.name }}
      </span>
    </div>

    <div ref="box" class="relative w-full">
      <svg
        v-if="width"
        :width="w" :height="H" role="img" tabindex="0" :aria-label="label"
        class="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        @pointermove="move" @pointerleave="active = null" @keydown="key" @blur="active = null"
      >
        <g>
          <template v-for="t in ticks" :key="t">
            <line :x1="PAD.left" :x2="w - PAD.right" :y1="y(t)" :y2="y(t)" :stroke="t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'" stroke-width="1" />
            <text :x="PAD.left - 6" :y="y(t)" dy="0.32em" text-anchor="end" font-size="11" fill="var(--viz-muted)">{{ formatCount(t) }}</text>
          </template>
          <text v-for="i in xLabels" :key="i" :x="x(i)" :y="H - 6" font-size="11" fill="var(--viz-muted)"
            :text-anchor="i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'">{{ shortDay(days[i]!) }}</text>
        </g>

        <path v-if="single" :d="areaPath(series[0]!.values)" :fill="series[0]!.color" fill-opacity="0.1" />
        <path v-for="s in series" :key="s.name" :d="path(s.values)" fill="none" :stroke="s.color" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />

        <template v-if="active !== null">
          <line :x1="x(active)" :x2="x(active)" :y1="PAD.top" :y2="y(0)" stroke="var(--viz-axis)" stroke-width="1" />
          <circle v-for="s in series" :key="s.name" :cx="x(active)" :cy="y(s.values[active]!)" r="4" :fill="s.color" stroke="var(--card)" stroke-width="2" />
        </template>
        <template v-else>
          <circle v-for="s in series" :key="s.name" :cx="x(days.length - 1)" :cy="y(s.values[days.length - 1]!)" r="4" :fill="s.color" stroke="var(--card)" stroke-width="2" />
        </template>
      </svg>

      <div
        v-if="active !== null && width"
        class="pointer-events-none absolute top-1 z-10 min-w-28 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
        :style="tipLeft ? { right: `${w - x(active) + 10}px` } : { left: `${x(active) + 10}px` }"
      >
        <div class="mb-1 text-muted-foreground">{{ shortDay(days[active]!) }}</div>
        <div v-for="s in series" :key="s.name" class="flex items-center justify-between gap-3">
          <span class="inline-flex items-center gap-1.5 text-muted-foreground">
            <span class="h-0.5 w-3 rounded-full" :style="{ background: s.color }" />{{ s.name }}
          </span>
          <span class="font-semibold tabular-nums text-foreground">{{ s.values[active]!.toLocaleString('en-US') }}</span>
        </div>
      </div>
    </div>

    <details class="text-xs text-muted-foreground">
      <summary class="w-fit cursor-pointer select-none hover:text-foreground">View as table</summary>
      <div class="mt-2 max-h-56 overflow-auto rounded-md border">
        <table class="w-full">
          <thead class="sticky top-0 bg-card text-left">
            <tr><th class="px-2 py-1 font-medium">Day</th><th v-for="s in series" :key="s.name" class="px-2 py-1 text-right font-medium">{{ s.name }}</th></tr>
          </thead>
          <tbody>
            <tr v-for="(d, i) in days" :key="d" class="border-t">
              <td class="px-2 py-1">{{ shortDay(d) }}</td>
              <td v-for="s in series" :key="s.name" class="px-2 py-1 text-right tabular-nums">{{ s.values[i] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
