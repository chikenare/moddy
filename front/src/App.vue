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
      Development mode: bans are simulated, but messages are really deleted and admins are not exempt.
    </div>
    <nav class="mx-auto flex max-w-3xl gap-4 px-4 pt-6 text-sm">
      <RouterLink to="/" class="text-muted-foreground hover:text-foreground" exact-active-class="font-medium text-foreground!">Chats</RouterLink>
      <RouterLink to="/messages" class="text-muted-foreground hover:text-foreground" active-class="font-medium text-foreground!">Messages</RouterLink>
    </nav>
    <main class="mx-auto max-w-3xl px-4 py-6">
      <RouterView :key="$route.fullPath" />
    </main>
    <Toaster />
  </div>
</template>
