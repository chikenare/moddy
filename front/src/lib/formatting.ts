import type { JSONContent } from '@tiptap/core'
import type { FormattedEntity, FormattedMessage } from '@/lib/api'

type InlineType = Exclude<FormattedEntity['type'], 'blockquote' | 'text_link'>

const MARK_TO_ENTITY: Record<string, InlineType> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strike: 'strikethrough', spoiler: 'spoiler', code: 'code',
}
const ENTITY_TO_MARK: Record<InlineType, string> = {
  bold: 'bold', italic: 'italic', underline: 'underline', strikethrough: 'strike', spoiler: 'spoiler', code: 'code',
}

export const EMPTY_MESSAGE: FormattedMessage = { text: '', entities: [] }

export function docToMessage(doc: JSONContent): FormattedMessage {
  let text = ''
  const entities: FormattedEntity[] = []

  const add = (type: FormattedEntity['type'], offset: number, length: number, url?: string) => {
    const open = entities.find((e) => e.type === type && e.url === url && e.offset + e.length === offset)
    if (open) open.length += length
    else entities.push(url === undefined ? { type, offset, length } : { type, offset, length, url })
  }

  const inline = (nodes: JSONContent[] = []) => {
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        text += '\n'
      } else if (node.type === 'text' && node.text) {
        const offset = text.length
        text += node.text
        for (const mark of node.marks ?? []) {
          if (mark.type === 'link') add('text_link', offset, node.text.length, mark.attrs?.href as string)
          else if (MARK_TO_ENTITY[mark.type]) add(MARK_TO_ENTITY[mark.type]!, offset, node.text.length)
        }
      }
    }
  }

  const blocks = doc.content ?? []
  blocks.forEach((block, i) => {
    if (i > 0) text += '\n'
    if (block.type === 'blockquote') {
      const start = text.length
      ;(block.content ?? []).forEach((paragraph, j) => {
        if (j > 0) text += '\n'
        inline(paragraph.content)
      })
      if (text.length > start) entities.push({ type: 'blockquote', offset: start, length: text.length - start })
    } else {
      inline(block.content)
    }
  })

  return { text, entities }
}

export function messageToDoc(message: FormattedMessage, markOrder: string[] = []): JSONContent {
  const inlineEntities = message.entities.filter((e) => e.type !== 'blockquote')
  const quotes = message.entities.filter((e) => e.type === 'blockquote')
  const rank = (name: string) => {
    const index = markOrder.indexOf(name)
    return index === -1 ? markOrder.length : index
  }

  const paragraph = (start: number, end: number): JSONContent => {
    const edges = new Set([start, end])
    for (const e of inlineEntities) {
      for (const edge of [e.offset, e.offset + e.length]) if (edge > start && edge < end) edges.add(edge)
    }
    const points = [...edges].sort((a, b) => a - b)
    const content: JSONContent[] = []
    for (let i = 0; i + 1 < points.length; i++) {
      const from = points[i]!
      const to = points[i + 1]!
      const marks = inlineEntities
        .filter((e) => e.offset <= from && e.offset + e.length >= to)
        .map((e) => (e.type === 'text_link'
          ? { type: 'link', attrs: { href: e.url } }
          : { type: ENTITY_TO_MARK[e.type as InlineType] }))
        .sort((a, b) => rank(a.type) - rank(b.type))
      const node: JSONContent = { type: 'text', text: message.text.slice(from, to) }
      if (marks.length) node.marks = marks
      content.push(node)
    }
    return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
  }

  const content: JSONContent[] = []
  let offset = 0
  let openQuote = null as { entity: FormattedEntity; node: JSONContent } | null
  for (const line of message.text.split('\n')) {
    const start = offset
    const end = offset + line.length
    const node = paragraph(start, end)
    const quote = quotes.find((q) => q.offset < Math.max(end, start + 1) && q.offset + q.length > start)
    if (!quote) {
      openQuote = null
      content.push(node)
    } else if (openQuote?.entity === quote) {
      openQuote.node.content!.push(node)
    } else {
      openQuote = { entity: quote, node: { type: 'blockquote', content: [node] } }
      content.push(openQuote.node)
    }
    offset = end + 1
  }
  return { type: 'doc', content }
}
