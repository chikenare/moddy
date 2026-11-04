# SaaS y panel completo: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Convertir el bot en un servicio multi-inquilino con login de Telegram, planes, métricas, mensajes recurrentes y un panel completo.

**Architecture:** Mismo proceso (grammY, Hono, SQLite) y panel Vue. La API exige sesión salvo salud y login; cada chat se autoriza contra `chat_admins`. Las métricas son contadores diarios acumulados en memoria y volcados a SQLite.

**Tech Stack:** Node 24, TypeScript, grammY, Hono, better-sqlite3, zod, Vitest, croner. Panel: Vue 3, Pinia, Vue Router, shadcn-vue, Tailwind 4, Tiptap.

**Spec:** `docs/superpowers/specs/2026-11-04-saas-design.md`

## Global Constraints

- Textos visibles, errores de API y logs en inglés.
- Comandos del bot en contenedor: `docker compose run --rm --no-deps bot pnpm ...`. Panel: `docker compose exec -T bot-front sh -c '...'`; comprobación con `pnpm exec vue-tsc -b && pnpm exec vite build --outDir /tmp/front-dist`, nunca `pnpm build`. Dependencias del panel: `pnpm add` en el host dentro de `front/`, y luego `pnpm install --frozen-lockfile` en el contenedor. Dependencias del bot: dentro del contenedor con `--store-dir /pnpm/store`.
- Migraciones: agregar al final del array `MIGRATIONS`; el bot de desarrollo se recarga al guardar y la aplica al momento, así que el SQL debe estar definitivo antes de guardar. Nunca editar una migración ya guardada.
- La moderación se registra antes que los comandos y nunca bloquea la cola de updates: los envíos a Telegram desde handlers van en segundo plano.
- Formato de Telegram siempre como `text` + `entities`, nunca `parse_mode`. Usar `normalizeFormatted` en el servidor y `RichTextEditor`/`FormattedText` en el panel.
- Texto de usuarios siempre como texto plano en el panel: sin `v-html`.
- Límites: flood 2–50 mensajes y 1–3600 s; recurrentes con mínimo 5 minutos entre envíos.
- `git add` por nombre; `.env` nunca. No imprimir `.env` ni el token, ni líneas de log que lo contengan.

## Review Focus

1. Un usuario pide datos de un chat ajeno por cualquier ruta, incluida `GET /api/chats/:id` sin sub-ruta y la foto (Tarea 4, prueba que recorre todas las rutas).
2. Un admin degradado en Telegram intenta escribir (Tarea 4).
3. Una víctima abre un enlace de login de un atacante y no confirma (Tarea 3).
4. Un mensaje recurrente al reiniciar el bot: ni duplicado ni avalancha de ejecuciones atrasadas (Tarea 1).
5. Cambio de horario de verano en una zona horaria con recurrentes (Tarea 1).

---

### Task 1: Mensajes recurrentes y formato en mensajes y reglas

**Files:**
- Create: `src/messages/recurrence.ts`, `src/messages/recurrence.test.ts`, `src/db/recurring.ts`, `src/db/recurring.test.ts`
- Modify: `src/db/connection.ts`, `src/db/messages.ts`, `src/db/chats.ts`, `src/messages/scheduler.ts`, `src/api/app.ts`, `src/community/rules.ts`, `front/src/lib/api.ts`, `front/src/stores/messages.ts`, `front/src/views/MessagesView.vue`, `front/src/components/RulesPanel.vue`, sus pruebas

**Interfaces:**
- Migración:
```sql
ALTER TABLE scheduled_messages ADD COLUMN entities TEXT NOT NULL DEFAULT '[]';
ALTER TABLE chats ADD COLUMN rules_entities TEXT NOT NULL DEFAULT '[]';
CREATE TABLE recurring_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, entities TEXT NOT NULL DEFAULT '[]',
  cron TEXT NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER, last_run_at INTEGER, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE recurring_message_targets (
  recurring_id INTEGER NOT NULL REFERENCES recurring_messages(id) ON DELETE CASCADE,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
  PRIMARY KEY (recurring_id, chat_id)
) STRICT;
ALTER TABLE scheduled_messages ADD COLUMN recurring_id INTEGER REFERENCES recurring_messages(id) ON DELETE SET NULL;
```
- `recurrence.ts`, con `croner`: `nextRun(cron: string, timezone: string, after: number): number | null`; `validateRecurrence(cron, timezone, now): { error: string } | { nextRuns: number[] }` (5 campos, zona válida, próximas 5 ejecuciones, mínimo 5 minutos entre cada par).
- `recurring.ts`: `createRecurring`, `getRecurring`, `listRecurring`, `updateRecurring`, `setRecurringEnabled`, `deleteRecurring`, `dueRecurring(db, now)`.
- API: `GET`/`POST /api/recurring`, `GET /api/recurring/preview?cron=&timezone=` → `{ nextRuns }`, `PUT`/`DELETE /api/recurring/:id`, `POST /api/recurring/:id/pause` y `/resume`. `POST /api/messages` y `PATCH /api/chats/:id` (`rules`, `rulesEntities`) aceptan formato. Errores de cron legibles.

- [ ] **Step 1: Pruebas que fallan.** `recurrence`: cron diario a las 09:00 en `America/Mexico_City` da esa hora local; cruce de horario de verano en `America/New_York` conserva la hora local; rechaza cron inválido, zona inválida, 6 campos y `* * * * *`; acepta `*/5 * * * *`. Scheduler: al vencer una regla crea un mensaje con sus chats y avanza `next_run_at`, en una sola transacción; con el bot parado 5 ejecuciones produce como máximo un mensaje, y ninguno si la última lleva más de 1 hora de retraso; una regla pausada no corre; una regla sin chats se desactiva; dos ticks seguidos no duplican. API: casos de error, pausa y reanudación recalculan `next_run_at`; borrar la regla conserva el historial.
- [ ] **Step 2: Implementar.** Materializar las reglas vencidas al inicio de cada tick del scheduler. Enviar `entities` en mensajes y `/rules`.
- [ ] **Step 3: Panel.** En Messages, modos "Send now", "Later" y "Repeat". Repeat ofrece: every day, specific weekdays, day of month, every N hours (N ≥ 1), custom cron; hora; muestra las 3 próximas ejecuciones desde `preview`. Lista "Recurring" con siguiente envío, pausar, reanudar, editar, borrar. Usar `RichTextEditor` en mensajes y reglas, y `FormattedText` al mostrarlos.
- [ ] **Step 4: Verificar** con pruebas, tipos, build y Playwright sobre chats falsos.
- [ ] **Step 5: Commit.**

---

### Task 2: Fotos de grupos e interfaz con navegación lateral

**Files:**
- Create: `src/api/photos.ts`, `src/api/photos.test.ts`, `front/src/components/ChatAvatar.vue`, `front/src/components/AppLayout.vue`
- Modify: `src/api/app.ts`, `src/index.ts`, `front/src/App.vue`, `front/src/views/ChatsView.vue`, `front/src/views/ChatDetailView.vue`, `front/src/views/MessagesView.vue`

**Interfaces:** `createPhotoFetcher(deps: { api: Pick<Api, "getChat" | "getFile">; token: string; fetch?: typeof fetch; now?: () => number }): (chatId: number) => Promise<Uint8Array | null>`, con caché de 1 hora incluidos los resultados sin foto. `GET /api/chats/:id/photo` → `image/jpeg` con `Cache-Control: private, max-age=3600`, o 404.

- [ ] **Step 1: Pruebas que fallan.** Devuelve bytes y usa caché; sin foto devuelve `null` y lo cachea; un fallo de Telegram devuelve `null` y **ni el valor devuelto ni los logs contienen el token** (espiar `console.error`).
- [ ] **Step 2: Implementar** la API. Registrar solo el mensaje del error, nunca la URL.
- [ ] **Step 3: Panel.** Barra lateral (componente `sidebar` de shadcn-vue, colapsable en móvil) con Overview, Groups, Messages. Avatar con foto o iniciales sobre color estable por id, en lista, detalle y selector de mensajes. Tarjetas de grupo con estado y filtros activos como etiquetas. Modo oscuro con selector. Mantener el aviso de desarrollo. Overview es por ahora la lista de grupos; la Tarea 6 agrega las métricas.
- [ ] **Step 4: Verificar** con Playwright en claro, oscuro y 375 px, sin desbordes ni errores de consola; revisar capturas.
- [ ] **Step 5: Commit.**

---

### Task 3: Login con Telegram y sesiones

**Files:**
- Create: `src/auth/sessions.ts`, `src/auth/sessions.test.ts`, `src/auth/bot.ts`, `src/auth/bot.test.ts`, `src/api/auth.ts`, `src/api/auth.test.ts`, `src/db/users.ts`, `front/src/views/LoginView.vue`, `front/src/stores/auth.ts`
- Modify: `src/db/connection.ts`, `src/config.ts`, `src/env.ts`, `.env.example`, `src/api/app.ts`, `src/api/guard.ts`, `src/index.ts`, `front/src/router.ts`, `front/src/lib/api.ts`, `front/src/components/AppLayout.vue`

**Interfaces:**
- Migración:
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, username TEXT,
  plan_id TEXT NOT NULL DEFAULT 'free', plan_expires_at INTEGER, suspended INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
) STRICT;
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
CREATE TABLE login_tokens (token_hash TEXT PRIMARY KEY, status TEXT NOT NULL, user_id INTEGER, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL) STRICT;
```
- `config.adminIds` desde `ADMIN_IDS`; `config.panelHosts` desde `PANEL_HOSTS` (coma), sumados a los hosts permitidos del guard.
- Endpoints: `POST /api/auth/start` → `{ token, url, expiresAt }` (5 minutos, 20 por minuto por IP); `POST /api/auth/poll { token }` → 202 pendiente, 200 con cookie `session` y un solo uso, 410 caducado o rechazado; `POST /api/auth/logout`; `GET /api/me` → `{ id, name, username, isAdmin, planId }` o 401. Salud y `auth/*` son las únicas rutas públicas.
- Bot, solo en privado: `/start login_<token>` responde con el nombre de la cuenta y botones Confirm y Cancel (`callback_query` en `allowed_updates`, handler antes de los comandos). `/start` normal sigue igual.

- [ ] **Step 1: Pruebas que fallan.** Token aleatorio de 32 bytes y guardado con hash; poll antes de confirmar da 202; **abrir el enlace sin pulsar Confirm no da sesión**; Cancel da 410; token de un solo uso; caducado da 410; cookie con `HttpOnly`, `SameSite=Lax`, y `Secure` solo en producción; sesión caducada o de usuario suspendido da 401/403; logout borra la sesión; sin cookie, una ruta protegida da 401; el token de login no aparece en logs; límite de `auth/start` da 429; `/start login_` en un grupo se ignora.
- [ ] **Step 2: Implementar.** Autenticación como middleware global en `/api/*` con lista blanca explícita. La autorización por chat llega en la Tarea 4; mientras tanto, solo `ADMIN_IDS` accede a los chats, para no dejar ventana abierta.
- [ ] **Step 3: Panel.** `LoginView` con botón que abre el enlace, código QR opcional no, y sondeo cada 2 s hasta 5 minutos. Guarda de rutas, página de sesión expirada, menú de usuario con logout. Los 401 redirigen al login.
- [ ] **Step 4: Verificar.** Las pruebas de Playwright sembrarán una sesión en la base de desarrollo y pondrán la cookie. Documentar en el informe el flujo que debe probar el dueño con su cuenta.
- [ ] **Step 5: Commit.**

---

### Task 4: Multi-inquilino

**Files:**
- Create: `src/auth/access.ts`, `src/auth/access.test.ts`, `src/db/chat-admins.ts`, `src/db/chat-admins.test.ts`, `src/moderation/admins-sync.ts`, `src/api/tenancy.test.ts`
- Modify: `src/db/connection.ts`, `src/api/app.ts`, `src/moderation/registration.ts`, `src/index.ts`, `src/db/messages.ts`, `src/db/recurring.ts`, `front/src/views/ChatsView.vue`

**Interfaces:**
- Migración: `chat_admins (chat_id REFERENCES chats ON UPDATE CASCADE ON DELETE CASCADE, user_id, can_manage INTEGER NOT NULL, updated_at, PRIMARY KEY (chat_id, user_id))`; `ALTER TABLE scheduled_messages ADD COLUMN created_by INTEGER`; igual en `recurring_messages`; `ALTER TABLE chats ADD COLUMN owner_user_id INTEGER`.
- `syncChatAdmins(api, db, chatId)` con `getChatAdministrators`; `can_manage` para `creator` o admin con `can_restrict_members`, excluyendo bots. Se ejecuta al registrar, en `my_chat_member`, cada hora para chats activos, y en `chat_member` para el usuario afectado (agregar a `allowed_updates`).
- `listChatsForUser`, `canReadChat(db, user, chatId)` (tabla), `canWriteChat(api, db, user, chatId)` (en vivo, caché de 60 s; un fallo de Telegram deniega). Los administradores de plataforma pasan siempre, y su lista de chats es la completa.

- [ ] **Step 1: Pruebas que fallan.** Prueba que **recorre `app.routes`** y falla si una ruta bajo `/api` no está en una lista explícita de públicas ni exige autorización. Tabla con todas las rutas de chat, incluida `/api/chats/:id` sin sub-ruta y la foto: usuario ajeno da 404 en lectura y escritura. `GET /api/chats` lista solo los propios. Mensajes y recurrentes: solo los creados por el usuario; destinos ajenos se rechazan; cancelar o editar los ajenos da 404. Admin degradado: la lectura de caché sigue hasta sincronizar, la escritura se rechaza tras los 60 s. Sync: creator y admin con ban sí, admin sin ban no, bot no; quien deja de ser admin pierde la fila. Filas sin `created_by` solo las ve un admin de plataforma.
- [ ] **Step 2: Implementar** quitando el acceso provisional de la Tarea 3.
- [ ] **Step 3: Panel.** Estado vacío para usuarios nuevos que explica agregar el bot como admin. Selector de Messages solo con sus chats.
- [ ] **Step 4: Verificar** con dos sesiones sembradas y chats falsos en Playwright: cada usuario ve solo lo suyo, y una petición directa a un chat ajeno da 404.
- [ ] **Step 5: Commit.**

---

### Task 5: Planes, cuenta y administración de plataforma

**Files:**
- Create: `src/db/plans.ts`, `src/db/plans.test.ts`, `src/plans/limits.ts`, `src/plans/limits.test.ts`, `src/api/admin.ts`, `src/api/admin.test.ts`, `front/src/views/AccountView.vue`, `front/src/views/admin/UsersView.vue`, `front/src/views/admin/PlansView.vue`, `front/src/views/admin/SettingsView.vue`, `front/src/stores/admin.ts`
- Modify: `src/db/connection.ts`, `src/api/app.ts`, `src/index.ts`, `front/src/router.ts`, `front/src/components/AppLayout.vue`, `front/src/views/LoginView.vue`

**Interfaces:**
- Migración: `plans (id TEXT PRIMARY KEY, name TEXT NOT NULL, max_chats INTEGER, max_auto_replies INTEGER, max_recurring INTEGER, monthly_messages INTEGER, price_label TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1)` con los valores iniciales del spec (`NULL` es sin límite); `platform_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)` para `upgrade_url`, `terms`, `privacy`.
- `effectivePlan(db, user)`; `usageFor(db, userId)`; comprobaciones que devuelven 403 con `{ error, code: "PLAN_LIMIT" }`: encender moderación o auto replies, crear auto reply, crear recurrente, enviar mensajes (destinos del mes natural). Al encender un chat sin dueño o con dueño que ya no es admin, quien enciende pasa a ser su dueño. Los administradores de plataforma no tienen límites.
- `GET /api/account` → plan, uso y límites. `GET /api/plans` público (para precios). `/api/admin/*` solo `ADMIN_IDS`, 403 para el resto: usuarios con búsqueda y paginación, asignar plan y vencimiento, suspender y reactivar, CRUD de planes, ajustes.
- Trabajo diario: planes vencidos pasan a Free; apagar los chats sobre el límite, los más nuevos primero. Suspender apaga sus chats y borra sus sesiones.

- [ ] **Step 1: Pruebas que fallan.** Cada límite, en el borde exacto; apagar y encender no cuenta doble; cambiar de dueño; `NULL` sin límite; mes natural; vencimiento y apagado en el orden correcto, sin borrar configuración; suspensión; un usuario normal recibe 403 en cada ruta `/api/admin/*`; un plan en uso no se puede borrar; `free` tampoco.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Panel.** Cuenta con plan, barras de uso, vencimiento y botón de mejora con `upgrade_url`. Error `PLAN_LIMIT` visible con ese enlace. Sección Admin en la barra lateral solo para administradores. Login con los planes y precios públicos, y enlaces a términos y privacidad.
- [ ] **Step 4: Verificar** con Playwright.
- [ ] **Step 5: Commit.**

---

### Task 6: Métricas

**Files:**
- Create: `src/metrics/collector.ts`, `src/metrics/collector.test.ts`, `src/db/stats.ts`, `src/db/stats.test.ts`, `front/src/views/OverviewView.vue`, `front/src/views/admin/PlatformView.vue`, `front/src/components/charts/*`, `front/src/components/OverviewPanel.vue`
- Modify: `src/db/connection.ts`, `src/moderation/seen.ts`, `src/moderation/registration.ts`, `src/moderation/enforcer.ts`, `src/community/auto-replies.ts`, `src/messages/scheduler.ts`, `src/api/app.ts`, `src/api/admin.ts`, `src/index.ts`, `front/src/router.ts`, `front/src/views/ChatDetailView.vue`

**Interfaces:**
- Migración: `chat_daily_stats (chat_id REFERENCES chats ON UPDATE CASCADE ON DELETE CASCADE, day TEXT NOT NULL, messages, joins, leaves, deleted, banned, link_hits, word_hits, flood_hits, bot_hits, auto_replies, broadcasts, todas INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, day)) STRICT`.
- `StatsCollector`: `add(chatId, field, n = 1)`, vuelca cada 30 s y al cerrar; un fallo conserva los contadores. Día en UTC. Retención 400 días. Solo cuenta en chats con alguna función encendida.
- `GET /api/metrics?days=7|30|90&chatId=` limitado a los chats del usuario → totales, serie diaria, comparación con el período anterior, palabras y dominios más frecuentes, grupos con más actividad. `GET /api/admin/metrics?days=` → usuarios nuevos y activos, por plan, chats activos, mensajes, acciones y serie diaria.

- [ ] **Step 1: Pruebas que fallan.** Acumula y vuelca en lote, conserva al fallar, vuelca al cerrar; días sin datos aparecen en cero; la comparación es correcta; aislamiento: pedir un `chatId` ajeno da 404; en un chat apagado no cuenta; cada punto (mensaje, entrada, salida, borrado, ban simulado no cuenta como ban, filtro, auto reply, envío) incrementa lo suyo.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Panel.** **Cargar primero la skill `dataviz`.** Overview del usuario: tarjetas con variación, serie de actividad, acciones por filtro, palabras y dominios principales, grupos con más actividad, selector de período. Pestaña Overview en cada grupo. Panel de plataforma para administradores. Estados vacíos claros. Colores correctos en claro y oscuro.
- [ ] **Step 4: Verificar** con datos sembrados en chats falsos, capturas en claro, oscuro y 375 px.
- [ ] **Step 5: Commit.**

---

### Task 7: Despliegue público

**Files:**
- Modify: `compose.prod.yml`, `front/nginx.conf`, `.env.example`, `src/api/guard.ts`, `src/api/auth.ts`, `docs/superpowers/specs/2026-11-04-saas-design.md`

**Interfaces:** `PANEL_DOMAIN` en `.env`. `compose.prod.yml`: `bot-front` en la red externa `traefik` con router `Host(${PANEL_DOMAIN})`, `websecure`, `tls`, `certresolver=cloudflare`, como el proyecto hermano, sin puerto publicado; `bot` sin puertos ni labels. `PANEL_HOSTS` incluye el dominio. nginx: cabeceras `X-Frame-Options`, `Content-Security-Policy` con `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy`; reenvía `X-Forwarded-For`. La IP del límite de login se toma de ahí solo detrás del proxy.

- [ ] **Step 1: Pruebas que fallan.** Host fuera de la lista da 403; dominio de `PANEL_HOSTS` se acepta; IP del límite correcta con y sin cabecera.
- [ ] **Step 2: Implementar.**
- [ ] **Step 3: Verificar** con un proyecto temporal `-p telegram-bot-prodtest` y un archivo de override en el scratchpad, sin Traefik real: imagen construye, migraciones completas sobre base vacía, cookie `Secure` en producción, cabeceras presentes, el bot arranca y se apaga con código 0. `down -v` solo con ese `-p`. Volver a levantar desarrollo.
- [ ] **Step 4: Commit.**
