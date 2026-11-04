<script setup lang="ts">
import { EditorContent, useEditor } from '@tiptap/vue-3'
import { watch } from 'vue'
import type { FormattedMessage } from '@/lib/api'
import { docFor, richTextExtensions } from '@/lib/editor'

const props = defineProps<{ message: FormattedMessage }>()

const editor = useEditor({
  editable: false,
  content: docFor(props.message),
  extensions: richTextExtensions(),
  editorProps: { attributes: { class: 'rich-text text-sm break-words' } },
})

watch(() => props.message, (message) => editor.value?.commands.setContent(docFor(message), { emitUpdate: false }))
</script>

<template>
  <EditorContent :editor="editor" />
</template>
