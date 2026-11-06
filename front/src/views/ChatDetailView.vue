<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute } from 'vue-router'
import ChatAvatar from '@/components/ChatAvatar.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import AutoRepliesPanel from '@/components/AutoRepliesPanel.vue'
import FiltersPanel from '@/components/FiltersPanel.vue'
import OverviewPanel from '@/components/OverviewPanel.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import NightModePanel from '@/components/NightModePanel.vue'
import RulesPanel from '@/components/RulesPanel.vue'
import StaffPanel from '@/components/StaffPanel.vue'
import WhitelistPanel from '@/components/WhitelistPanel.vue'
import WordsPanel from '@/components/WordsPanel.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useChatDetailStore } from '@/stores/chatDetail'

const { t } = useI18n()
const route = useRoute()
const id = Number(route.params.id)
const store = useChatDetailStore(id)
const chat = computed(() => store.chat)

onMounted(() => store.load())
</script>

<template>
  <section class="max-w-3xl space-y-4">
    <RouterLink to="/groups" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" /> {{ t('nav.groups') }}
    </RouterLink>

    <p v-if="store.loading && !chat" class="text-sm text-muted-foreground">{{ t('common.loading') }}</p>
    <p v-else-if="store.error && !chat" class="text-sm text-destructive">{{ store.error }}</p>

    <template v-else-if="chat">
      <div class="flex items-center gap-4">
        <ChatAvatar :chat="chat" class="size-14 text-lg" />
        <div class="min-w-0">
          <h1 class="break-words text-2xl font-semibold tracking-tight">{{ chat.title }}</h1>
          <p class="text-sm text-muted-foreground">{{ t(`chatType.${chat.type}`) }}</p>
        </div>
      </div>

      <Alert v-if="chat.type === 'channel'">
        <AlertDescription>
          {{ t('chat.channelAlert') }}
        </AlertDescription>
      </Alert>

      <Tabs v-else default-value="overview" :unmount-on-hide="false" class="gap-4">
        <TabsList class="h-auto w-full flex-wrap">
          <TabsTrigger value="overview">{{ t('chat.tab.overview') }}</TabsTrigger>
          <TabsTrigger value="filters">{{ t('chat.tab.filters') }}</TabsTrigger>
          <TabsTrigger value="words">{{ t('chat.tab.words') }}</TabsTrigger>
          <TabsTrigger value="whitelist">{{ t('chat.tab.whitelist') }}</TabsTrigger>
          <TabsTrigger value="staff">{{ t('chat.tab.staff') }}</TabsTrigger>
          <TabsTrigger value="rules">{{ t('chat.tab.rules') }}</TabsTrigger>
          <TabsTrigger value="auto-replies">{{ t('chat.tab.autoReplies') }}</TabsTrigger>
          <TabsTrigger value="night-mode">{{ t('chat.tab.nightMode') }}</TabsTrigger>
          <TabsTrigger value="history">{{ t('chat.tab.history') }}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><OverviewPanel :chat-id="id" /></TabsContent>
        <TabsContent value="filters"><FiltersPanel :id="id" /></TabsContent>
        <TabsContent value="words"><WordsPanel :id="id" /></TabsContent>
        <TabsContent value="whitelist"><WhitelistPanel :id="id" /></TabsContent>
        <TabsContent value="staff"><StaffPanel :id="id" /></TabsContent>
        <TabsContent value="rules"><RulesPanel :id="id" /></TabsContent>
        <TabsContent value="auto-replies"><AutoRepliesPanel :id="id" /></TabsContent>
        <TabsContent value="night-mode"><NightModePanel :id="id" /></TabsContent>
        <TabsContent value="history"><HistoryPanel :id="id" /></TabsContent>
      </Tabs>
    </template>
  </section>
</template>
