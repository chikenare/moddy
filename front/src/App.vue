<script setup lang="ts">
import { onMounted } from 'vue'
import { Toaster } from '@/components/ui/sonner'
import { useChatsStore } from '@/stores/chats'

const store = useChatsStore()
onMounted(() => store.load())
</script>

<template>
  <div class="min-h-screen bg-background text-foreground">
    <div
      v-if="store.appEnv === 'development'"
      class="sticky top-0 z-40 border-b bg-amber-100 px-4 py-2 text-center text-sm text-amber-900"
    >
      Modo desarrollo: los bans son simulados
    </div>
    <main class="mx-auto max-w-3xl px-4 py-8">
      <RouterView />
    </main>
    <Toaster />
  </div>
</template>
