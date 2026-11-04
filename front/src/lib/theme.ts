import { ref } from 'vue'

export type Theme = 'light' | 'dark'
const KEY = 'theme'

function stored(): Theme | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export const theme = ref<Theme>('light')

function apply(t: Theme) {
  theme.value = t
  document.documentElement.classList.toggle('dark', t === 'dark')
}

/** Call once before mounting so the first paint already has the right colors. */
export function initTheme() {
  apply(stored() ?? systemTheme())
}

export function setTheme(t: Theme) {
  apply(t)
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // The choice just won't be remembered in this browser.
  }
}

export const toggleTheme = () => setTheme(theme.value === 'dark' ? 'light' : 'dark')
