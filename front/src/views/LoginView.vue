<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import BotLogo from '@/components/BotLogo.vue'
import LanguageMenu from '@/components/LanguageMenu.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/next'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
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
    error.value = e instanceof Error ? e.message : t('login.failed')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <main class="relative flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <LanguageMenu class="absolute top-3 right-3" />
    <div class="w-full max-w-sm space-y-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <BotLogo class="size-16" />
        <div>
          <h1 class="text-xl font-semibold tracking-tight">Moddy</h1>
          <p class="text-sm text-muted-foreground">{{ t('login.subtitle') }}</p>
        </div>
      </div>
      <Card class="py-6">
        <CardContent class="px-6">
          <form class="space-y-4" @submit.prevent="submit">
            <div class="space-y-2">
              <Label for="username">{{ t('login.username') }}</Label>
              <Input id="username" v-model="username" autocomplete="username" autocapitalize="none" spellcheck="false" autofocus @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="password">{{ t('login.password') }}</Label>
              <Input id="password" v-model="password" type="password" autocomplete="current-password" :aria-invalid="error ? true : undefined" @input="error = null" />
            </div>
            <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
            <p v-else-if="auth.unreachable" class="text-sm text-muted-foreground" role="status">{{ t('login.unreachable') }}</p>
            <Button type="submit" class="w-full" :disabled="busy || !ready">{{ busy ? t('login.submitting') : t('login.submit') }}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
