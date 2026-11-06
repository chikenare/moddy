import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { setUnauthorizedHandler } from './lib/api'
import { router } from './router'
import 'vue-sonner/style.css'
import './style.css'
import { initTheme } from './lib/theme'
import { i18n } from './i18n'

initTheme()

const app = createApp(App).use(createPinia()).use(i18n).use(router)

// A session can end at any time: expired, logged out elsewhere, or the password changed.
// A full reload also drops everything the stores hold in memory.
setUnauthorizedHandler(() => {
  const current = router.currentRoute.value
  if (!current.meta.public) window.location.assign(router.resolve({ path: '/login', query: { next: current.fullPath, expired: '1' } }).href)
})

// Wait for the first route, so the side navigation never flashes before the login page.
void router.isReady().then(() => app.mount('#app'))
