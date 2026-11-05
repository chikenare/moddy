<script setup lang="ts">
import { watch } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'

const route = useRoute()
const auth = useAuthStore()
const store = useChatsStore()

watch(() => auth.authenticated === true && !auth.mustChangePassword, (ready) => {
  if (ready) void store.load()
}, { immediate: true })
</script>

<template>
  <RouterView v-if="route.meta.bare" />
  <AppLayout v-else>
    <RouterView :key="$route.fullPath" />
  </AppLayout>
  <Toaster />
</template>
