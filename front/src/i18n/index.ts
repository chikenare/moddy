import { watch } from 'vue'
import { createI18n } from 'vue-i18n'
import en from './en'
import es from './es'

export type MessageSchema = typeof en

// Lets the editor suggest keys from en.ts. It doesn't reject unknown ones: index.test.ts does.
declare module 'vue-i18n' {
  export interface DefineLocaleMessage extends MessageSchema {}
}

// To add a language: write its file with the same keys as en.ts and add it here.
export const LOCALES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
] as const
export type Locale = (typeof LOCALES)[number]['code']

const DEFAULT: Locale = 'en'
const KEY = 'locale'

const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.code === v)

/** The saved choice wins; otherwise the first browser language we have, matched by its base (es-MX is es). */
export function detectLocale(saved: string | null, languages: readonly string[]): Locale {
  if (isLocale(saved)) return saved
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT
}

function saved(): string | null {
  // Tests run without a page.
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function browserLanguages(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : [navigator.language]
  } catch {
    return []
  }
}

export const i18n = createI18n<[MessageSchema], Locale, false>({
  legacy: false,
  locale: detectLocale(saved(), browserLanguages()),
  fallbackLocale: DEFAULT,
  messages: { en, es },
})

export const t = i18n.global.t

if (typeof document !== 'undefined') {
  watch(i18n.global.locale, (l) => { document.documentElement.lang = l }, { immediate: true })
}

export function setLocale(l: Locale) {
  i18n.global.locale.value = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // The choice just won't be remembered in this browser.
  }
}
