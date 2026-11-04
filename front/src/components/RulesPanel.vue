<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)

const MAX = 4000
const draft = ref(store.chat!.rules)
const busy = ref(false)
watch(() => store.chat?.rules, (rules) => { draft.value = rules ?? '' })

const dirty = computed(() => draft.value.trim() !== store.chat!.rules)

async function save() {
  busy.value = true
  try {
    await store.update({ rules: draft.value })
    toast.success('Rules saved')
  } catch (e) {
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
    <Textarea v-model="draft" :maxlength="MAX" rows="10" placeholder="Group rules" aria-label="Group rules" />
    <div class="flex items-center justify-between gap-3">
      <span class="text-xs text-muted-foreground">{{ draft.length }} / {{ MAX }}</span>
      <Button type="submit" :disabled="busy || !dirty">Save</Button>
    </div>
  </form>
</template>
