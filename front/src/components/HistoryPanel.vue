<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { EventRecord } from '@/lib/api'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)
const { t, locale } = useI18n()

const fmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'short', timeStyle: 'medium' }))
const when = (ts: number) => fmt.value.format(new Date(ts * 1000))

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
    toast.success(t('history.addedToStaff', { name: e.senderName }))
  } catch (err) {
    toast.error(err instanceof Error ? err.message : t('history.addToStaffFailed'))
  }
}

function outcome(e: EventRecord) {
  if (e.action === 'warn') return t('history.outcome.warned')
  if (e.action === 'unban') return e.error?.includes('unban:') ? t('history.outcome.noEffect') : t('history.outcome.unbanned')
  const undone = e.unbannedAt !== null
  if (e.deleteOk && e.banOk) return undone ? t('history.outcome.deletedBannedUndone') : t('history.outcome.deletedBanned')
  if (e.banOk) return undone ? t('history.outcome.bannedUndone') : t('history.outcome.banned')
  if (e.deleteOk) return t('history.outcome.deleted')
  return t('history.outcome.noEffect')
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
    toast.success(t('history.unbanned'))
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('history.unbanFailed'))
  } finally {
    busy.value = false
  }
}

async function more() {
  loadingMore.value = true
  try {
    await store.loadMoreEvents()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('history.loadMoreFailed'))
  } finally {
    loadingMore.value = false
  }
}
</script>

<template>
  <div class="space-y-4">
    <p v-if="!store.events.length" class="text-sm text-muted-foreground">{{ t('history.empty') }}</p>
    <div v-else class="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('history.date') }}</TableHead>
            <TableHead>{{ t('history.sender') }}</TableHead>
            <TableHead>{{ t('history.filter') }}</TableHead>
            <TableHead>{{ t('history.match') }}</TableHead>
            <TableHead>{{ t('history.result') }}</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="e in store.events" :key="e.id" class="align-top">
            <TableCell class="whitespace-nowrap">{{ when(e.createdAt) }}</TableCell>
            <TableCell class="max-w-40 break-words whitespace-normal">{{ e.senderName }}</TableCell>
            <TableCell>{{ t(`filter.${e.filter}`) }}</TableCell>
            <TableCell class="max-w-64 whitespace-normal">
              <div class="break-all">{{ e.matched }}</div>
              <div v-if="e.text" class="mt-1 break-words text-xs text-muted-foreground">{{ e.text }}</div>
            </TableCell>
            <TableCell class="max-w-48 whitespace-normal">
              <div class="flex flex-wrap items-center gap-1">
                <span>{{ outcome(e) }}</span>
                <Badge v-if="e.dryRun" variant="outline">{{ t('history.simulated') }}</Badge>
              </div>
              <div v-if="e.error" class="mt-1 break-words text-xs text-destructive">{{ e.error }}</div>
            </TableCell>
            <TableCell>
              <div class="flex flex-col items-start gap-1">
                <Button v-if="isActiveBan(e)" variant="outline" size="sm" @click="askUnban(e)">{{ t('history.unban') }}</Button>
                <Button v-if="canAddToStaff(e)" variant="outline" size="sm" @click="askAddToStaff(e)">{{ t('history.addToStaff') }}</Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <Button v-if="store.nextBefore !== null" variant="outline" :disabled="loadingMore" @click="more">
      {{ t('history.loadMore') }}
    </Button>

    <AlertDialog v-model:open="staffDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('history.staffTitle', { name: staffTarget?.senderName }) }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('history.staffBody') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="addToStaff(staffTarget!)">{{ t('history.addToStaff') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('history.unbanTitle', { name: target?.senderName }) }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('history.unbanBody') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmUnban">{{ t('history.unban') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
