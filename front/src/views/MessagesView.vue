<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api, type FormattedMessage, type RecurringMessage, type ScheduledMessage, type TargetStatus } from '@/lib/api'
import { EMPTY_MESSAGE } from '@/lib/formatting'
import { buildCron, DEFAULT_REPEAT, describeRepeat, parseCron, type RepeatForm, type RepeatKind, WEEKDAY_NAMES } from '@/lib/schedule'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'

type Mode = 'now' | 'later' | 'repeat'

const POLL_MS = 5000
const PREVIEW_DELAY_MS = 300
const PREVIEW_SHOWN = 3

const chats = useChatsStore()
const store = useMessagesStore()

const available = computed(() => chats.chats.filter((c) => c.botStatus !== 'left' && c.botStatus !== 'kicked'))
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
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const format = (ts: number) => fmt.format(new Date(ts * 1000))
const zoneFormat = (ts: number, zone: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(ts * 1000))

const modes: { value: Mode; label: string }[] = [
  { value: 'now', label: 'Send now' }, { value: 'later', label: 'Later' }, { value: 'repeat', label: 'Repeat' },
]
const repeatKinds: { value: RepeatKind; label: string }[] = [
  { value: 'daily', label: 'Every day' }, { value: 'weekdays', label: 'Specific weekdays' }, { value: 'monthday', label: 'Day of the month' },
  { value: 'hours', label: 'Every N hours' }, { value: 'custom', label: 'Custom (cron)' },
]

const toggleChat = (id: number, on: boolean) => {
  selected.value = on ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}
const allSelected = computed(() => available.value.length > 0 && selected.value.length === available.value.length)
const toggleAll = () => { selected.value = allSelected.value ? [] : available.value.map((c) => c.id) }
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
  if (r.kind === 'hours') return Number.isInteger(r.everyHours) && r.everyHours >= 1 && r.everyHours <= 23
  return true
})
const ready = computed(() =>
  message.value.text.trim().length > 0 && selected.value.length > 0
  && (mode.value === 'now' || (mode.value === 'later' ? sendAt.value !== null : repeatValid.value && !previewError.value)))
const targetCount = computed(() => `${selected.value.length} ${selected.value.length === 1 ? 'chat' : 'chats'}`)
const submitLabel = computed(() =>
  mode.value === 'now' ? 'Send now' : mode.value === 'later' ? 'Schedule' : editingId.value === null ? 'Start repeating' : 'Save changes')

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
      previewError.value = e instanceof Error ? e.message : 'Could not check the schedule'
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
      toast.success(editingId.value === null ? 'Repeating message created' : 'Repeating message updated')
    } else {
      await store.send(message.value, selected.value, sendAt.value)
      toast.success(mode.value === 'later' ? 'Message scheduled' : 'Message queued')
    }
    reset()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not send the message')
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
    toast.success(rule.enabled ? 'Paused' : 'Resumed')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not change the message')
  }
}

async function confirmDelete() {
  const rule = deleting.value
  if (!rule) return
  try {
    await store.removeRecurring(rule.id)
    if (editingId.value === rule.id) reset()
    toast.success('Repeating message deleted')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not delete the message')
  } finally {
    deleteOpen.value = false
  }
}

async function cancel(m: ScheduledMessage) {
  try {
    await store.cancel(m.id)
    toast.success('Message cancelled')
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not cancel the message')
  }
}

const statusLabels: Record<TargetStatus, string> = {
  pending: 'Pending', sending: 'Sending', sent: 'Sent', failed: 'Failed', missed: 'Missed', cancelled: 'Cancelled',
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
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">Messages</h1>

    <Card class="py-4">
      <CardContent class="space-y-4 px-4">
        <form class="space-y-4" @submit.prevent="submit">
          <div class="space-y-2">
            <span class="text-sm font-medium">Message</span>
            <RichTextEditor v-model="message" label="Message" placeholder="Text to send. Links work." />
            <p class="text-right text-xs" :class="message.text.length > 4000 ? 'text-destructive' : 'text-muted-foreground'">{{ message.text.length }} / 4000</p>
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm font-medium">Send to</span>
              <Button v-if="available.length > 1" type="button" variant="ghost" size="sm" @click="toggleAll">
                {{ allSelected ? 'Clear' : 'Select all' }}
              </Button>
            </div>
            <p v-if="!available.length" class="text-sm text-muted-foreground">No chats yet.</p>
            <div v-for="c in available" :key="c.id" class="flex items-center gap-2">
              <Checkbox
                :id="`chat-${c.id}`" :model-value="selected.includes(c.id)"
                @update:model-value="(v) => toggleChat(c.id, v === true)"
              />
              <Label :for="`chat-${c.id}`" class="min-w-0 break-words font-normal">{{ c.title }}</Label>
            </div>
          </div>

          <div class="space-y-3">
            <div class="flex flex-wrap gap-2" role="group" aria-label="When to send">
              <Button
                v-for="m in modes" :key="m.value" type="button" size="sm" :variant="mode === m.value ? 'default' : 'outline'"
                :aria-pressed="mode === m.value" :disabled="editingId !== null && m.value !== 'repeat'" @click="mode = m.value"
              >{{ m.label }}</Button>
            </div>

            <div v-if="mode === 'later'" class="space-y-1">
              <Input v-model="when" type="datetime-local" class="w-fit" aria-label="Send at" />
              <p class="text-xs text-muted-foreground">Time zone: {{ timeZone }}</p>
            </div>

            <div v-if="mode === 'repeat'" class="space-y-3">
              <div class="flex flex-wrap items-end gap-3">
                <div class="space-y-1">
                  <Label>Repeat</Label>
                  <Select :model-value="repeat.kind" @update:model-value="(v) => setRepeat({ kind: v as RepeatKind })">
                    <SelectTrigger class="w-48" aria-label="Repeat pattern"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="k in repeatKinds" :key="k.value" :value="k.value">{{ k.label }}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div v-if="repeat.kind !== 'custom' && repeat.kind !== 'hours'" class="space-y-1">
                  <Label for="repeat-time">At</Label>
                  <Input id="repeat-time" :model-value="repeat.time" type="time" class="w-fit" @update:model-value="(v) => setRepeat({ time: String(v) })" />
                </div>
                <div v-if="repeat.kind === 'monthday'" class="space-y-1">
                  <Label for="repeat-day">Day</Label>
                  <Input id="repeat-day" :model-value="repeat.dayOfMonth" type="number" min="1" max="31" class="w-24" @update:model-value="(v) => setRepeat({ dayOfMonth: Number(v) })" />
                </div>
                <div v-if="repeat.kind === 'hours'" class="space-y-1">
                  <Label for="repeat-hours">Every (hours)</Label>
                  <Input id="repeat-hours" :model-value="repeat.everyHours" type="number" min="1" max="23" class="w-24" @update:model-value="(v) => setRepeat({ everyHours: Number(v) })" />
                </div>
              </div>

              <div v-if="repeat.kind === 'weekdays'" class="flex flex-wrap gap-2" role="group" aria-label="Weekdays">
                <Button
                  v-for="(name, day) in WEEKDAY_NAMES" :key="name" type="button" size="sm"
                  :variant="repeat.weekdays.includes(day) ? 'default' : 'outline'" :aria-pressed="repeat.weekdays.includes(day)" @click="toggleWeekday(day)"
                >{{ name }}</Button>
              </div>
              <p v-if="repeat.kind === 'hours'" class="text-xs text-muted-foreground">Counted from midnight, so 5 hours means 00:00, 05:00, 10:00, 15:00 and 20:00.</p>

              <div v-if="repeat.kind === 'custom'" class="space-y-1">
                <Label for="repeat-cron">Cron expression</Label>
                <Input id="repeat-cron" :model-value="repeat.custom" class="max-w-xs font-mono" placeholder="0 9 * * 1-5" @update:model-value="(v) => setRepeat({ custom: String(v) })" />
                <p class="text-xs text-muted-foreground">Five fields: minute, hour, day of month, month, weekday. At most once every 5 minutes.</p>
              </div>

              <div class="space-y-1 text-sm" aria-live="polite">
                <p v-if="previewError" class="text-destructive">{{ previewError }}</p>
                <template v-else-if="previewRuns.length">
                  <p class="text-muted-foreground">Next sends</p>
                  <ul>
                    <li v-for="t in previewRuns" :key="t">{{ zoneFormat(t, timeZone) }}</li>
                  </ul>
                </template>
                <p class="text-xs text-muted-foreground">Time zone: {{ timeZone }}</p>
              </div>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <Button v-if="editingId !== null" type="button" variant="outline" :disabled="busy" @click="reset">Cancel editing</Button>
            <Button type="submit" :disabled="busy || !ready">{{ submitLabel }}</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <div v-if="store.recurring.length" class="space-y-3">
      <h2 class="text-lg font-semibold tracking-tight">Recurring</h2>
      <Card v-for="r in store.recurring" :key="r.id" class="py-4">
        <CardContent class="space-y-3 px-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <p class="text-sm font-medium">{{ describeRepeat(r.cron) }}</p>
              <p class="text-xs text-muted-foreground">
                <template v-if="r.enabled && r.nextRunAt">Next: {{ zoneFormat(r.nextRunAt, r.timezone) }} ({{ r.timezone }})</template>
                <template v-else>Paused</template>
              </p>
            </div>
            <Badge :variant="r.enabled ? 'default' : 'outline'">{{ r.enabled ? 'Active' : 'Paused' }}</Badge>
          </div>
          <FormattedText :message="{ text: r.text, entities: r.entities }" />
          <p class="break-words text-xs text-muted-foreground">{{ r.chats.length ? r.chats.map((c) => c.title).join(', ') : 'No chats left' }}</p>
          <div class="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" :disabled="!r.enabled && !r.chats.length" @click="togglePause(r)">{{ r.enabled ? 'Pause' : 'Resume' }}</Button>
            <Button variant="outline" size="sm" @click="edit(r)">Edit</Button>
            <Button variant="outline" size="sm" @click="deleting = r; deleteOpen = true">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <h2 class="text-lg font-semibold tracking-tight">History</h2>
    <p v-if="store.loading && !store.messages.length" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="!store.messages.length" class="text-sm text-muted-foreground">No messages yet.</p>

    <Card v-for="m in store.messages" :key="m.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted-foreground">{{ format(m.sendAt) }}<template v-if="m.recurringId !== null"> (repeating)</template></span>
          <Button v-if="hasPending(m)" variant="outline" size="sm" @click="cancel(m)">Cancel</Button>
        </div>
        <FormattedText :message="{ text: m.text, entities: m.entities }" />
        <ul class="space-y-1">
          <li v-for="t in m.targets" :key="t.chatId" class="text-sm">
            <div class="flex flex-wrap items-center gap-2">
              <Badge :variant="statusVariant(t.status)">{{ statusLabels[t.status] }}</Badge>
              <span class="min-w-0 break-words">{{ t.title }}</span>
            </div>
            <p v-if="t.error" class="mt-1 break-words text-xs text-destructive">{{ t.error }}</p>
          </li>
        </ul>
      </CardContent>
    </Card>

    <AlertDialog v-model:open="confirmOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send to {{ targetCount }} now?</AlertDialogTitle>
          <AlertDialogDescription>The message goes out right away and can't be recalled from here.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="send">Send now</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this repeating message?</AlertDialogTitle>
          <AlertDialogDescription>It stops sending. Messages it already sent stay in the history.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="confirmDelete">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
