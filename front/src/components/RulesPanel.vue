<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import RichTextEditor from '@/components/RichTextEditor.vue'
import type { FormattedMessage } from '@/lib/api'
import { EMPTY_MESSAGE } from '@/lib/formatting'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)

const MAX = 4000
const saved = (): FormattedMessage => ({ text: store.chat!.rules, entities: store.chat!.rulesEntities })
const draft = ref<FormattedMessage>(saved())
const busy = ref(false)
// A string key, so a store refresh that returns the same rules does not rewind what is being typed.
// What this panel is saving is not an outside change either: the store echoes it back (optimistic update, then the
// server's reply), and applying it would drop whatever was typed while the request was in flight.
let sentKey: string | null = null
const keyOf = (m: FormattedMessage) => JSON.stringify([m.text, m.entities])
watch(() => JSON.stringify([store.chat?.rules, store.chat?.rulesEntities]), (key) => {
  if (key === sentKey) return
  draft.value = store.chat ? saved() : EMPTY_MESSAGE
})

const dirty = computed(() => {
  const current = saved()
  return draft.value.text.trim() !== current.text || JSON.stringify(trimmed().entities) !== JSON.stringify(current.entities)
})

// The server trims the text and moves the styles with it; compare what it would store.
function trimmed(): FormattedMessage {
  const lead = draft.value.text.length - draft.value.text.trimStart().length
  const length = draft.value.text.trim().length
  const entities = draft.value.entities
    .map((e) => ({ ...e, offset: Math.max(e.offset - lead, 0), length: Math.min(e.offset + e.length - lead, length) - Math.max(e.offset - lead, 0) }))
    .filter((e) => e.length > 0)
  return { text: draft.value.text.trim(), entities }
}

async function save() {
  busy.value = true
  sentKey = keyOf({ text: trimmed().text, entities: trimmed().entities })
  const typed = draft.value
  try {
    await store.update({ rules: draft.value.text, rulesEntities: draft.value.entities })
    toast.success('Rules saved')
  } catch (e) {
    // The store reverts the chat; that must not rewind what the owner typed.
    draft.value = typed
    sentKey = keyOf(saved())
    await nextTick()
    sentKey = null
    toast.error(e instanceof Error ? e.message : 'Could not save the rules')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-3" @submit.prevent="save">
    <p class="text-sm text-muted-foreground">
      Members see these with <code>/rules</code> in the group, at most once a minute. Leave it empty to turn the command off.
    </p>
    <RichTextEditor v-model="draft" label="Group rules" placeholder="Group rules" />
    <div class="flex items-center justify-between gap-3">
      <span class="text-xs" :class="draft.text.length > MAX ? 'text-destructive' : 'text-muted-foreground'">{{ draft.text.length }} / {{ MAX }}</span>
      <Button type="submit" :disabled="busy || !dirty || draft.text.length > MAX">Save</Button>
    </div>
  </form>
</template>
