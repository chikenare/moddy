<script setup lang="ts">
import { KeyRound, LogOut, Moon, Sun } from '@lucide/vue'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarInset,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail, SidebarTrigger,
} from '@/components/ui/sidebar'
import BotLogo from '@/components/BotLogo.vue'
import AppNav, { nav } from '@/components/AppNav.vue'
import { CHANGE_PASSWORD_PATH } from '@/lib/next'
import { theme, toggleTheme } from '@/lib/theme'
import { useAuthStore } from '@/stores/auth'
import { useChatsStore } from '@/stores/chats'

const route = useRoute()
const store = useChatsStore()
const current = computed(() => nav.find((n) => n.match(route.path))?.label ?? '')
const isDark = computed(() => theme.value === 'dark')

const auth = useAuthStore()
async function logout() {
  try {
    await auth.logout()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not log out')
  }
}
</script>

<template>
  <SidebarProvider>
    <Sidebar>
      <SidebarHeader class="px-3 py-4">
        <div class="flex items-center gap-2.5 px-1">
          <BotLogo class="size-8 shrink-0" />
          <div class="leading-tight">
            <div class="text-sm font-semibold">Moddy</div>
            <div class="text-xs text-muted-foreground">Telegram groups</div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <AppNav />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="p-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton @click="toggleTheme">
              <Sun v-if="isDark" /><Moon v-else />
              <span>{{ isDark ? 'Light mode' : 'Dark mode' }}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton as-child>
              <RouterLink :to="CHANGE_PASSWORD_PATH">
                <KeyRound />
                <span>Change password</span>
              </RouterLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton @click="logout">
              <LogOut />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>

    <SidebarInset class="min-w-0">
      <div class="sticky top-0 z-30">
        <div
          v-if="store.appEnv === 'development'"
          class="border-b border-amber-300 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950 dark:text-amber-200"
        >
          Development mode: bans are simulated, but messages are really deleted and admins are not exempt.
        </div>
        <header class="flex h-12 items-center gap-2 border-b bg-background/90 px-3 backdrop-blur md:px-5">
          <SidebarTrigger />
          <span class="text-sm font-medium">{{ current }}</span>
        </header>
      </div>
      <main class="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
