<script setup lang="ts">
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EventRecord, EventSource } from '@/lib/api'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)

const filterLabels: Record<EventSource, string> = {
  link: 'Links', word: 'Words', flood: 'Flood', bot: 'Bots', command: 'Command',
}

const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'medium' })
const when = (ts: number) => fmt.format(new Date(ts * 1000))

const isActiveBan = (e: EventRecord) => e.banOk === true && !e.dryRun && e.unbannedAt === null
const canAddToStaff = (e: EventRecord) =>
  e.senderType === 'user' && e.filter !== 'bot' && e.filter !== 'command' && !store.staff.some((s) => s.userId === e.senderId)

const staffTarget = ref<EventRecord | null>(null)
const staffDialogOpen = ref(false)

// With commands on, staff can also ban, so this is no longer just excusing a false positive.
function askAddToStaff(e: EventRecord) {
  if (!store.chat?.commandsEnabled) return void addToStaff(e)
  staffTarget.value = e
  staffDialogOpen.value = true
}

async function addToStaff(e: EventRecord) {
  try {
    await store.addStaff(String(e.senderId))
    toast.success(`${e.senderName} added to staff`)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not add to staff')
  }
}

function outcome(e: EventRecord) {
  if (e.action === 'warn') return 'Warned'
  if (e.action === 'unban') return e.error?.includes('unban:') ? 'No effect' : 'Unbanned'
  const parts: string[] = []
  if (e.deleteOk) parts.push('Deleted')
  if (e.banOk) parts.push(e.unbannedAt !== null ? 'Banned (undone)' : 'Banned')
  return parts.join(' and ') || 'No effect'
}

const target = ref<EventRecord | null>(null)
const dialogOpen = ref(false)
const busy = ref(false)
const loadingMore = ref(false)

const askUnban = (e: EventRecord) => { target.value = e; dialogOpen.value = true }

async function confirmUnban() {
  if (!target.value) return
  busy.value = true
  try {
    await store.unban(target.value.id)
    toast.success('User unbanned')
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not unban')
  } finally {
    busy.value = false
  }
}

async function more() {
  loadingMore.value = true
  try {
    await store.loadMoreEvents()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not load more')
  } finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="!store.events.length" class="text-sm text-muted-foreground">No events yet</p>
    <div v-else class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Sender</TableHead>
            <TableHead>Filter</TableHead>
            <TableHead>Match</TableHead>
            <TableHead>Result</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="e in store.events" :key="e.id" class="align-top">
            <TableCell class="whitespace-nowrap">{{ when(e.createdAt) }}</TableCell>
            <TableCell class="max-w-40 break-words whitespace-normal">{{ e.senderName }}</TableCell>
            <TableCell>{{ filterLabels[e.filter] }}</TableCell>
            <TableCell class="max-w-64 whitespace-normal">
              <div class="break-all">{{ e.matched }}</div>
              <div v-if="e.text" class="mt-1 break-words text-xs text-muted-foreground">{{ e.text }}</div>
            </TableCell>
            <TableCell class="max-w-48 whitespace-normal">
              <div class="flex flex-wrap items-center gap-1">
                <span>{{ outcome(e) }}</span>
                <Badge v-if="e.dryRun" variant="outline">Simulated</Badge>
              </div>
              <div v-if="e.error" class="mt-1 break-words text-xs text-destructive">{{ e.error }}</div>
            </TableCell>
            <TableCell>
              <div class="flex flex-col items-start gap-1">
                <Button v-if="isActiveBan(e)" variant="outline" size="sm" @click="askUnban(e)">Unban</Button>
                <Button v-if="canAddToStaff(e)" variant="outline" size="sm" @click="askAddToStaff(e)">Add to staff</Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <Button v-if="store.nextBefore !== null" variant="outline" :disabled="loadingMore" @click="more">
      Load more
    </Button>

    <AlertDialog v-model:open="staffDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Add {{ staffTarget?.senderName }} to staff?</AlertDialogTitle>
          <AlertDialogDescription>
            Telegram commands are on in this group, so besides skipping the filters they could ban, warn and unban other members.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="addToStaff(staffTarget!)">Add to staff</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unban {{ target?.senderName }}?</AlertDialogTitle>
          <AlertDialogDescription>
            They can rejoin, but must do it themselves: the bot won't add them back to the group.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmUnban">Unban</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
