<script setup lang="ts">
import { Plus, TriangleAlert, Users } from '@lucide/vue'
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
import ChatAvatar from '@/components/ChatAvatar.vue'
import type { ChatRecord } from '@/lib/api'
import { activeFilters } from '@/lib/chats'
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

const summary = computed(() => {
  const total = store.chats.length
  const on = store.chats.filter((c) => !isInactive(c) && c.moderationEnabled).length
  return `${total} ${total === 1 ? 'group' : 'groups'}, ${on} with moderation on`
})

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
  <section class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div class="space-y-1">
        <h1 class="text-2xl font-semibold tracking-tight">Groups</h1>
        <p v-if="store.chats.length" class="text-sm text-muted-foreground">{{ summary }}</p>
      </div>
      <Button v-if="addGroupUrl" as="a" :href="addGroupUrl" target="_blank" rel="noopener noreferrer">
        <Plus />
        Add group
      </Button>
    </div>

    <p v-if="store.loading && !store.chats.length" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="store.error && !store.chats.length" class="text-sm text-destructive">{{ store.error }}</p>

    <div v-else-if="!store.chats.length" class="rounded-xl border border-dashed p-8 text-center">
      <Users class="mx-auto mb-3 size-8 text-muted-foreground" />
      <p class="font-medium">No groups yet</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        Add the bot to a group and give it admin rights to delete messages and ban users. The group will appear here switched off.
      </p>
    </div>

    <div v-else class="grid gap-4 md:grid-cols-2">
      <Card
        v-for="c in store.chats" :key="c.id"
        class="group/card relative gap-0 py-0 transition-colors hover:border-foreground/30"
        :class="isInactive(c) && 'bg-muted/40'"
      >
        <CardContent class="flex flex-1 flex-col gap-4 p-4">
          <div class="flex items-start gap-3">
            <ChatAvatar :chat="c" class="size-12 text-base" :class="isInactive(c) && 'opacity-60'" />
            <div class="min-w-0 flex-1">
              <RouterLink
                :to="`/chats/${c.id}`"
                class="block truncate font-medium after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring"
              >{{ c.title }}</RouterLink>
              <div class="text-sm text-muted-foreground">{{ typeLabels[c.type] }}</div>
            </div>
            <Badge v-if="isInactive(c)" variant="outline">Inactive</Badge>
            <Badge v-else-if="c.moderationEnabled" variant="default">On</Badge>
            <Badge v-else variant="secondary">Off</Badge>
          </div>

          <div class="flex flex-wrap gap-1.5 text-xs">
            <template v-if="c.type === 'channel'">
              <span class="text-muted-foreground">Channels are not moderated. Set up its discussion group instead.</span>
            </template>
            <template v-else-if="isInactive(c)">
              <span class="text-muted-foreground">The bot is no longer in this group.</span>
            </template>
            <template v-else>
              <Badge v-for="f in activeFilters(c)" :key="f" variant="outline" class="font-normal">{{ f }}</Badge>
              <Badge v-if="c.autoRepliesEnabled" variant="outline" class="font-normal">Auto replies</Badge>
              <span v-if="!c.moderationEnabled" class="text-muted-foreground">Moderation is off: nothing is being filtered.</span>
              <span v-else-if="!activeFilters(c).length && !c.autoRepliesEnabled" class="text-muted-foreground">No filters turned on yet.</span>
            </template>
          </div>

          <Alert v-if="needsAdmin(c)" variant="destructive">
            <TriangleAlert />
            <AlertDescription>Make the bot an admin with permission to delete messages and ban users</AlertDescription>
          </Alert>

          <div class="relative z-10 mt-auto flex justify-end">
            <Button variant="outline" size="sm" @click="askForget(c)">Leave and forget</Button>
          </div>
        </CardContent>
      </Card>
    </div>

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
