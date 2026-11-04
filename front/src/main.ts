import { createPinia } from 'pinia'
import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import 'vue-sonner/style.css'
import './style.css'
import { initTheme } from './lib/theme'

initTheme()

createApp(App).use(createPinia()).use(router).mount('#app')
