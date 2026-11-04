<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import BarList from '@/components/charts/BarList.vue'
import LineChart from '@/components/charts/LineChart.vue'
import StatTile from '@/components/charts/StatTile.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hasActivity, ruleHits } from '@/lib/metrics'
import { useMetricsStore } from '@/stores/metrics'

const props = defineProps<{ chatId?: number }>()
const store = useMetricsStore(props.chatId)

const PERIODS = [7, 30, 90] as const
const days = ref<number>(30)
const data = computed(() => store.data)

const load = () => store.load(days.value)
onMounted(load)
watch(days, load)
watch(() => store.error, (msg) => { if (msg) toast.error(msg) })

const tiles = computed(() => {
  const d = data.value
  if (!d) return []
  const t = d.totals
  const p = d.previous
  return [
    { label: 'Messages', value: t.messages, previous: p.messages },
    { label: 'Members joined', value: t.joins, previous: p.joins },
    { label: 'Members left', value: t.leaves, previous: p.leaves },
    { label: 'Rule hits', value: ruleHits(t), previous: ruleHits(p) },
    { label: 'Messages deleted', value: t.deleted, previous: p.deleted },
    { label: 'Members banned', value: t.banned, previous: p.banned },
    { label: 'Auto replies', value: t.auto_replies, previous: p.auto_replies },
    { label: 'Broadcasts sent', value: t.broadcasts, previous: p.broadcasts },
  ]
})

const dayList = computed(() => data.value?.series.map((s) => s.day) ?? [])
const activity = computed(() => [{ name: 'Messages', color: 'var(--viz-1)', values: data.value?.series.map((s) => s.messages) ?? [] }])
const members = computed(() => [
  { name: 'Joined', color: 'var(--viz-1)', values: data.value?.series.map((s) => s.joins) ?? [] },
  { name: 'Left', color: 'var(--viz-2)', values: data.value?.series.map((s) => s.leaves) ?? [] },
])
const filters = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { key: 'link', label: 'Links', value: t.link_hits },
    { key: 'word', label: 'Words', value: t.word_hits },
    { key: 'flood', label: 'Flood', value: t.flood_hits },
    { key: 'bot', label: 'Bots', value: t.bot_hits },
  ].sort((a, b) => b.value - a.value)
})
const words = computed(() => data.value?.topWords.map((w) => ({ key: w.value, label: w.value, value: w.count })) ?? [])
const domains = computed(() => data.value?.topDomains.map((w) => ({ key: w.value, label: w.value, value: w.count })) ?? [])
const groups = computed(() =>
  data.value?.topChats.map((c) => ({ key: c.id, label: c.title, value: c.messages, note: c.actions ? `${c.actions} hits` : undefined, to: `/chats/${c.id}` })) ?? [],
)
const empty = computed(() => data.value !== null && !hasActivity(data.value.totals))
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div role="radiogroup" aria-label="Period" class="inline-flex rounded-lg bg-muted p-0.5">
        <button
          v-for="p in PERIODS" :key="p" type="button" role="radio" :aria-checked="days === p"
          class="rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm"
          @click="days = p"
        >{{ p }} days</button>
      </div>
      <p v-if="data" class="text-xs text-muted-foreground">Days are counted in UTC. Today is included.</p>
    </div>

    <p v-if="!data && store.loading" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="!data && store.error" class="text-sm text-destructive">{{ store.error }}</p>

    <div v-else-if="data" class="space-y-5 transition-opacity" :class="store.loading ? 'opacity-60' : ''">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile v-for="t in tiles" :key="t.label" v-bind="t" :period="days" />
      </div>

      <Card v-if="empty">
        <CardContent class="py-10 text-center">
          <p class="font-medium">Nothing recorded in these {{ days }} days</p>
          <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            The bot counts messages, members and actions in groups that have moderation or auto replies turned on.
            Numbers appear here as soon as the group has activity.
          </p>
        </CardContent>
      </Card>

      <template v-else>
        <Card>
          <CardHeader>
            <CardTitle>Messages per day</CardTitle>
            <CardDescription>People writing in the group. Service messages and bots are not counted.</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart :days="dayList" :series="activity" label="Messages per day" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Members joining and leaving</CardTitle>
            <CardDescription>Bots are not counted.</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart :days="dayList" :series="members" label="Members joined and left per day" :height="170" />
          </CardContent>
        </Card>

        <div class="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Hits by filter</CardTitle><CardDescription>Messages caught by each rule.</CardDescription></CardHeader>
            <CardContent><BarList :items="filters" empty="No filter has caught anything." /></CardContent>
          </Card>
          <Card v-if="chatId === undefined">
            <CardHeader><CardTitle>Most active groups</CardTitle><CardDescription>By messages written.</CardDescription></CardHeader>
            <CardContent><BarList :items="groups" empty="No group activity yet." /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Top words</CardTitle><CardDescription>Banned words that matched most.</CardDescription></CardHeader>
            <CardContent><BarList :items="words" empty="No banned word matched." /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Top domains</CardTitle><CardDescription>Blocked links, by site.</CardDescription></CardHeader>
            <CardContent><BarList :items="domains" empty="No link was blocked." /></CardContent>
          </Card>
        </div>
      </template>
    </div>
  </div>
</template>
