<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import BarList from '@/components/charts/BarList.vue'
import LineChart from '@/components/charts/LineChart.vue'
import StatTile from '@/components/charts/StatTile.vue'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { hasActivity, ruleHits } from '@/lib/metrics'
import { useMetricsStore } from '@/stores/metrics'

const props = defineProps<{ chatId?: number }>()
const store = useMetricsStore(props.chatId)
const { t } = useI18n()
// `t` is also the name of the totals below.
const tr = t

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
    { label: tr('overview.tile.messages'), value: t.messages, previous: p.messages },
    { label: tr('overview.tile.joins'), value: t.joins, previous: p.joins },
    { label: tr('overview.tile.leaves'), value: t.leaves, previous: p.leaves },
    { label: tr('overview.tile.ruleHits'), value: ruleHits(t), previous: ruleHits(p) },
    { label: tr('overview.tile.deleted'), value: t.deleted, previous: p.deleted },
    { label: tr('overview.tile.banned'), value: t.banned, previous: p.banned },
    { label: tr('overview.tile.autoReplies'), value: t.auto_replies, previous: p.auto_replies },
    { label: tr('overview.tile.broadcasts'), value: t.broadcasts, previous: p.broadcasts },
  ]
})

const dayList = computed(() => data.value?.series.map((s) => s.day) ?? [])
const activity = computed(() => [{ name: t('overview.tile.messages'), color: 'var(--viz-1)', values: data.value?.series.map((s) => s.messages) ?? [] }])
const members = computed(() => [
  { name: t('overview.joined'), color: 'var(--viz-1)', values: data.value?.series.map((s) => s.joins) ?? [] },
  { name: t('overview.left'), color: 'var(--viz-2)', values: data.value?.series.map((s) => s.leaves) ?? [] },
])
const filters = computed(() => {
  const t = data.value?.totals
  if (!t) return []
  return [
    { key: 'link', label: tr('filter.link'), value: t.link_hits },
    { key: 'word', label: tr('filter.word'), value: t.word_hits },
    { key: 'flood', label: tr('filter.flood'), value: t.flood_hits },
    { key: 'bot', label: tr('filter.bot'), value: t.bot_hits },
  ].sort((a, b) => b.value - a.value)
})
const words = computed(() => data.value?.topWords.map((w) => ({ key: w.value, label: w.value, value: w.count })) ?? [])
const domains = computed(() => data.value?.topDomains.map((w) => ({ key: w.value, label: w.value, value: w.count })) ?? [])
const groups = computed(() =>
  data.value?.topChats.map((c) => ({ key: c.id, label: c.title, value: c.messages, note: c.actions ? t('overview.hitsNote', c.actions) : undefined, to: `/chats/${c.id}` })) ?? [],
)
const empty = computed(() => data.value !== null && !hasActivity(data.value.totals))
</script>

<template>
  <div class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div role="radiogroup" :aria-label="t('overview.period')" class="inline-flex rounded-lg bg-muted p-0.5">
        <button
          v-for="p in PERIODS" :key="p" type="button" role="radio" :aria-checked="days === p"
          class="rounded-md px-3 py-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-checked:bg-background aria-checked:text-foreground aria-checked:shadow-sm"
          @click="days = p"
        >{{ t('overview.days', { n: p }) }}</button>
      </div>
      <p v-if="data" class="text-xs text-muted-foreground">{{ t('overview.utcNote') }}</p>
    </div>

    <p v-if="!data && store.loading" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-else-if="!data && store.error" class="text-sm text-destructive">{{ store.error }}</p>

    <div v-else-if="data" class="space-y-5 transition-opacity" :class="store.loading ? 'opacity-60' : ''">
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile v-for="tile in tiles" :key="tile.label" v-bind="tile" :period="days" />
      </div>

      <Card v-if="empty">
        <CardContent class="py-10 text-center">
          <p class="font-medium">{{ t('overview.emptyTitle', { days }) }}</p>
          <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{{ t('overview.emptyBody') }}</p>
        </CardContent>
      </Card>

      <template v-else>
        <Card>
          <CardHeader>
            <CardTitle>{{ t('overview.messagesPerDay') }}</CardTitle>
            <CardDescription>{{ t('overview.messagesPerDayHint') }}</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart :days="dayList" :series="activity" :label="t('overview.messagesPerDay')" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{{ t('overview.members') }}</CardTitle>
            <CardDescription>{{ t('overview.membersHint') }}</CardDescription>
          </CardHeader>
          <CardContent>
            <LineChart :days="dayList" :series="members" :label="t('overview.membersLabel')" :height="170" />
          </CardContent>
        </Card>

        <div class="grid gap-5 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{{ t('overview.hits') }}</CardTitle><CardDescription>{{ t('overview.hitsHint') }}</CardDescription></CardHeader>
            <CardContent><BarList :items="filters" :empty="t('overview.hitsEmpty')" /></CardContent>
          </Card>
          <Card v-if="chatId === undefined">
            <CardHeader><CardTitle>{{ t('overview.groups') }}</CardTitle><CardDescription>{{ t('overview.groupsHint') }}</CardDescription></CardHeader>
            <CardContent><BarList :items="groups" :empty="t('overview.groupsEmpty')" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{{ t('overview.words') }}</CardTitle><CardDescription>{{ t('overview.wordsHint') }}</CardDescription></CardHeader>
            <CardContent><BarList :items="words" :empty="t('overview.wordsEmpty')" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{{ t('overview.domains') }}</CardTitle><CardDescription>{{ t('overview.domainsHint') }}</CardDescription></CardHeader>
            <CardContent><BarList :items="domains" :empty="t('overview.domainsEmpty')" /></CardContent>
          </Card>
        </div>
      </template>
    </div>
  </div>
</template>
