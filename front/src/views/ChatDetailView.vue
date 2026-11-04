<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import FiltersPanel from '@/components/FiltersPanel.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import WhitelistPanel from '@/components/WhitelistPanel.vue'
import WordsPanel from '@/components/WordsPanel.vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useChatDetailStore } from '@/stores/chatDetail'

const route = useRoute()
const id = Number(route.params.id)
const store = useChatDetailStore(id)
const chat = computed(() => store.chat)

onMounted(() => store.load())
</script>

<template>
  <section class="space-y-4">
    <RouterLink to="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" /> Chats
    </RouterLink>

    <p v-if="store.loading && !chat" class="text-sm text-muted-foreground">Loading...</p>
    <p v-else-if="store.error && !chat" class="text-sm text-destructive">{{ store.error }}</p>

    <template v-else-if="chat">
      <h1 class="break-words text-2xl font-semibold tracking-tight">{{ chat.title }}</h1>

      <Alert v-if="chat.type === 'channel'">
        <AlertDescription>
          Only admins post in a channel. To moderate its comments, add the bot to its discussion group and configure it there.
        </AlertDescription>
      </Alert>

      <Tabs v-else default-value="filters" class="gap-4">
        <TabsList class="h-auto w-full flex-wrap">
          <TabsTrigger value="filters">Filters</TabsTrigger>
          <TabsTrigger value="words">Words</TabsTrigger>
          <TabsTrigger value="whitelist">Whitelist</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="filters"><FiltersPanel :id="id" /></TabsContent>
        <TabsContent value="words"><WordsPanel :id="id" /></TabsContent>
        <TabsContent value="whitelist"><WhitelistPanel :id="id" /></TabsContent>
        <TabsContent value="history"><HistoryPanel :id="id" /></TabsContent>
      </Tabs>
    </template>
  </section>
</template>
