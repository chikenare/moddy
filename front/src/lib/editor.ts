import { type Extensions, Mark, getSchema } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import StarterKit from '@tiptap/starter-kit'
import type { FormattedMessage } from '@/lib/api'
import { messageToDoc } from '@/lib/formatting'

const LINK_PROTOCOLS = new Set(['http:', 'https:', 'tg:'])

function isAllowedLink(url: string): boolean {
  try {
    return LINK_PROTOCOLS.has(new URL(url).protocol)
  } catch {
    return false
  }
}

export function normalizeLink(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const url = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`
  return isAllowedLink(url) ? url : null
}

const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML() {
    return [{ tag: 'span.tg-spoiler' }, { tag: 'tg-spoiler' }]
  },
  renderHTML() {
    return ['span', { class: 'tg-spoiler' }, 0]
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-p': () => this.editor.commands.toggleMark(this.name) }
  },
})

// A function placeholder is read on every redraw, so it can follow a language change.
export function richTextExtensions(placeholder: string | (() => string) = ''): Extensions {
  return [
    StarterKit.configure({
      heading: false, bulletList: false, orderedList: false, listItem: false, listKeymap: false,
      codeBlock: false, horizontalRule: false, dropcursor: false, gapcursor: false, trailingNode: false,
      link: {
        openOnClick: false, autolink: true, linkOnPaste: true, protocols: ['tg'],
        isAllowedUri: (url) => url !== undefined && isAllowedLink(url),
      },
    }),
    Spoiler,
    Placeholder.configure({ placeholder }),
  ]
}

const MARK_ORDER = Object.keys(getSchema(richTextExtensions()).marks)

export const docFor = (message: FormattedMessage) => messageToDoc(message, MARK_ORDER)
