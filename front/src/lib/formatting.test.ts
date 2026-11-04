import { describe, expect, test } from 'vitest'
import type { FormattedEntity, FormattedMessage } from '@/lib/api'
import { docToMessage, messageToDoc } from './formatting'

const p = (...content: object[]) => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })
const doc = (...content: object[]) => ({ type: 'doc', content })
const sorted = (entities: FormattedEntity[]) => [...entities].sort((a, b) => a.offset - b.offset || a.type.localeCompare(b.type))

describe('docToMessage', () => {
  test('paragraphs become lines, and an empty paragraph a blank line', () => {
    expect(docToMessage(doc(p(t('one')), { type: 'paragraph' }, p(t('two'))))).toEqual({ text: 'one\n\ntwo', entities: [] })
  })

  test('marks become entities', () => {
    expect(docToMessage(doc(p(t('a '), t('bold', 'bold'), t(' '), t('it', 'italic'), t(' '), t('u', 'underline'), t(' '), t('s', 'strike'), t(' '), t('x', 'spoiler'), t(' '), t('c', 'code'))))).toEqual({
      text: 'a bold it u s x c',
      entities: [
        { type: 'bold', offset: 2, length: 4 }, { type: 'italic', offset: 7, length: 2 }, { type: 'underline', offset: 10, length: 1 },
        { type: 'strikethrough', offset: 12, length: 1 }, { type: 'spoiler', offset: 14, length: 1 }, { type: 'code', offset: 16, length: 1 },
      ],
    })
  })

  test('offsets count UTF-16 units', () => {
    expect(docToMessage(doc(p(t('😀 '), t('hi', 'bold')))).entities).toEqual([{ type: 'bold', offset: 3, length: 2 }])
  })

  test('a style running across differently styled pieces is one entity', () => {
    expect(docToMessage(doc(p(t('bo', 'bold'), t('ld', 'bold', 'italic'))))).toEqual({
      text: 'bold',
      entities: [{ type: 'bold', offset: 0, length: 4 }, { type: 'italic', offset: 2, length: 2 }],
    })
  })

  test('links keep their address, and neighbouring links stay separate', () => {
    const link = (text: string, href: string) => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href, target: '_blank' } }] })
    expect(docToMessage(doc(p(link('a', 'https://a.example'), link('b', 'https://b.example')))).entities).toEqual([
      { type: 'text_link', offset: 0, length: 1, url: 'https://a.example' },
      { type: 'text_link', offset: 1, length: 1, url: 'https://b.example' },
    ])
  })

  test('a quote covers its lines', () => {
    expect(docToMessage(doc({ type: 'blockquote', content: [p(t('q1')), p(t('q2'))] }, p(t('after'))))).toEqual({
      text: 'q1\nq2\nafter',
      entities: [{ type: 'blockquote', offset: 0, length: 5 }],
    })
  })

  test('a hard break is a new line', () => {
    expect(docToMessage(doc(p(t('a'), { type: 'hardBreak' }, t('b')))).text).toBe('a\nb')
  })

  test('an empty document is an empty message', () => {
    expect(docToMessage(doc({ type: 'paragraph' }))).toEqual({ text: '', entities: [] })
  })
})

describe('messageToDoc', () => {
  test.each<[string, FormattedMessage]>([
    ['plain', { text: 'hello', entities: [] }],
    ['empty', { text: '', entities: [] }],
    ['blank line', { text: 'a\n\nb', entities: [] }],
    ['bold', { text: 'hello', entities: [{ type: 'bold', offset: 1, length: 3 }] }],
    ['nested', { text: 'hello', entities: [{ type: 'bold', offset: 0, length: 5 }, { type: 'italic', offset: 1, length: 2 }] }],
    ['link', { text: 'see this', entities: [{ type: 'text_link', offset: 4, length: 4, url: 'https://x.example' }] }],
    ['emoji', { text: '😀 hi', entities: [{ type: 'spoiler', offset: 3, length: 2 }] }],
    ['quote', { text: 'q1\nq2\nafter', entities: [{ type: 'blockquote', offset: 0, length: 5 }] }],
    ['style in quote', { text: 'q1\nafter', entities: [{ type: 'blockquote', offset: 0, length: 2 }, { type: 'bold', offset: 0, length: 1 }] }],
    ['two quotes', { text: 'a\nb\nc', entities: [{ type: 'blockquote', offset: 0, length: 1 }, { type: 'blockquote', offset: 4, length: 1 }] }],
    ['blank line in a quote', { text: 'a\n\nb', entities: [{ type: 'blockquote', offset: 0, length: 4 }] }],
  ])('%s survives the round trip', (_name, message) => {
    const back = docToMessage(messageToDoc(message))
    expect(back.text).toBe(message.text)
    expect(sorted(back.entities)).toEqual(sorted(message.entities))
  })

  test('a style across lines is split per line, covering the same text', () => {
    const back = docToMessage(messageToDoc({ text: 'abc\ndef', entities: [{ type: 'bold', offset: 0, length: 7 }] }))
    expect(back).toEqual({ text: 'abc\ndef', entities: [{ type: 'bold', offset: 0, length: 3 }, { type: 'bold', offset: 4, length: 3 }] })
  })

  test('a quote over part of a line takes the whole line', () => {
    const back = docToMessage(messageToDoc({ text: 'hello\nworld', entities: [{ type: 'blockquote', offset: 1, length: 2 }] }))
    expect(back.entities).toEqual([{ type: 'blockquote', offset: 0, length: 5 }])
  })

  test('marks follow the schema order given, which the editor requires', () => {
    const entities: FormattedEntity[] = [{ type: 'italic', offset: 0, length: 2 }, { type: 'bold', offset: 0, length: 2 }]
    const node = messageToDoc({ text: 'hi', entities }, ['bold', 'italic']).content![0]!.content![0]!
    expect(node.marks!.map((m) => m.type)).toEqual(['bold', 'italic'])
    const flipped = messageToDoc({ text: 'hi', entities }, ['italic', 'bold']).content![0]!.content![0]!
    expect(flipped.marks!.map((m) => m.type)).toEqual(['italic', 'bold'])
  })
})
