<script setup lang="ts">
import { Plus, TriangleAlert } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { ChatRecord } from '@/lib/api'
import { useChatsStore } from '@/stores/chats'

const store = useChatsStore()

// Coming back from Telegram, the list must show the newly added group.
const reload = () => store.load()
onMounted(() => {
  store.load()
  window.addEventListener('focus', reload)
})
onUnmounted(() => window.removeEventListener('focus', reload))

const addGroupUrl = computed(() =>
  store.botUsername ? `https://t.me/${store.botUsername}?startgroup&admin=delete_messages+restrict_members` : null,
)

const typeLabels = { group: 'Group', supergroup: 'Supergroup', channel: 'Channel' } as const

const isInactive = (c: ChatRecord) => c.botStatus === 'left' || c.botStatus === 'kicked'
const needsAdmin = (c: ChatRecord) => c.type !== 'channel' && !isInactive(c) && (!c.canDelete || !c.canRestrict)

const target = ref<ChatRecord | null>(null)
const dialogOpen = ref(false)
const busy = ref(false)

const askForget = (c: ChatRecord) => { target.value = c; dialogOpen.value = true }

async function confirmForget() {
  if (!target.value) return
  busy.value = true
  try {
    await store.forget(target.value.id)
    toast.success('Chat forgotten')
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not forget the chat')
  } finally {
    busy.value = false
  }
}

watch(() => store.error, (msg) => { if (msg) toast.error(msg) })
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-semibold tracking-tight">Chats</h1>
      <Button v-if="addGroupUrl" as="a" :href="addGroupUrl" target="_blank" rel="noopener noreferrer">
        <Plus />
        Add group
      </Button>
    </div>
    <p v-if="addGroupUrl" class="text-sm text-muted-foreground">
      Telegram will ask you to pick the group and give the bot admin rights. When you come back, it will appear here switched off.
    </p>

    <p v-if="store.loading && !store.chats.length" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="store.error && !store.chats.length" class="text-sm text-destructive">{{ store.error }}</p>
    <p v-else-if="!store.chats.length" class="text-sm text-muted-foreground">No groups yet.</p>

    <Card v-for="c in store.chats" :key="c.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div class="min-w-0 flex-1">
            <RouterLink :to="`/chats/${c.id}`" class="block truncate font-medium hover:underline">{{ c.title }}</RouterLink>
            <div class="text-sm text-muted-foreground">{{ typeLabels[c.type] }}</div>
          </div>
          <Badge v-if="isInactive(c)" variant="outline">Inactive</Badge>
          <Badge v-else-if="c.moderationEnabled" variant="default">On</Badge>
          <Badge v-else variant="secondary">Off</Badge>
          <Button variant="outline" size="sm" @click="askForget(c)">Leave and forget</Button>
        </div>
        <Alert v-if="needsAdmin(c)" variant="destructive">
          <TriangleAlert />
          <AlertDescription>Make the bot an admin with permission to delete messages and ban users</AlertDescription>
        </Alert>
      </CardContent>
    </Card>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {{ target?.title }}?</AlertDialogTitle>
          <AlertDialogDescription>
            The bot will leave the chat, and its settings, lists and event log will be deleted.
            Bans already applied stay in effect on Telegram and can't be undone from here.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmForget">Leave and forget</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
