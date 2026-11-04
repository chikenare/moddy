<script setup lang="ts">
import { X } from '@lucide/vue'
import { computed, ref } from 'vue'
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
    await store.addEntry(draft.value)
    draft.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not add the entry'
  } finally {
    busy.value = false
  }
}

const suggestions = computed(() => {
  const chat = store.chat
  if (!chat) return []
  const found: string[] = []
  const id = String(chat.id)
  if (chat.type === 'supergroup' && id.startsWith('-100')) found.push(`t.me/c/${id.slice(4)}`)
  if (chat.username) found.push(`t.me/${chat.username.toLowerCase()}`)
  return found.filter((entry) => !store.whitelist.includes(entry))
})

async function addSuggestion(entry: string) {
  try {
    await store.addEntry(entry)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not add the entry')
  }
}

async function remove(entry: string) {
  try {
    await store.removeEntry(entry)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not remove the entry')
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">
      Links to these domains or channels are allowed. Examples: example.com, t.me/mychannel
    </p>
    <form class="space-y-2" @submit.prevent="add">
      <div class="flex gap-2">
        <Input
          v-model="draft" placeholder="example.com or t.me/mychannel" aria-label="Allowed link or domain"
          :aria-invalid="error ? true : undefined" @input="error = null"
        />
        <Button type="submit" :disabled="busy || !draft.trim()">Add</Button>
      </div>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </form>
    <div v-if="suggestions.length" class="space-y-2">
      <p class="text-sm text-muted-foreground">
        Links to messages in this group count too. To allow them, add:
      </p>
      <div class="flex flex-wrap gap-2">
        <Button v-for="s in suggestions" :key="s" type="button" variant="outline" size="sm" @click="addSuggestion(s)">
          {{ s }}
        </Button>
      </div>
    </div>
    <p v-if="!store.whitelist.length" class="text-sm text-muted-foreground">The whitelist is empty</p>
    <ul v-else class="flex flex-wrap gap-2">
      <li v-for="e in store.whitelist" :key="e">
        <Badge variant="secondary" class="gap-1 py-1 pr-1 text-sm">
          <span class="break-all">{{ e }}</span>
          <button
            type="button" class="rounded-full p-0.5 hover:bg-background/60"
            :aria-label="`Remove ${e}`" @click="remove(e)"
          >
            <X class="size-3.5" />
          </button>
        </Badge>
      </li>
    </ul>
  </div>
</template>
