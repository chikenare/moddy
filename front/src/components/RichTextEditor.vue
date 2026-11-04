<script setup lang="ts">
import { Bold, Code, EyeOff, Italic, Link as LinkIcon, Strikethrough, TextQuote, Underline } from '@lucide/vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { nextTick, ref, toRaw, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { FormattedMessage } from '@/lib/api'
import { docFor, normalizeLink, richTextExtensions } from '@/lib/editor'
import { docToMessage } from '@/lib/formatting'

const props = defineProps<{ modelValue: FormattedMessage; label: string; placeholder?: string }>()
const emit = defineEmits<{ 'update:modelValue': [FormattedMessage] }>()

let lastEmitted: FormattedMessage | null = null

const editor = useEditor({
  content: docFor(props.modelValue),
  extensions: richTextExtensions(props.placeholder),
  editorProps: {
    attributes: {
      class: 'rich-text min-h-24 px-3 py-2 text-sm outline-none',
      role: 'textbox', 'aria-multiline': 'true', 'aria-label': props.label,
    },
  },
  onUpdate: ({ editor: current }) => {
    lastEmitted = docToMessage(current.getJSON())
    emit('update:modelValue', lastEmitted)
  },
})

// Only a value that came from outside replaces the content, or fast typing would be rewound.
watch(() => props.modelValue, (value) => {
  if (toRaw(value) !== lastEmitted) editor.value?.commands.setContent(docFor(value), { emitUpdate: false })
})

const tools = [
  { label: 'Bold (Ctrl+B)', icon: Bold, mark: 'bold', run: () => editor.value?.chain().focus().toggleBold().run() },
  { label: 'Italic (Ctrl+I)', icon: Italic, mark: 'italic', run: () => editor.value?.chain().focus().toggleItalic().run() },
  { label: 'Underline (Ctrl+U)', icon: Underline, mark: 'underline', run: () => editor.value?.chain().focus().toggleUnderline().run() },
  { label: 'Strikethrough', icon: Strikethrough, mark: 'strike', run: () => editor.value?.chain().focus().toggleStrike().run() },
  { label: 'Spoiler (Ctrl+Shift+P)', icon: EyeOff, mark: 'spoiler', run: () => editor.value?.chain().focus().toggleMark('spoiler').run() },
  { label: 'Monospace', icon: Code, mark: 'code', run: () => editor.value?.chain().focus().toggleCode().run() },
  { label: 'Quote', icon: TextQuote, mark: 'blockquote', run: () => editor.value?.chain().focus().toggleBlockquote().run() },
]

const linkOpen = ref(false)
const linkUrl = ref('')
const linkError = ref<string | null>(null)
const linkInput = ref<InstanceType<typeof Input> | null>(null)

function toggleLinkForm() {
  linkOpen.value = !linkOpen.value
  linkError.value = null
  if (!linkOpen.value) return
  linkUrl.value = (editor.value?.getAttributes('link').href as string | undefined) ?? ''
  void nextTick(() => (linkInput.value?.$el as HTMLInputElement | undefined)?.focus())
}

function applyLink() {
  const current = editor.value
  if (!current) return
  const href = normalizeLink(linkUrl.value)
  if (!href) {
    linkError.value = 'Use an http, https or tg link'
    return
  }
  if (current.state.selection.empty && !current.isActive('link')) {
    current.chain().focus().insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] }).run()
  } else {
    current.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }
  linkOpen.value = false
}

function removeLink() {
  editor.value?.chain().focus().extendMarkRange('link').unsetLink().run()
  linkOpen.value = false
}
</script>

<template>
  <div class="rounded-md border bg-transparent shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
    <div class="flex flex-wrap items-center gap-0.5 border-b p-1" role="toolbar" :aria-label="`${label} formatting`">
      <Button
        v-for="tool in tools" :key="tool.mark" type="button" variant="ghost" size="icon" class="size-8"
        :class="{ 'bg-accent text-accent-foreground': editor?.isActive(tool.mark) }"
        :title="tool.label" :aria-label="tool.label" :aria-pressed="editor?.isActive(tool.mark) ?? false"
        @mousedown.prevent @click="tool.run()"
      >
        <component :is="tool.icon" class="size-4" />
      </Button>
      <Button
        type="button" variant="ghost" size="icon" class="size-8"
        :class="{ 'bg-accent text-accent-foreground': editor?.isActive('link') || linkOpen }"
        title="Link" aria-label="Link" :aria-pressed="editor?.isActive('link') ?? false"
        @mousedown.prevent @click="toggleLinkForm"
      >
        <LinkIcon class="size-4" />
      </Button>
    </div>
    <div v-if="linkOpen" class="space-y-1 border-b p-2">
      <div class="flex flex-wrap gap-2">
        <Input
          ref="linkInput" v-model="linkUrl" class="min-w-40 flex-1" placeholder="https://example.com" aria-label="Link address"
          @keydown.enter.prevent="applyLink" @input="linkError = null"
        />
        <Button type="button" size="sm" class="h-9" @click="applyLink">Apply</Button>
        <Button v-if="editor?.isActive('link')" type="button" variant="outline" size="sm" class="h-9" @click="removeLink">Remove</Button>
      </div>
      <p v-if="linkError" class="text-xs text-destructive">{{ linkError }}</p>
    </div>
    <EditorContent :editor="editor" />
  </div>
</template>
