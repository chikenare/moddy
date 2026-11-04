<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ChatSettings, FilterAction } from '@/lib/api'
import { useChatDetailStore } from '@/stores/chatDetail'

const props = defineProps<{ id: number }>()
const store = useChatDetailStore(props.id)
const chat = computed(() => store.chat!)

async function save(patch: Partial<ChatSettings>) {
  try {
    await store.update(patch)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Could not save the change')
  }
}

const linkWarning = computed(
  () => chat.value.linkFilterEnabled && store.whitelist.length === 0,
)
const linkWarningText = computed(() =>
  chat.value.linkFilterAction === 'delete_ban'
    ? 'Any link from a member will cause a ban.'
    : 'Any link from a member will be deleted.',
)

const filters = [
  { label: 'Links', enabled: 'linkFilterEnabled', action: 'linkFilterAction' },
  { label: 'Banned words', enabled: 'wordFilterEnabled', action: 'wordFilterAction' },
  { label: 'Flood', enabled: 'floodFilterEnabled', action: 'floodFilterAction' },
] as const

const count = ref<string | number>(chat.value.floodCount)
const seconds = ref<string | number>(chat.value.floodSeconds)
watch(() => [chat.value.floodCount, chat.value.floodSeconds], ([c, s]) => {
  count.value = c
  seconds.value = s
})

function commitFlood(key: 'floodCount' | 'floodSeconds', value: string | number) {
  const raw = String(value)
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n === chat.value[key]) {
    count.value = chat.value.floodCount
    seconds.value = chat.value.floodSeconds
    return
  }
  void save({ [key]: n })
}

const template = ref(chat.value.noticeTemplate)
watch(() => chat.value.noticeTemplate, (t) => { template.value = t })

function commitTemplate() {
  const text = template.value.trim()
  if (!text || text === chat.value.noticeTemplate) {
    template.value = chat.value.noticeTemplate
    return
  }
  void save({ noticeTemplate: text })
}

const SAMPLE: Record<string, string> = { user: 'Ana', action: 'banned', reason: 'banned word' }
const preview = computed(() => template.value.replace(/\{(user|action|reason)\}/g, (_, key: string) => SAMPLE[key]!))
</script>

<template>
  <div class="space-y-4">
    <Card class="py-4">
      <CardContent class="flex items-center gap-4 px-4">
        <div class="min-w-0 flex-1">
          <Label for="moderation" class="text-base font-semibold">Moderation</Label>
          <p class="text-sm text-muted-foreground">Turn all filters for this group on or off</p>
        </div>
        <Switch
          id="moderation"
          :model-value="chat.moderationEnabled"
          @update:model-value="(v: boolean) => save({ moderationEnabled: v })"
        />
      </CardContent>
    </Card>

    <Alert v-if="linkWarning" variant="destructive">
      <TriangleAlert />
      <AlertDescription>{{ linkWarningText }}</AlertDescription>
    </Alert>

    <Card v-for="f in filters" :key="f.enabled" class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex flex-wrap items-center gap-3">
          <Label :for="f.enabled" class="min-w-0 flex-1 font-medium">{{ f.label }}</Label>
          <Select
            :model-value="chat[f.action]"
            @update:model-value="(v) => save({ [f.action]: v as FilterAction })"
          >
            <SelectTrigger class="w-44" :aria-label="`Action for ${f.label}`"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="delete">Delete only</SelectItem>
              <SelectItem value="delete_ban">Delete and ban</SelectItem>
            </SelectContent>
          </Select>
          <Switch
            :id="f.enabled"
            :model-value="chat[f.enabled]"
            @update:model-value="(v: boolean) => save({ [f.enabled]: v })"
          />
        </div>
        <div v-if="f.enabled === 'floodFilterEnabled'" class="flex flex-wrap items-center gap-2 text-sm">
          <Input
            v-model="count" type="number" min="2" max="50" inputmode="numeric" class="w-20" aria-label="Messages"
            @change="commitFlood('floodCount', count)"
          />
          <span>messages in</span>
          <Input
            v-model="seconds" type="number" min="1" max="3600" inputmode="numeric" class="w-20" aria-label="Seconds"
            @change="commitFlood('floodSeconds', seconds)"
          />
          <span>seconds</span>
        </div>
      </CardContent>
    </Card>

    <Card class="py-4">
      <CardContent class="flex items-center gap-3 px-4">
        <Label for="botFilterEnabled" class="min-w-0 flex-1 font-medium">Bots</Label>
        <Switch
          id="botFilterEnabled"
          :model-value="chat.botFilterEnabled"
          @update:model-value="(v: boolean) => save({ botFilterEnabled: v })"
        />
      </CardContent>
    </Card>

    <Card class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <Label for="noticeEnabled" class="font-medium">Group notice</Label>
            <p class="text-sm text-muted-foreground">
              Post a message when the bot deletes or bans. At most one every 10 seconds.
            </p>
          </div>
          <Switch
            id="noticeEnabled"
            :model-value="chat.noticeEnabled"
            @update:model-value="(v: boolean) => save({ noticeEnabled: v })"
          />
        </div>
        <div v-if="chat.noticeEnabled" class="space-y-2">
          <Input v-model="template" maxlength="500" aria-label="Notice text" @change="commitTemplate" />
          <p class="text-sm text-muted-foreground">
            You can use <code>{user}</code>, <code>{action}</code> and <code>{reason}</code>.
            If a name looks like a link, the user ID is shown.
          </p>
          <p class="text-sm break-words"><span class="text-muted-foreground">Preview:</span> {{ preview }}</p>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
