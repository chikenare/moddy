<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BotLogo from '@/components/BotLogo.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/next'
import { useAuthStore } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

const username = ref('')
const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)
const ready = computed(() => username.value.length > 0 && password.value.length > 0)

async function submit() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await auth.login(username.value, password.value)
    await router.replace(safeNext(route.query.next))
  } catch (e) {
    password.value = ''
    error.value = e instanceof Error ? e.message : 'Could not log in'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <BotLogo class="size-16" />
        <div>
          <h1 class="text-xl font-semibold tracking-tight">Moderation</h1>
          <p class="text-sm text-muted-foreground">Log in to manage your Telegram groups</p>
        </div>
      </div>
      <Card class="py-6">
        <CardContent class="px-6">
          <form class="space-y-4" @submit.prevent="submit">
            <div class="space-y-2">
              <Label for="username">Username</Label>
              <Input id="username" v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="password">Password</Label>
              <Input id="password" v-model="password" type="password" autocomplete="current-password" :aria-invalid="error ? true : undefined" @input="error = null" />
            </div>
            <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
            <p v-else-if="auth.unreachable" class="text-sm text-muted-foreground" role="status">Can't reach the server. Reload the page in a moment.</p>
            <Button type="submit" class="w-full" :disabled="busy || !ready">{{ busy ? 'Logging in...' : 'Log in' }}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
