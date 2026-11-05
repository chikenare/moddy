import { expect, test } from 'vitest'
import { createI18n } from 'vue-i18n'
import { detectLocale } from './index'
import en from './en'
import es from './es'

test.each([
  ['a saved choice beats the browser', 'en', ['es-MX'], 'en'],
  ['the browser language, by its base', null, ['es-MX', 'en'], 'es'],
  ['the first language we have', null, ['fr-FR', 'es', 'en'], 'es'],
  ['English when nothing matches', null, ['fr-FR', 'de'], 'en'],
  ['English with no languages', null, [], 'en'],
  ['an unknown saved value is ignored', 'xx', ['es'], 'es'],
])('detectLocale: %s', (_name, saved, languages, expected) => {
  expect(detectLocale(saved, languages)).toBe(expected)
})

// Typing already checks this in the editor; the test also guards a build that skips the type check.
const leaves = (o: object, prefix = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[prefix + k, v] as [string, string]] : leaves(v, `${prefix}${k}.`)))

test('Spanish has the same keys as English', () => {
  expect(leaves(es).map(([k]) => k)).toEqual(leaves(en).map(([k]) => k))
})

// vue-i18n accepts any string as a key, so a typo would only show up as the raw key on screen.
test('every key the code uses exists', () => {
  const sources = import.meta.glob<string>(['../**/*.{vue,ts}', '!../components/ui/**', '!../**/*.test.ts'], {
    query: '?raw', import: 'default', eager: true,
  })
  const known = new Set(leaves(en).map(([k]) => k))
  const prefixes = new Set([...known].flatMap((k) => k.split('.').slice(0, -1).map((_, i, parts) => `${parts.slice(0, i + 1).join('.')}.`)))
  const missing: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    // t('a.b'), $t('a.b'), tr('a.b'), keypath="a.b", and a dynamic `a.${x}` checked by its prefix.
    for (const [, key] of source.matchAll(/(?:\$?\btr?\(\s*['"`]|keypath=")([a-zA-Z]+\.[\w.]*)(\$\{)?/g)) {
      const dynamic = key!.endsWith('.')
      if (dynamic ? !prefixes.has(key!) : !known.has(key!)) missing.push(`${file}: ${key}`)
    }
    // Keys kept in data and translated later, like the nav and filter labels.
    for (const [, key] of source.matchAll(/label: '((?:nav|filters|filter|overview)\.[\w.]+)'/g)) {
      if (!known.has(key!)) missing.push(`${file}: ${key}`)
    }
  }
  expect(missing).toEqual([])
})

// A stray @, | or { breaks a message silently: it renders cut short or as the raw key.
test.each(['en', 'es'] as const)('every %s message renders', (locale) => {
  const errors: string[] = []
  const check = createI18n({
    legacy: false, locale, messages: { en, es }, missingWarn: false, fallbackWarn: false,
  })
  const named = new Proxy({}, { get: (_, key) => (typeof key === 'string' ? `<${key}>` : undefined), has: () => true })
  for (const [key, source] of leaves(locale === 'en' ? en : es)) {
    for (const count of [1, 2]) {
      try {
        const out = check.global.t(key, named, count)
        if (out === key || /[{}]/.test(out.replace(/<\w+>/g, ''))) errors.push(`${key}: ${out}`)
      } catch (e) {
        errors.push(`${key}: ${source} (${String(e)})`)
      }
    }
  }
  expect(errors).toEqual([])
})
