<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import FormattedText from '@/components/FormattedText.vue'
import RichTextEditor from '@/components/RichTextEditor.vue'
import type { AutoReply, FormattedMessage } from '@/lib/api'
import { EMPTY_MESSAGE } from '@/lib/formatting'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)
const enabled = computed(() => store.chat!.autoRepliesEnabled)

const triggers = ref('')
const reply = ref<FormattedMessage>(EMPTY_MESSAGE)
const editingId = ref<number | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const parseTriggers = () => triggers.value.split(',').map((t) => t.trim()).filter(Boolean)
const ready = computed(() => parseTriggers().length > 0 && reply.value.text.trim().length > 0)

function reset() {
  triggers.value = ''
  reply.value = EMPTY_MESSAGE
  editingId.value = null
  error.value = null
}

function edit(item: AutoReply) {
  editingId.value = item.id
  triggers.value = item.triggers.join(', ')
  reply.value = { text: item.reply, entities: item.entities }
  error.value = null
}

async function submit() {
  busy.value = true
  error.value = null
  try {
    await store.saveAutoReply(editingId.value, parseTriggers(), reply.value)
    reset()
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Could not save the auto reply'
  } finally {
    busy.value = false
  }
}

async function remove(item: AutoReply) {
  try {
    await store.removeAutoReply(item.id)
    if (editingId.value === item.id) reset()
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not delete the auto reply')
  }
}

async function toggle(value: boolean) {
  try {
    await store.update({ autoRepliesEnabled: value })
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not save the change')
  }
}
</script>

<template>
  <div class="space-y-4">
    <Card class="py-4">
      <CardContent class="flex items-center gap-4 px-4">
        <div class="min-w-0 flex-1">
          <Label for="autoRepliesEnabled" class="text-base font-semibold">Auto replies</Label>
          <p class="text-sm text-muted-foreground">
            The bot answers when a message contains a trigger word. Each reply goes out at most once a minute.
          </p>
        </div>
        <Switch id="autoRepliesEnabled" :model-value="enabled" @update:model-value="toggle" />
      </CardContent>
    </Card>

    <Alert v-if="!enabled && store.autoReplies.length" variant="destructive">
      <AlertDescription>Auto replies are off, so the bot will not answer these. Turn the switch on above.</AlertDescription>
    </Alert>

    <form class="space-y-2" @submit.prevent="submit">
      <Input v-model="triggers" placeholder="Trigger words, separated by commas: premium, vip" aria-label="Trigger words" />
      <RichTextEditor v-model="reply" label="Reply text" placeholder="Reply text" />
      <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
      <div class="flex justify-end gap-2">
        <Button v-if="editingId !== null" type="button" variant="outline" @click="reset">Cancel</Button>
        <Button type="submit" :disabled="busy || !ready">{{ editingId === null ? 'Add' : 'Save' }}</Button>
      </div>
    </form>

    <p v-if="!store.autoReplies.length" class="text-sm text-muted-foreground">No auto replies yet</p>
    <Card v-for="item in store.autoReplies" :key="item.id" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap gap-1">
          <Badge v-for="t in item.triggers" :key="t" variant="secondary" class="break-all">{{ t }}</Badge>
        </div>
        <FormattedText :message="{ text: item.reply, entities: item.entities }" />
        <div class="flex justify-end gap-2">
          <Button variant="outline" size="sm" @click="edit(item)">Edit</Button>
          <Button variant="outline" size="sm" @click="remove(item)">Delete</Button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
