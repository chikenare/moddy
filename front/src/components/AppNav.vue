<script lang="ts">
import { MessageSquareText, Users } from '@lucide/vue'
import type { Component } from 'vue'

// To add a page, add a line here and a route in router.ts.
export const nav: { label: string; to: string; icon: Component; match: (path: string) => boolean }[] = [
  { label: 'Groups', to: '/', icon: Users, match: (p) => p === '/' || p.startsWith('/chats/') },
  { label: 'Messages', to: '/messages', icon: MessageSquareText, match: (p) => p.startsWith('/messages') },
]
</script>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar'

const route = useRoute()
const { setOpenMobile } = useSidebar()
</script>

<template>
  <SidebarMenu>
    <SidebarMenuItem v-for="n in nav" :key="n.to">
      <SidebarMenuButton as-child :is-active="n.match(route.path)">
        <RouterLink :to="n.to" @click="setOpenMobile(false)"><component :is="n.icon" /><span>{{ n.label }}</span></RouterLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
