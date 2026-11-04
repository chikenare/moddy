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

async function add() {
  if (!draft.value.trim()) return
  busy.value = true
  try {
    await store.addWord(draft.value)
    draft.value = ''
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo agregar la palabra')
  } finally {
    busy.value = false
  }
}

async function remove(w: string) {
  try {
    await store.removeWord(w)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo quitar la palabra')
  }
}
</script>

<template>
  <div class="space-y-4">
    <form class="flex gap-2" @submit.prevent="add">
      <Input v-model="draft" placeholder="Palabra prohibida" aria-label="Palabra prohibida" />
      <Button type="submit" :disabled="busy || !draft.trim()">Agregar</Button>
    </form>
    <p v-if="!store.words.length" class="text-sm text-muted-foreground">No hay palabras prohibidas</p>
    <ul v-else class="flex flex-wrap gap-2">
      <li v-for="w in store.words" :key="w">
        <Badge variant="secondary" class="gap-1 py-1 pr-1 text-sm">
          <span class="break-all">{{ w }}</span>
          <button
            type="button" class="rounded-full p-0.5 hover:bg-background/60"
            :aria-label="`Quitar ${w}`" @click="remove(w)"
          >
            <X class="size-3.5" />
          </button>
        </Badge>
      </li>
    </ul>
  </div>
</template>
