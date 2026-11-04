<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { ScheduledMessage, TargetStatus } from '@/lib/api'
import { useChatsStore } from '@/stores/chats'
import { useMessagesStore } from '@/stores/messages'

const POLL_MS = 5000

const chats = useChatsStore()
const store = useMessagesStore()

const available = computed(() => chats.chats.filter((c) => c.botStatus !== 'left' && c.botStatus !== 'kicked'))
const text = ref('')
const selected = ref<number[]>([])
const scheduled = ref(false)
const when = ref('')
const busy = ref(false)
const confirmOpen = ref(false)

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const format = (ts: number) => fmt.format(new Date(ts * 1000))

const toggleChat = (id: number, on: boolean) => {
  selected.value = on ? [...selected.value, id] : selected.value.filter((x) => x !== id)
}
const allSelected = computed(() => available.value.length > 0 && selected.value.length === available.value.length)
const toggleAll = () => { selected.value = allSelected.value ? [] : available.value.map((c) => c.id) }

const sendAt = computed(() => {
  if (!scheduled.value || !when.value) return null
  return Math.floor(new Date(when.value).getTime() / 1000)
})
const ready = computed(() => text.value.trim().length > 0 && selected.value.length > 0 && (!scheduled.value || sendAt.value !== null))
const targetCount = computed(() => `${selected.value.length} ${selected.value.length === 1 ? 'chat' : 'chats'}`)

function submit() {
  if (scheduled.value) void send()
  else confirmOpen.value = true
}

async function send() {
  busy.value = true
  try {
    await store.send(text.value, selected.value, sendAt.value)
    toast.success(scheduled.value ? 'Message scheduled' : 'Message queued')
    text.value = ''
    selected.value = []
    scheduled.value = false
    when.value = ''
    confirmOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not send the message')
  } finally {
    busy.value = false
  }
}

async function cancel(message: ScheduledMessage) {
  try {
    await store.cancel(message.id)
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
onUnmounted(() => clearInterval(timer))

watch(() => store.error, (msg) => { if (msg) toast.error(msg) })
</script>

<template>
  <section class="space-y-6">
    <h1 class="text-2xl font-semibold tracking-tight">Messages</h1>

    <Card class="py-4">
      <CardContent class="space-y-4 px-4">
        <form class="space-y-4" @submit.prevent="submit">
          <div class="space-y-2">
            <Label for="message-text">Message</Label>
            <Textarea id="message-text" v-model="text" maxlength="4000" rows="4" placeholder="Text to send. Links work." />
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

          <div class="space-y-2">
            <div class="flex items-center gap-3">
              <Switch id="schedule" v-model="scheduled" />
              <Label for="schedule" class="font-normal">Schedule for later</Label>
            </div>
            <div v-if="scheduled" class="space-y-1">
              <Input v-model="when" type="datetime-local" class="w-fit" aria-label="Send at" />
              <p class="text-xs text-muted-foreground">Time zone: {{ timeZone }}</p>
            </div>
          </div>

          <div class="flex justify-end">
            <Button type="submit" :disabled="busy || !ready">{{ scheduled ? 'Schedule' : 'Send now' }}</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <p v-if="store.loading && !store.messages.length" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="!store.messages.length" class="text-sm text-muted-foreground">No messages yet.</p>

    <Card v-for="m in store.messages" :key="m.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-sm text-muted-foreground">{{ format(m.sendAt) }}</span>
          <Button v-if="hasPending(m)" variant="outline" size="sm" @click="cancel(m)">Cancel</Button>
        </div>
        <p class="whitespace-pre-wrap break-words text-sm">{{ m.text }}</p>
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
  </section>
</template>
