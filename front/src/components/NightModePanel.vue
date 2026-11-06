<script setup lang="ts">
import { Moon, Sun, TriangleAlert } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import RichTextEditor from '@/components/RichTextEditor.vue'
import type { FormattedMessage, NightMode, NightModeSettings } from '@/lib/api'
import { weekdayLabels } from '@/lib/schedule'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)
const { t, locale } = useI18n()

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const zones = Intl.supportedValuesOf('timeZone')
const weekdays = computed(() => weekdayLabels(locale.value))
// Monday first reads more naturally in a week of nights.
const dayOrder = [1, 2, 3, 4, 5, 6, 0]

const settingsOf = (n: NightMode): NightModeSettings => ({
  enabled: n.enabled, closeTime: n.closeTime, openTime: n.openTime, timezone: n.timezone, days: [...n.days],
  closeNotice: { ...n.closeNotice }, openNotice: { ...n.openNotice }, deleteCloseNotice: n.deleteCloseNotice,
})

// A group that never saved it starts from the browser's zone and notices in the panel's language.
function initialDraft(n: NightMode): NightModeSettings {
  const s = settingsOf(n)
  if (n.configured) return s
  return {
    ...s, timezone: browserZone,
    closeNotice: { ...s.closeNotice, text: s.closeNotice.text || t('nightMode.defaultClose') },
    openNotice: { ...s.openNotice, text: s.openNotice.text || t('nightMode.defaultOpen') },
  }
}

const night = computed(() => store.nightMode!)
const draft = ref<NightModeSettings>(initialDraft(night.value))
// The notice texts live apart: the editor keeps its cursor only while it gets back the object it emitted.
const closeMessage = ref<FormattedMessage>(textOf(draft.value.closeNotice))
const openMessage = ref<FormattedMessage>(textOf(draft.value.openNotice))
function textOf(n: { text: string; entities: FormattedMessage['entities'] }): FormattedMessage {
  return { text: n.text, entities: n.entities }
}
const settings = computed<NightModeSettings>(() => ({
  ...draft.value,
  days: [...draft.value.days].sort((a, b) => a - b),
  closeNotice: { enabled: draft.value.closeNotice.enabled, ...closeMessage.value },
  openNotice: { enabled: draft.value.openNotice.enabled, ...openMessage.value },
}))

const key = (s: NightModeSettings) => JSON.stringify(s)
// Only a change of the saved settings resets the form; closing or opening now must not drop unsaved edits.
watch(() => key(settingsOf(night.value)), () => {
  draft.value = initialDraft(night.value)
  closeMessage.value = textOf(draft.value.closeNotice)
  openMessage.value = textOf(draft.value.openNotice)
})

const dirty = computed(() => !night.value.configured || key(settings.value) !== key(settingsOf(night.value)))
const zoneValid = computed(() => zones.includes(draft.value.timezone) || draft.value.timezone === 'UTC')
const problem = computed(() => {
  const d = draft.value
  if (!d.closeTime || !d.openTime) return t('nightMode.problem.times')
  if (d.closeTime === d.openTime) return t('nightMode.problem.sameTime')
  if (d.enabled && !d.days.length) return t('nightMode.problem.noDays')
  if (!zoneValid.value) return t('nightMode.problem.zone')
  if ((d.closeNotice.enabled && !closeMessage.value.text.trim()) || (d.openNotice.enabled && !openMessage.value.text.trim())) return t('nightMode.problem.notice')
  return null
})

const set = (patch: Partial<NightModeSettings>) => { draft.value = { ...draft.value, ...patch } }
const toggleDay = (day: number) => {
  const days = draft.value.days
  set({ days: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] })
}
const setNoticeOn = (which: 'closeNotice' | 'openNotice', enabled: boolean) => set({ [which]: { ...draft.value[which], enabled } })

const saving = ref(false)
async function save() {
  saving.value = true
  try {
    await store.saveNightMode(settings.value)
    toast.success(t('nightMode.saved'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('common.saveChangeFailed'))
  } finally {
    saving.value = false
  }
}

const switching = ref(false)
async function now(action: 'close' | 'open') {
  switching.value = true
  try {
    await store.setNightNow(action)
    toast.success(action === 'close' ? t('nightMode.closedNow') : t('nightMode.openedNow'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('common.saveChangeFailed'))
  } finally {
    switching.value = false
  }
}

const closed = computed(() => night.value.state === 'closed')
const zoneNote = computed(() => (night.value.timezone === browserZone ? '' : ` (${night.value.timezone})`))
const statusDetail = computed(() => {
  const n = night.value
  const times = { open: n.openTime + zoneNote.value, close: n.closeTime + zoneNote.value }
  if (closed.value) {
    if (!n.enabled) return t('nightMode.status.closedNoSchedule')
    return n.override ? t('nightMode.status.closedByHand', times) : t('nightMode.status.closedUntil', times)
  }
  if (!n.enabled) return t('nightMode.status.noSchedule')
  const key = n.days.length === 7 ? 'closesAt' : 'closesOnNights'
  return n.override ? t(`nightMode.status.openedByHand.${key}`, times) : t(`nightMode.status.${key}`, times)
})
</script>

<template>
  <div class="space-y-4">
    <Card class="py-4">
      <CardContent class="flex flex-wrap items-center gap-4 px-4">
        <div class="flex size-10 shrink-0 items-center justify-center rounded-full" :class="closed ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'">
          <Moon v-if="closed" class="size-5" /><Sun v-else class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold">{{ closed ? t('nightMode.status.closed') : t('nightMode.status.open') }}</p>
          <p class="text-sm text-muted-foreground">{{ statusDetail }}</p>
        </div>
        <Button variant="outline" :disabled="switching" @click="now(closed ? 'open' : 'close')">
          {{ closed ? t('nightMode.openNow') : t('nightMode.closeNow') }}
        </Button>
      </CardContent>
    </Card>

    <Alert v-if="night.error" variant="destructive">
      <TriangleAlert />
      <AlertDescription>{{ t('nightMode.error', { error: night.error }) }}</AlertDescription>
    </Alert>

    <form class="space-y-4" @submit.prevent="save">
      <Card class="py-4">
        <CardContent class="space-y-4 px-4">
          <div class="flex items-center gap-4">
            <div class="min-w-0 flex-1">
              <Label for="night-enabled" class="text-base font-semibold">{{ t('nightMode.schedule') }}</Label>
              <p class="text-sm text-muted-foreground">{{ t('nightMode.scheduleHint') }}</p>
            </div>
            <Switch id="night-enabled" :model-value="draft.enabled" @update:model-value="(v: boolean) => set({ enabled: v })" />
          </div>

          <div class="flex flex-wrap items-end gap-3">
            <div class="space-y-1">
              <Label for="night-close">{{ t('nightMode.closeAt') }}</Label>
              <Input id="night-close" :model-value="draft.closeTime" type="time" class="w-fit" @update:model-value="(v) => set({ closeTime: String(v) })" />
            </div>
            <div class="space-y-1">
              <Label for="night-open">{{ t('nightMode.openAt') }}</Label>
              <Input id="night-open" :model-value="draft.openTime" type="time" class="w-fit" @update:model-value="(v) => set({ openTime: String(v) })" />
            </div>
            <div class="min-w-48 flex-1 space-y-1">
              <Label for="night-zone">{{ t('nightMode.timeZone') }}</Label>
              <Input
                id="night-zone" :model-value="draft.timezone" list="night-zones" autocomplete="off" spellcheck="false"
                :aria-invalid="zoneValid ? undefined : true" @update:model-value="(v) => set({ timezone: String(v).trim() })"
              />
              <datalist id="night-zones"><option v-for="z in zones" :key="z" :value="z" /></datalist>
            </div>
          </div>

          <div class="space-y-2">
            <span class="text-sm font-medium">{{ t('nightMode.nights') }}</span>
            <div class="flex flex-wrap gap-2" role="group" :aria-label="t('nightMode.nights')">
              <Button
                v-for="day in dayOrder" :key="day" type="button" size="sm"
                :variant="draft.days.includes(day) ? 'default' : 'outline'" :aria-pressed="draft.days.includes(day)" @click="toggleDay(day)"
              >{{ weekdays[day] }}</Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('nightMode.nightsHint') }}</p>
          </div>
        </CardContent>
      </Card>

      <Card class="py-4">
        <CardContent class="space-y-3 px-4">
          <div class="flex items-center gap-4">
            <Label for="night-close-notice" class="min-w-0 flex-1 font-medium">{{ t('nightMode.closeNotice') }}</Label>
            <Switch id="night-close-notice" :model-value="draft.closeNotice.enabled" @update:model-value="(v: boolean) => setNoticeOn('closeNotice', v)" />
          </div>
          <template v-if="draft.closeNotice.enabled">
            <RichTextEditor v-model="closeMessage" :label="t('nightMode.closeNotice')" />
            <div class="flex items-center gap-2">
              <Checkbox id="night-delete" :model-value="draft.deleteCloseNotice" @update:model-value="(v) => set({ deleteCloseNotice: v === true })" />
              <Label for="night-delete" class="font-normal">{{ t('nightMode.deleteCloseNotice') }}</Label>
            </div>
          </template>
        </CardContent>
      </Card>

      <Card class="py-4">
        <CardContent class="space-y-3 px-4">
          <div class="flex items-center gap-4">
            <Label for="night-open-notice" class="min-w-0 flex-1 font-medium">{{ t('nightMode.openNotice') }}</Label>
            <Switch id="night-open-notice" :model-value="draft.openNotice.enabled" @update:model-value="(v: boolean) => setNoticeOn('openNotice', v)" />
          </div>
          <RichTextEditor v-if="draft.openNotice.enabled" v-model="openMessage" :label="t('nightMode.openNotice')" />
        </CardContent>
      </Card>

      <p class="text-xs text-muted-foreground">{{ t('nightMode.permissionsNote') }}</p>
      <div class="flex flex-wrap items-center justify-end gap-3">
        <p v-if="problem" class="text-sm text-destructive">{{ problem }}</p>
        <Button type="submit" :disabled="saving || !dirty || problem !== null">{{ t('common.save') }}</Button>
      </div>
    </form>
  </div>
</template>
