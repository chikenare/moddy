<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import BotLogo from '@/components/BotLogo.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeNext } from '@/lib/next'
import { newPasswordProblem } from '@/lib/password'
import { useAuthStore } from '@/stores/auth'

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
    toast.success(initial ? 'Password changed' : 'Password changed. Other sessions were logged out.')
    await router.replace(safeNext(route.query.next))
  } catch (e) {
    current.value = ''
    error.value = e instanceof Error ? e.message : 'Could not change the password'
  } finally {
    busy.value = false
  }
}

async function logout() {
  try {
    await auth.logout()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not log out')
  }
}
</script>

<template>
  <main class="flex min-h-svh items-center justify-center bg-muted/40 p-4">
    <div class="w-full max-w-sm space-y-6">
      <div class="flex flex-col items-center gap-3 text-center">
        <BotLogo class="size-16" />
        <div>
          <h1 class="text-xl font-semibold tracking-tight">{{ initial ? 'Choose your password' : 'Change password' }}</h1>
          <p class="text-sm text-muted-foreground">
            {{ initial ? 'The initial password is only for your first login. Choose your own to continue.' : 'This logs out every other device.' }}
          </p>
        </div>
      </div>
      <Card class="py-6">
        <CardContent class="px-6">
          <form class="space-y-4" @submit.prevent="submit">
            <div class="space-y-2">
              <Label for="current-password">{{ initial ? 'Initial password' : 'Current password' }}</Label>
              <Input id="current-password" v-model="current" type="password" autocomplete="current-password" autofocus @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="new-password">New password</Label>
              <Input id="new-password" v-model="next" type="password" autocomplete="new-password" :aria-invalid="problem ? true : undefined" aria-describedby="password-hint" @input="error = null" />
            </div>
            <div class="space-y-2">
              <Label for="repeat-password">Repeat the new password</Label>
              <Input id="repeat-password" v-model="repeat" type="password" autocomplete="new-password" @input="error = null" />
            </div>
            <p id="password-hint" class="text-sm" :class="problem ? 'text-destructive' : 'text-muted-foreground'">
              {{ problem ?? 'At least 12 characters.' }}
            </p>
            <p v-if="error" class="text-sm text-destructive" role="alert">{{ error }}</p>
            <Button type="submit" class="w-full" :disabled="busy || !ready">{{ busy ? 'Changing...' : 'Change password' }}</Button>
            <Button v-if="initial" type="button" variant="ghost" class="w-full" @click="logout">Log out</Button>
            <Button v-else as-child variant="ghost" class="w-full">
              <RouterLink to="/">Cancel</RouterLink>
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  </main>
</template>
