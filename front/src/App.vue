<script setup lang="ts">
import { onMounted } from 'vue'
import AppLayout from '@/components/AppLayout.vue'
import { Toaster } from '@/components/ui/sonner'
import { useChatsStore } from '@/stores/chats'

const store = useChatsStore()
onMounted(() => store.load())
</script>

<template>
  <AppLayout>
    <RouterView :key="$route.fullPath" />
  </AppLayout>
  <Toaster />
</template>
