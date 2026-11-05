<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
const { t } = useI18n()
const chat = computed(() => store.chat!)

async function save(patch: Partial<ChatSettings>) {
  try {
    await store.update(patch)
  } catch (e) {
    toast.error(e instanceof Error ? e.message : t('common.saveChangeFailed'))
  }
}

const linkWarning = computed(
  () => chat.value.linkFilterEnabled && store.whitelist.length === 0,
)
const linkWarningText = computed(() =>
  chat.value.linkFilterAction === 'delete_ban'
    ? t('filters.linkWarningBan')
    : t('filters.linkWarningDelete'),
)

const filters = [
  { label: 'filters.links', enabled: 'linkFilterEnabled', action: 'linkFilterAction' },
  { label: 'filters.words', enabled: 'wordFilterEnabled', action: 'wordFilterAction' },
  { label: 'filters.flood', enabled: 'floodFilterEnabled', action: 'floodFilterAction' },
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

const warnLimit = ref<string | number>(chat.value.warnLimit)
watch(() => chat.value.warnLimit, (n) => { warnLimit.value = n })

function commitWarnLimit() {
  const raw = String(warnLimit.value)
  const n = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(n) || n === chat.value.warnLimit) {
    warnLimit.value = chat.value.warnLimit
    return
  }
  void save({ warnLimit: n }).then(() => { warnLimit.value = chat.value.warnLimit })
}

// The bot fills these in English in the group, so the preview does too.
const SAMPLE: Record<string, string> = { user: 'Ana', action: 'banned', reason: 'banned word' }
const preview = computed(() => template.value.replace(/\{(user|action|reason)\}/g, (_, key: string) => SAMPLE[key]!))
</script>

<template>
  <div class="space-y-4">
    <Card class="py-4">
      <CardContent class="flex items-center gap-4 px-4">
        <div class="min-w-0 flex-1">
          <Label for="moderation" class="text-base font-semibold">{{ t('filters.moderation') }}</Label>
          <p class="text-sm text-muted-foreground">{{ t('filters.moderationHint') }}</p>
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
          <Label :for="f.enabled" class="min-w-0 flex-1 font-medium">{{ t(f.label) }}</Label>
          <Select
            :model-value="chat[f.action]"
            @update:model-value="(v) => save({ [f.action]: v as FilterAction })"
          >
            <SelectTrigger class="w-44" :aria-label="t('filters.actionFor', { filter: t(f.label) })"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="delete">{{ t('filters.deleteOnly') }}</SelectItem>
              <SelectItem value="delete_ban">{{ t('filters.deleteBan') }}</SelectItem>
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
            v-model="count" type="number" min="2" max="50" inputmode="numeric" class="w-20" :aria-label="t('filters.floodMessages')"
            @change="commitFlood('floodCount', count)"
          />
          <span>{{ t('filters.floodMessagesIn') }}</span>
          <Input
            v-model="seconds" type="number" min="1" max="3600" inputmode="numeric" class="w-20" :aria-label="t('filters.floodSeconds')"
            @change="commitFlood('floodSeconds', seconds)"
          />
          <span>{{ t('filters.floodSecondsSuffix') }}</span>
        </div>
      </CardContent>
    </Card>

    <Card class="py-4">
      <CardContent class="flex items-center gap-3 px-4">
        <Label for="botFilterEnabled" class="min-w-0 flex-1 font-medium">{{ t('filters.bots') }}</Label>
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
            <Label for="noticeEnabled" class="font-medium">{{ t('filters.notice') }}</Label>
            <p class="text-sm text-muted-foreground">
              {{ t('filters.noticeHint') }}
            </p>
          </div>
          <Switch
            id="noticeEnabled"
            :model-value="chat.noticeEnabled"
            @update:model-value="(v: boolean) => save({ noticeEnabled: v })"
          />
        </div>
        <div v-if="chat.noticeEnabled" class="space-y-2">
          <Input v-model="template" maxlength="500" :aria-label="t('filters.noticeText')" @change="commitTemplate" />
          <i18n-t keypath="filters.noticeVariables" tag="p" class="text-sm text-muted-foreground">
            <template #user><code>{user}</code></template>
            <template #action><code>{action}</code></template>
            <template #reason><code>{reason}</code></template>
          </i18n-t>
          <p class="text-sm break-words"><span class="text-muted-foreground">{{ t('filters.preview') }}</span> {{ preview }}</p>
        </div>
      </CardContent>
    </Card>

    <Card class="py-4">
      <CardContent class="space-y-3 px-4">
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <Label for="commandsEnabled" class="font-medium">{{ t('filters.commands') }}</Label>
            <i18n-t keypath="filters.commandsHint" tag="p" class="text-sm text-muted-foreground">
              <template #ban><code>/ban</code></template>
              <template #unban><code>/unban</code></template>
              <template #warn><code>/warn</code></template>
            </i18n-t>
          </div>
          <Switch
            id="commandsEnabled"
            :model-value="chat.commandsEnabled"
            @update:model-value="(v: boolean) => save({ commandsEnabled: v })"
          />
        </div>
        <div v-if="chat.commandsEnabled" class="flex flex-wrap items-center gap-2 text-sm">
          <Input
            v-model="warnLimit" type="number" min="1" max="20" inputmode="numeric" class="w-20" :aria-label="t('filters.warnLimit')"
            @change="commitWarnLimit"
          />
          <span>{{ t('filters.warnLimitSuffix') }}</span>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
