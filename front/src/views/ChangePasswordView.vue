<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import BotLogo from '@/components/BotLogo.vue'
import LanguageMenu from '@/components/LanguageMenu.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/next'
import { newPasswordProblem } from '@/lib/password'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

// Kept from the start: the store clears the flag as soon as the change succeeds.
const initial = auth.mustChangePassword

const current = ref('')
const next = ref('')
const repeat = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const problem = computed(() => newPasswordProblem(current.value, next.value, repeat.value))
const ready = computed(() => current.value.length > 0 && next.value.length > 0 && repeat.value.length > 0 && !problem.value)

async function submit() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = null
  try {
    await auth.changePassword(current.value, next.value)
    toast.success(initial ? t('password.changed') : t('password.changedOthersLoggedOut'))
    await router.replace(safeNext(route.query.next))
  } catch (e) {
    current.value = ''
    error.value = e instanceof Error ? e.message : t('password.failed')
  } finally {
    busy.value = false
  }
}

async function logout() {
  try {
    await auth.logout()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('common.logOutFailed'))
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
          <h1 class="text-xl font-semibold tracking-tight">{{ initial ? t('password.titleInitial') : t('password.title') }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ initial ? t('password.subtitleInitial') : t('password.subtitle') }}
          </p>
        </div>
      </div>
      <Card class="py-6">
        <CardContent class="px-6">
          <form class="space-y-4" @submit.prevent="submit">
            <div class="space-y-2">
              <Label for="current-password">{{ initial ? t('password.currentInitial') : t('password.current') }}</Label>
              <Input id="current-password" v-model="current" type="password" autocomplete="current-password" autofocus @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="new-password">{{ t('password.new') }}</Label>
              <Input id="new-password" v-model="next" type="password" autocomplete="new-password" :aria-invalid="problem ? true : undefined" aria-describedby="password-hint" @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="repeat-password">{{ t('password.repeat') }}</Label>
              <Input id="repeat-password" v-model="repeat" type="password" autocomplete="new-password" @input="error = null" />
            </div>
            <p id="password-hint" class="text-sm" :class="problem ? 'text-destructive' : 'text-muted-foreground'">
              {{ problem ? t(`password.problem.${problem}`) : t('password.hint') }}
            </p>
            <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
            <Button type="submit" class="w-full" :disabled="busy || !ready">{{ busy ? t('password.submitting') : t('password.submit') }}</Button>
            <Button v-if="initial" type="button" variant="ghost" class="w-full" @click="logout">{{ t('common.logOut') }}</Button>
            <Button v-else as-child variant="ghost" class="w-full">
              <RouterLink to="/">{{ t('common.cancel') }}</RouterLink>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
