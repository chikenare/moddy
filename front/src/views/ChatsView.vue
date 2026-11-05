<script setup lang="ts">
import { Plus, TriangleAlert, Users } from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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

const { t } = useI18n()
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

const isInactive = (c: ChatRecord) => c.botStatus === 'left' || c.botStatus === 'kicked'
const needsAdmin = (c: ChatRecord) => c.type !== 'channel' && !isInactive(c) && (!c.canDelete || !c.canRestrict)

const summary = computed(() => {
  const total = store.chats.length
  const on = store.chats.filter((c) => !isInactive(c) && c.moderationEnabled).length
  return t('chats.summary', { count: total, on }, total)
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
    toast.success(t('chats.forgotten'))
    dialogOpen.value = false
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('chats.forgetFailed'))
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
        <h1 class="text-2xl font-semibold tracking-tight">{{ t('chats.title') }}</h1>
        <p v-if="store.chats.length" class="text-sm text-muted-foreground">{{ summary }}</p>
      </div>
      <Button v-if="addGroupUrl" as="a" :href="addGroupUrl" target="_blank" rel="noopener noreferrer">
        <Plus />
        {{ t('chats.addGroup') }}
      </Button>
    </div>

    <p v-if="store.loading && !store.chats.length" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-else-if="store.error && !store.chats.length" class="text-sm text-destructive">{{ store.error }}</p>

    <div v-else-if="!store.chats.length" class="rounded-xl border border-dashed p-8 text-center">
      <Users class="mx-auto mb-3 size-8 text-muted-foreground" />
      <p class="font-medium">{{ t('chats.emptyTitle') }}</p>
      <p class="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {{ t('chats.emptyBody') }}
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
              <div class="text-sm text-muted-foreground">{{ t(`chatType.${c.type}`) }}</div>
            </div>
            <Badge v-if="isInactive(c)" variant="outline">{{ t('chats.inactive') }}</Badge>
            <Badge v-else-if="c.moderationEnabled" variant="default">{{ t('common.on') }}</Badge>
            <Badge v-else variant="secondary">{{ t('common.off') }}</Badge>
          </div>

          <div class="flex flex-wrap gap-1.5 text-xs">
            <template v-if="c.type === 'channel'">
              <span class="text-muted-foreground">{{ t('chats.channelNote') }}</span>
            </template>
            <template v-else-if="isInactive(c)">
              <span class="text-muted-foreground">{{ t('chats.inactiveNote') }}</span>
            </template>
            <template v-else>
              <Badge v-for="f in activeFilters(c)" :key="f" variant="outline" class="font-normal">{{ t(`filter.${f}`) }}</Badge>
              <Badge v-if="c.autoRepliesEnabled" variant="outline" class="font-normal">{{ t('chat.tab.autoReplies') }}</Badge>
              <span v-if="!c.moderationEnabled" class="text-muted-foreground">{{ t('chats.moderationOff') }}</span>
              <span v-else-if="!activeFilters(c).length && !c.autoRepliesEnabled" class="text-muted-foreground">{{ t('chats.noFilters') }}</span>
            </template>
          </div>

          <Alert v-if="needsAdmin(c)" variant="destructive">
            <TriangleAlert />
            <AlertDescription>{{ t('chats.needsAdmin') }}</AlertDescription>
          </Alert>

          <div class="relative z-10 mt-auto flex justify-end">
            <Button variant="outline" size="sm" @click="askForget(c)">{{ t('chats.leave') }}</Button>
          </div>
        </CardContent>
      </Card>
    </div>

    <AlertDialog v-model:open="dialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('chats.leaveTitle', { title: target?.title }) }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ t('chats.leaveBody') }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="busy">{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction :disabled="busy" @click.prevent="confirmForget">{{ t('chats.leave') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
</template>
