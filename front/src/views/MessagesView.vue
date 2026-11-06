<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import FormattedText from '@/components/FormattedText.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import ChatAvatar from '@/components/ChatAvatar.vue'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type FormattedMessage, type RecurringMessage, type ScheduledMessage, type TargetStatus } from '@/lib/api'
import { EMPTY_MESSAGE } from '@/lib/formatting'
import { buildCron, DEFAULT_REPEAT, describeRepeat, HOUR_STEPS, parseCron, type RepeatForm, type RepeatKind, weekdayLabels } from '@/lib/schedule'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'

type Mode = 'now' | 'later' | 'repeat'

const POLL_MS = 5000
const PREVIEW_DELAY_MS = 300
const PREVIEW_SHOWN = 3

const { t, locale } = useI18n()
const chats = useChatsStore()
const store = useMessagesStore()

// Anyone can add the bot to a group, so only chats the owner switched something on in count as "active".
const isActive = (c: { moderationEnabled: boolean; autoRepliesEnabled: boolean }) => c.moderationEnabled || c.autoRepliesEnabled
const available = computed(() =>
  chats.chats.filter((c) => c.botStatus !== 'left' && c.botStatus !== 'kicked')
    .sort((a, b) => Number(isActive(b)) - Number(isActive(a))))
const activeIds = computed(() => available.value.filter(isActive).map((c) => c.id))
const message = ref<FormattedMessage>(EMPTY_MESSAGE)
const selected = ref<number[]>([])
const mode = ref<Mode>('now')
const when = ref('')
const repeat = ref<RepeatForm>({ ...DEFAULT_REPEAT })
const editingId = ref<number | null>(null)
const editingZone = ref<string | null>(null)
const busy = ref(false)
const confirmOpen = ref(false)
// Kept after the dialog closes: the confirm button closes it before its own handler runs.
const deleting = ref<RecurringMessage | null>(null)
const deleteOpen = ref(false)

const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const timeZone = computed(() => editingZone.value ?? browserZone)
const fmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }))
const format = (ts: number) => fmt.value.format(new Date(ts * 1000))
const zoneFormat = (ts: number, zone: string) =>
  new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(ts * 1000))

const modes: Mode[] = ['now', 'later', 'repeat']
const repeatKinds: RepeatKind[] = ['daily', 'weekdays', 'monthday', 'hours', 'custom']
const weekdays = computed(() => weekdayLabels(locale.value))

const toggleChat = (id: number, on: boolean) => {
  selected.value = on ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}
const allSelected = computed(() =>
  activeIds.value.length > 0 && activeIds.value.every((id) => selected.value.includes(id)))
const toggleAll = () => { selected.value = allSelected.value ? [] : [...activeIds.value] }
const toggleWeekday = (day: number) => {
  const days = repeat.value.weekdays
  repeat.value = { ...repeat.value, weekdays: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] }
}
const setRepeat = (patch: Partial<RepeatForm>) => { repeat.value = { ...repeat.value, ...patch } }

const sendAt = computed(() => {
  if (mode.value !== 'later' || !when.value) return null
  return Math.floor(new Date(when.value).getTime() / 1000)
})
const cron = computed(() => buildCron(repeat.value))
const repeatValid = computed(() => {
  const r = repeat.value
  if (r.kind === 'custom') return r.custom.trim().length > 0
  if (!/^\d{2}:\d{2}$/.test(r.time) && r.kind !== 'hours') return false
  if (r.kind === 'weekdays') return r.weekdays.length > 0
  if (r.kind === 'monthday') return Number.isInteger(r.dayOfMonth) && r.dayOfMonth >= 1 && r.dayOfMonth <= 31
  if (r.kind === 'hours') return HOUR_STEPS.includes(r.everyHours)
  return true
})
const ready = computed(() =>
  message.value.text.trim().length > 0 && selected.value.length > 0
  && (mode.value === 'now' || (mode.value === 'later' ? sendAt.value !== null : repeatValid.value && !previewError.value)))
const submitLabel = computed(() =>
  mode.value === 'now' ? t('messages.mode.now') : mode.value === 'later' ? t('messages.schedule') : editingId.value === null ? t('messages.startRepeating') : t('messages.saveChanges'))

const previewRuns = ref<number[]>([])
const previewError = ref<string | null>(null)
let previewSeq = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined
watch([mode, cron, repeatValid, timeZone], () => {
  clearTimeout(previewTimer)
  const seq = ++previewSeq
  if (mode.value !== 'repeat' || !repeatValid.value) {
    previewRuns.value = []
    previewError.value = null
    return
  }
  previewTimer = setTimeout(async () => {
    try {
      const runs = await api.previewRecurring(cron.value, timeZone.value)
      if (seq !== previewSeq) return
      previewRuns.value = runs.slice(0, PREVIEW_SHOWN)
      previewError.value = null
    } catch (e) {
      if (seq !== previewSeq) return
      previewRuns.value = []
      previewError.value = e instanceof Error ? e.message : t('messages.previewFailed')
    }
  }, PREVIEW_DELAY_MS)
})

function reset() {
  message.value = EMPTY_MESSAGE
  selected.value = []
  mode.value = 'now'
  when.value = ''
  repeat.value = { ...DEFAULT_REPEAT }
  editingId.value = null
  editingZone.value = null
  confirmOpen.value = false
}

function submit() {
  if (mode.value === 'now') confirmOpen.value = true
  else void send()
}

async function send() {
  busy.value = true
  try {
    if (mode.value === 'repeat') {
      const input = { text: message.value.text, entities: message.value.entities, chatIds: selected.value, cron: cron.value, timezone: timeZone.value }
      if (editingId.value === null) await store.createRecurring(input)
      else await store.updateRecurring(editingId.value, input)
      toast.success(editingId.value === null ? t('messages.recurringCreated') : t('messages.recurringUpdated'))
    } else {
      await store.send(message.value, selected.value, sendAt.value)
      toast.success(mode.value === 'later' ? t('messages.scheduled') : t('messages.queued'))
    }
    reset()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('messages.sendFailed'))
  } finally {
    busy.value = false
    confirmOpen.value = false
  }
}

function edit(rule: RecurringMessage) {
  editingId.value = rule.id
  editingZone.value = rule.timezone
  message.value = { text: rule.text, entities: rule.entities }
  selected.value = rule.chats.map((c) => c.id).filter((id) => available.value.some((c) => c.id === id))
  repeat.value = parseCron(rule.cron)
  mode.value = 'repeat'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function togglePause(rule: RecurringMessage) {
  try {
    await store.setPaused(rule.id, rule.enabled)
    toast.success(rule.enabled ? t('messages.paused') : t('messages.resumed'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('messages.changeFailed'))
  }
}

async function confirmDelete() {
  const rule = deleting.value
  if (!rule) return
  try {
    await store.removeRecurring(rule.id)
    if (editingId.value === rule.id) reset()
    toast.success(t('messages.recurringDeleted'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('messages.deleteFailed'))
  } finally {
    deleteOpen.value = false
  }
}

async function cancel(m: ScheduledMessage) {
  try {
    await store.cancel(m.id)
    toast.success(t('messages.cancelled'))
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('messages.cancelFailed'))
  }
}

const statusVariant = (status: TargetStatus) =>
  status === 'failed' || status === 'missed' ? 'destructive' : status === 'sent' ? 'default' : status === 'cancelled' ? 'outline' : 'secondary'
const hasPending = (m: ScheduledMessage) => m.targets.some((t) => t.status === 'pending')

let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  void chats.load()
  void store.load()
  timer = setInterval(() => {
    if (store.messages.some((m) => m.targets.some((t) => t.status === 'pending' || t.status === 'sending'))) void store.load()
  }, POLL_MS)
})
onUnmounted(() => {
  clearInterval(timer)
  clearTimeout(previewTimer)
})

watch(() => store.error, (msg) => { if (msg) toast.error(msg) })
</script>

<template>
  <section class="max-w-3xl space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">{{ t('messages.title') }}</h1>

    <Card class="py-4">
      <CardContent class="space-y-4 px-4">
        <form class="space-y-4" @submit.prevent="submit">
          <div class="space-y-2">
            <span class="text-sm font-medium">{{ t('messages.message') }}</span>
            <RichTextEditor v-model="message" :label="t('messages.message')" :placeholder="t('messages.placeholder')" />
            <p class="text-right text-xs" :class="message.text.length > 4000 ? 'text-destructive' : 'text-muted-foreground'">{{ message.text.length }} / 4000</p>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">{{ t('messages.sendTo') }}</span>
              <Button v-if="activeIds.length" type="button" variant="ghost" size="sm" @click="toggleAll">
                {{ allSelected ? t('messages.clear') : t('messages.selectActive') }}
              </Button>
            </div>
            <p v-if="!available.length" class="text-sm text-muted-foreground">{{ t('messages.noChats') }}</p>
            <div v-for="c in available" :key="c.id" class="flex items-center gap-2">
              <Checkbox
                :id="`chat-${c.id}`" :model-value="selected.includes(c.id)"
                @update:model-value="(v) => toggleChat(c.id, v === true)"
              />
              <ChatAvatar :chat="c" class="size-6 text-[0.65rem]" />
              <Label :for="`chat-${c.id}`" class="min-w-0 break-words font-normal">{{ c.title }}</Label>
              <Badge :variant="isActive(c) ? 'default' : 'outline'" class="ml-auto shrink-0">{{ isActive(c) ? t('common.on') : t('common.off') }}</Badge>
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex flex-wrap gap-2" role="group" :aria-label="t('messages.when')">
              <Button
                v-for="m in modes" :key="m" type="button" size="sm" :variant="mode === m ? 'default' : 'outline'"
                :aria-pressed="mode === m" :disabled="editingId !== null && m !== 'repeat'" @click="mode = m"
              >{{ t(`messages.mode.${m}`) }}</Button>
            </div>

            <div v-if="mode === 'later'" class="space-y-1">
              <Input v-model="when" type="datetime-local" class="w-fit" :aria-label="t('messages.sendAt')" />
              <p class="text-xs text-muted-foreground">Time zone: {{ timeZone }}</p>
            </div>

            <div v-if="mode === 'repeat'" class="space-y-3">
              <div class="flex flex-wrap items-end gap-3">
                <div class="space-y-1">
                  <Label>{{ t('messages.repeat') }}</Label>
                  <Select :model-value="repeat.kind" @update:model-value="(v) => setRepeat({ kind: v as RepeatKind })">
                    <SelectTrigger class="w-48" :aria-label="t('messages.repeatPattern')"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="k in repeatKinds" :key="k" :value="k">{{ t(`messages.kind.${k}`) }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div v-if="repeat.kind !== 'custom' && repeat.kind !== 'hours'" class="space-y-1">
                  <Label for="repeat-time">{{ t('messages.at') }}</Label>
                  <Input id="repeat-time" :model-value="repeat.time" type="time" class="w-fit" @update:model-value="(v) => setRepeat({ time: String(v) })" />
                </div>
                <div v-if="repeat.kind === 'monthday'" class="space-y-1">
                  <Label for="repeat-day">{{ t('messages.day') }}</Label>
                  <Input id="repeat-day" :model-value="repeat.dayOfMonth" type="number" min="1" max="31" class="w-24" @update:model-value="(v) => setRepeat({ dayOfMonth: Number(v) })" />
                </div>
                <div v-if="repeat.kind === 'hours'" class="space-y-1">
                  <Label>{{ t('messages.every') }}</Label>
                  <Select :model-value="String(repeat.everyHours)" @update:model-value="(v) => setRepeat({ everyHours: Number(v) })">
                    <SelectTrigger class="w-32" :aria-label="t('messages.hoursBetween')"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="h in HOUR_STEPS" :key="h" :value="String(h)">{{ t('messages.hoursOption', h) }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div v-if="repeat.kind === 'weekdays'" class="flex flex-wrap gap-2" role="group" :aria-label="t('messages.weekdays')">
                <Button
                  v-for="(name, day) in weekdays" :key="day" type="button" size="sm"
                  :variant="repeat.weekdays.includes(day) ? 'default' : 'outline'" :aria-pressed="repeat.weekdays.includes(day)" @click="toggleWeekday(day)"
                >{{ name }}</Button>
              </div>
              <p v-if="repeat.kind === 'hours'" class="text-xs text-muted-foreground">{{ t('messages.hoursHint') }}</p>

              <div v-if="repeat.kind === 'custom'" class="space-y-1">
                <Label for="repeat-cron">{{ t('messages.cron') }}</Label>
                <Input id="repeat-cron" :model-value="repeat.custom" class="max-w-xs font-mono" placeholder="0 9 * * 1-5" @update:model-value="(v) => setRepeat({ custom: String(v) })" />
                <p class="text-xs text-muted-foreground">{{ t('messages.cronHint') }}</p>
              </div>

              <div class="space-y-1 text-sm" aria-live="polite">
                <p v-if="previewError" class="text-destructive">{{ previewError }}</p>
                <template v-else-if="previewRuns.length">
                  <p class="text-muted-foreground">{{ t('messages.nextSends') }}</p>
                  <ul>
                    <li v-for="run in previewRuns" :key="run">{{ zoneFormat(run, timeZone) }}</li>
                  </ul>
                </template>
                <p class="text-xs text-muted-foreground">Time zone: {{ timeZone }}</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <Button v-if="editingId !== null" type="button" variant="outline" :disabled="busy" @click="reset">{{ t('messages.cancelEditing') }}</Button>
            <Button type="submit" :disabled="busy || !ready">{{ submitLabel }}</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <div v-if="store.recurring.length" class="space-y-3">
      <h2 class="text-lg font-semibold tracking-tight">{{ t('messages.recurring') }}</h2>
      <Card v-for="r in store.recurring" :key="r.id" class="py-4">
        <CardContent class="space-y-3 px-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <p class="text-sm font-medium">{{ describeRepeat(r.cron) }}</p>
              <p class="text-xs text-muted-foreground">
                <template v-if="r.enabled && r.nextRunAt">{{ t('messages.next', { when: zoneFormat(r.nextRunAt, r.timezone), zone: r.timezone }) }}</template>
                <template v-else>{{ t('messages.paused') }}</template>
              </p>
            </div>
            <Badge :variant="r.enabled ? 'default' : 'outline'">{{ r.enabled ? t('messages.active') : t('messages.paused') }}</Badge>
          </div>
          <FormattedText :message="{ text: r.text, entities: r.entities }" />
          <p class="break-words text-xs text-muted-foreground">{{ r.chats.length ? r.chats.map((c) => c.title).join(', ') : t('messages.noChatsLeft') }}</p>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="!r.enabled && !r.chats.length" @click="togglePause(r)">{{ r.enabled ? t('messages.pause') : t('messages.resume') }}</Button>
            <Button variant="outline" size="sm" @click="edit(r)">{{ t('common.edit') }}</Button>
            <Button variant="outline" size="sm" @click="deleting = r; deleteOpen = true">{{ t('common.delete') }}</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <h2 class="text-lg font-semibold tracking-tight">{{ t('messages.history') }}</h2>
    <p v-if="store.loading && !store.messages.length" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-else-if="!store.messages.length" class="text-sm text-muted-foreground">{{ t('messages.empty') }}</p>

    <Card v-for="m in store.messages" :key="m.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted-foreground">{{ format(m.sendAt) }}<template v-if="m.recurringId !== null"> {{ t('messages.repeating') }}</template></span>
          <Button v-if="hasPending(m)" variant="outline" size="sm" @click="cancel(m)">{{ t('common.cancel') }}</Button>
        </div>
        <FormattedText :message="{ text: m.text, entities: m.entities }" />
        <ul class="space-y-1">
          <li v-for="target in m.targets" :key="target.chatId" class="text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="statusVariant(target.status)">{{ t(`messages.status.${target.status}`) }}</Badge>
              <span class="min-w-0 break-words">{{ target.title }}</span>
            </div>
            <p v-if="target.error" class="mt-1 break-words text-xs text-destructive">{{ target.error }}</p>
          </li>
        </ul>
      </CardContent>
    </Card>

    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('messages.confirmTitle', selected.length) }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('messages.confirmBody') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="send">{{ t('messages.mode.now') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('messages.deleteTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('messages.deleteBody') }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">{{ t('common.delete') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
