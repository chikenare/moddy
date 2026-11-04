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
    await store.addEntry(draft.value)
    draft.value = ''
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'No se pudo agregar la entrada'
  } finally {
    busy.value = false
  }
}

async function remove(entry: string) {
  try {
    await store.removeEntry(entry)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'No se pudo quitar la entrada')
  }
}
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">
      Los enlaces a estos dominios o canales se permiten. Ejemplos: example.com, t.me/micanal
    </p>
    <form class="space-y-2" @submit.prevent="add">
      <div class="flex gap-2">
        <Input
          v-model="draft" placeholder="example.com o t.me/micanal" aria-label="Enlace o dominio permitido"
          :aria-invalid="error ? true : undefined" @input="error = null"
        />
        <Button type="submit" :disabled="busy || !draft.trim()">Agregar</Button>
      </div>
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    </form>
    <p v-if="!store.whitelist.length" class="text-sm text-muted-foreground">La lista blanca está vacía</p>
    <ul v-else class="flex flex-wrap gap-2">
      <li v-for="e in store.whitelist" :key="e">
        <Badge variant="secondary" class="gap-1 py-1 pr-1 text-sm">
          <span class="break-all">{{ e }}</span>
          <button
            type="button" class="rounded-full p-0.5 hover:bg-background/60"
            :aria-label="`Quitar ${e}`" @click="remove(e)"
          >
            <X class="size-3.5" />
          </button>
        </Badge>
      </li>
    </ul>
  </div>
</template>
