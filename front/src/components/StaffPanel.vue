<script setup lang="ts">
import { X } from '@lucide/vue'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)

const draft = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function add() {
  if (!draft.value.trim()) return
  busy.value = true
  error.value = null
  try {
    await store.addStaff(draft.value)
    draft.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add the staff member'
  } finally {
    busy.value = false
  }
}

async function remove(userId: number) {
  try {
    await store.removeStaff(userId)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not remove the staff member')
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">
      Staff members are exempt from every filter in this group, without being admins.
      If Telegram commands are on, they can also ban, warn and unban other members.
      Add them by @username if they've written in the group since moderation was on, or by numeric user ID.
    </p>
    <form class="space-y-2" @submit.prevent="add">
      <div class="flex gap-2">
        <Input
          v-model="draft" placeholder="@username or user ID" aria-label="Staff member"
          :aria-invalid="error ? true : undefined" @input="error = null"
        />
        <Button type="submit" :disabled="busy || !draft.trim()">Add</Button>
      </div>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </form>
    <p v-if="!store.staff.length" class="text-sm text-muted-foreground">No staff yet</p>
    <ul v-else class="flex flex-wrap gap-2">
      <li v-for="s in store.staff" :key="s.userId">
        <Badge variant="secondary" class="gap-1 py-1 pr-1 text-sm">
          <span class="break-all">{{ s.displayName }}</span>
          <span class="text-xs text-muted-foreground">{{ s.userId }}</span>
          <button
            type="button" class="rounded-full p-0.5 hover:bg-background/60"
            :aria-label="`Remove ${s.displayName}`" @click="remove(s.userId)"
          >
            <X class="size-3.5" />
          </button>
        </Badge>
      </li>
    </ul>
  </div>
</template>
