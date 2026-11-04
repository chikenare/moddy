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

// Parents pass a fresh object on every render; only a change of content may reset the editor (it clears text selection).
watch(() => JSON.stringify([props.message.text, props.message.entities]), () => {
  editor.value?.commands.setContent(docFor(props.message), { emitUpdate: false })
})
</script>

<template>
  <EditorContent :editor="editor" />
</template>
