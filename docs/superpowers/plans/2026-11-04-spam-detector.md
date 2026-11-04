# Detector de spam y panel: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moderar los grupos del dueño (enlaces, palabras, flood, bots) con configuración por grupo editable desde un panel web, y quitar la suscripción basada en `playhubplus-api`.

**Architecture:** La API (Hono) y la moderación (middleware de grammY) corren en el mismo proceso y comparten una conexión síncrona a SQLite. La detección es síncrona y las acciones contra Telegram van a una cola por chat que nunca bloquea los updates. El panel (Vue) es un paquete aparte que llega a la API por proxy.

**Tech Stack:** Node 24 Alpine, TypeScript, grammY, better-sqlite3, Hono, zod, Vitest. Panel: Vue 3, Vite, Pinia, Vue Router, shadcn-vue, Tailwind 4. Docker Compose y Traefik 3.

**Spec:** `docs/superpowers/specs/2026-11-04-spam-detector-design.md`

## Global Constraints

- Todo comando del bot corre en contenedor: `docker compose run --rm bot pnpm ...`. El `node_modules` del host es de root y el binario nativo es de Alpine.
- `APP_ENV` es obligatorio: `development` o `production`. Sin él, el bot no arranca.
- Chat nuevo: `moderationEnabled = false`. Filtros activos con acción `delete_ban`. Flood: 5 mensajes en 10 s; límites 2–50 mensajes, 1–3600 s.
- Historial: 90 días, texto truncado a 1000 caracteres; los bans reales vigentes se conservan sin texto.
- Nunca banear sin confirmar antes que el remitente no es admin (en `production`).
- Desbanear siempre con `only_if_banned: true`. Ban sin `until_date`.
- La moderación se registra antes que cualquier otro handler y nunca bloquea la cola de updates.
- Panel: desarrollo en `http://bot.localhost`, solo HTTP por Traefik. Producción en `127.0.0.1:8088`. La API no publica puertos.
- Hosts aceptados por la API: `bot.localhost`, `localhost`, `127.0.0.1`, `[::1]`, en cualquier puerto.
- Sin `v-html` y sin enlaces clicables para el texto del spam.
- Textos visibles en español. Código sin la marca PlayHub ni referencias a `playhubplus-api`. Ese proyecto no se modifica.
- Nombres: proyecto `telegram-bot`, servicios `bot` y `bot-front`.
- `git add` siempre por nombre de archivo; `.env` nunca se agrega. Cada commit termina con las líneas de atribución que indique la sesión.

## Review Focus

Cada línea tiene su prueba en la tarea indicada.

1. Un enlace después de un emoji: los offsets de Telegram son UTF-16 y debe extraerse la URL exacta (Tarea 4).
2. Telegram rechaza el ban porque faltan permisos o el usuario ya salió: el evento guarda el error y los mensajes siguientes de ese chat se siguen procesando (Tarea 6).
3. Llega un mensaje del supergrupo nuevo antes del aviso de migración: la fila creada por ese mensaje no debe impedir migrar ni hacer perder la configuración (Tarea 2).
4. El dueño agrega una palabra duplicada o una entrada inválida en el panel: la duplicada no falla y la inválida da un error legible (Tarea 9).
5. Se agrega al grupo nuestro propio bot, o una persona: el filtro de bots no debe banear a ninguno de los dos (Tarea 8).

## Estructura de archivos

```
src/env.ts                     parseAppEnv
src/config.ts                  (modificar) appEnv, apiPort, databasePath
src/db/connection.ts           openDatabase y migraciones
src/db/chats.ts                chats y su configuración
src/db/lists.ts                palabras y lista blanca
src/db/events.ts               historial y purga
src/moderation/normalize.ts    normalizeText
src/moderation/words.ts        normalizeWord, findBannedWord
src/moderation/default-words.ts DEFAULT_WORDS
src/moderation/links.ts        extractLinks, normalizeWhitelistEntry, findUnauthorizedLink
src/moderation/flood.ts        fingerprintOf, FloodTracker
src/moderation/sender.ts       senderOf, isStructurallyExempt
src/moderation/enforcer.ts     cola por chat y acciones
src/moderation/registration.ts registro de chats
src/moderation/handler.ts      middleware de moderación
src/api/guard.ts               validación de Host y Origin
src/api/app.ts                 rutas
src/test/harness.ts            bot de prueba sin red
src/test/updates.ts            constructores de updates
front/                         panel
```

---

### Task 0: Quitar la suscripción basada en playhubplus-api

**Files:**
- Delete: `src/handlers/plans.ts`, `src/handlers/payments.ts`, `src/services/plans.ts`, `src/services/orders.ts`, `src/utils/format.ts`
- Modify: `src/index.ts`, `src/config.ts`, `.env.example`

**Interfaces:**
- Produces: `config.botToken` como único valor de `config`.

- [ ] **Step 1: Borrar los cinco archivos**

Run: `git rm src/handlers/plans.ts src/handlers/payments.ts src/services/plans.ts src/services/orders.ts src/utils/format.ts`

- [ ] **Step 2: Reducir `src/index.ts`**

Quitar los imports y los `bot.use` de `plansHandler` y `paymentsHandler`. Textos exactos:

- `/start`: `` `¡Hola, ${ctx.from?.first_name ?? ""}! 👋 Soy un bot de moderación de grupos.` ``
- `/help`: `"Comandos disponibles:\n/help - Esta ayuda"`
- `setMyCommands`: solo `{ command: "help", description: "Ver ayuda" }`

- [ ] **Step 3: Reducir la configuración**

`src/config.ts`: dejar `required` y `botToken`. `.env.example`: dejar solo `BOT_TOKEN=tu_token_de_botfather`.

- [ ] **Step 4: Verificar**

```bash
grep -rnIiE 'play ?hub|public-plans|planes|stars|apiBaseUrl' src .env.example || echo LIMPIO
docker compose run --rm bot pnpm typecheck
docker compose down
```
Expected: `LIMPIO` y sin errores de tipos.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/config.ts .env.example
git commit -m "refactor: quitar la suscripción basada en playhubplus-api"
```

---

### Task 1: Base del proyecto, configuración y base de datos

**Files:**
- Modify: `package.json`, `tsconfig.json`, `src/config.ts`, `compose.yml`, `compose.prod.yml`, `Dockerfile`, `.gitignore`, `.dockerignore`, `.env.example`, `.env` (solo agregar `APP_ENV`)
- Create: `tsconfig.check.json`, `vitest.config.ts`, `src/env.ts`, `src/db/connection.ts`
- Test: `src/env.test.ts`, `src/db/connection.test.ts`

**Interfaces:**
- Produces: `type AppEnv = "development" | "production"`; `parseAppEnv(value: string | undefined): AppEnv`; `type Db = Database.Database`; `openDatabase(path: string): Db`; `config.appEnv`, `config.apiPort`, `config.databasePath`.

Los pasos 1 y 2 (detener el stack y commit base) ya se hicieron al preparar la rama; el bot sigue detenido hasta la Tarea 8.

- [ ] **Step 3: Infraestructura**

- `compose.yml`: agregar `name: telegram-bot`; en `bot`, volumen `data:/app/data`; agregar red por defecto externa:
  ```yaml
  networks:
    default:
      name: traefik
      external: true
  volumes:
    node_modules:
    data:
  ```
- `compose.prod.yml`: `name: telegram-bot`, volumen `data:/app/data` en `bot`.
- `Dockerfile`, etapa `prod`: antes de `USER node`, `RUN mkdir -p /app/data && chown node:node /app/data`.
- `.gitignore`: agregar `data/`. `.dockerignore`: agregar `front`, `data`, `docs`.
- `.env.example`: agregar `APP_ENV=development`, `API_PORT=3000`, `# DATABASE_PATH=./data/development.sqlite`.
- `.env`: `grep -q '^APP_ENV=' .env || printf '\nAPP_ENV=development\n' >> .env`.

- [ ] **Step 4: Instalar dependencias y fijar scripts**

```bash
docker compose build bot
docker compose run --rm -e HOST_ID="$(id -u):$(id -g)" bot sh -c 'pnpm add better-sqlite3 hono @hono/node-server zod && pnpm add -D vitest @types/better-sqlite3 && chown "$HOST_ID" package.json pnpm-lock.yaml pnpm-workspace.yaml'
docker compose run --rm bot node -e "const D=require('better-sqlite3');console.log(new D(':memory:').prepare('select 1 a').get())"
```
Expected: imprime `{ a: 1 }`. Si pnpm bloqueó el build, agregar `better-sqlite3: true` bajo `allowBuilds` en `pnpm-workspace.yaml` y repetir.

- `package.json`: `"test": "vitest run"`, `"typecheck": "tsc -p tsconfig.check.json"`.
- `tsconfig.json`: `"exclude": ["src/**/*.test.ts", "src/test/**"]`.
- `tsconfig.check.json`: extiende `tsconfig.json`, con `"noEmit": true` y `"exclude": []`.
- `vitest.config.ts`: `test: { include: ["src/**/*.test.ts"] }`.

- [ ] **Step 5: Escribir las pruebas que fallan**

```ts
// src/env.test.ts
test("acepta los dos entornos", () => {
  expect(parseAppEnv("development")).toBe("development");
  expect(parseAppEnv("production")).toBe("production");
});
test.each([undefined, "", "staging", "PRODUCTION"])("rechaza %s", (v) => {
  expect(() => parseAppEnv(v)).toThrow(/APP_ENV/);
});

// src/db/connection.test.ts
test("activa claves foráneas y crea las tablas", () => {
  const db = openDatabase(":memory:");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all();
  expect(names).toEqual(expect.arrayContaining(["chats", "chat_words", "chat_whitelist", "moderation_events"]));
});
test("en archivo usa WAL, crea la carpeta y reabrir no repite migraciones", () => {
  const path = join(mkdtempSync(join(tmpdir(), "db-")), "sub", "a.sqlite");
  openDatabase(path).close();
  const db = openDatabase(path);
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(db.pragma("user_version", { simple: true })).toBe(1);
});
```

- [ ] **Step 6: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/env.test.ts src/db/connection.test.ts`
Expected: FAIL, módulos no encontrados.

- [ ] **Step 7: Implementar**

`src/env.ts` sin efectos secundarios. `config.ts`: `appEnv: parseAppEnv(process.env.APP_ENV)`, `apiPort: Number(process.env.API_PORT ?? 3000)`, `databasePath: process.env.DATABASE_PATH ?? ./data/<appEnv>.sqlite`.

`openDatabase` crea la carpeta padre salvo en `:memory:`, activa WAL y `foreign_keys`, y aplica migraciones por `user_version` dentro de una transacción. Migración 1:

```sql
CREATE TABLE chats (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, username TEXT,
  bot_status TEXT NOT NULL DEFAULT 'unknown',
  can_delete INTEGER NOT NULL DEFAULT 0, can_restrict INTEGER NOT NULL DEFAULT 0,
  linked_chat_id INTEGER,
  moderation_enabled INTEGER NOT NULL DEFAULT 0,
  link_filter_enabled INTEGER NOT NULL DEFAULT 1, link_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
  word_filter_enabled INTEGER NOT NULL DEFAULT 1, word_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
  flood_filter_enabled INTEGER NOT NULL DEFAULT 1, flood_filter_action TEXT NOT NULL DEFAULT 'delete_ban',
  flood_count INTEGER NOT NULL DEFAULT 5, flood_seconds INTEGER NOT NULL DEFAULT 10,
  bot_filter_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE chat_words (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
  word TEXT NOT NULL, PRIMARY KEY (chat_id, word)
) STRICT;
CREATE TABLE chat_whitelist (
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
  entry TEXT NOT NULL, PRIMARY KEY (chat_id, entry)
) STRICT;
CREATE TABLE moderation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON UPDATE CASCADE ON DELETE CASCADE,
  sender_type TEXT NOT NULL, sender_id INTEGER NOT NULL, sender_name TEXT NOT NULL,
  filter TEXT NOT NULL, matched TEXT NOT NULL, text TEXT, action TEXT NOT NULL,
  delete_ok INTEGER, ban_ok INTEGER, error TEXT,
  dry_run INTEGER NOT NULL, unbanned_at INTEGER, created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX moderation_events_chat ON moderation_events(chat_id, id DESC);
```

- [ ] **Step 8: Verificar**

Run: `docker compose run --rm bot pnpm test && docker compose run --rm bot pnpm typecheck`
Expected: PASS y sin errores de tipos.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.check.json vitest.config.ts compose.yml compose.prod.yml Dockerfile .gitignore .dockerignore .env.example src/env.ts src/env.test.ts src/config.ts src/db/connection.ts src/db/connection.test.ts
git commit -m "feat: base de datos SQLite y APP_ENV obligatorio"
```

---

### Task 2: Capa de datos

**Files:**
- Create: `src/db/chats.ts`, `src/db/lists.ts`, `src/db/events.ts`
- Test: `src/db/chats.test.ts`, `src/db/lists.test.ts`, `src/db/events.test.ts`

**Interfaces:**
- Consumes: `Db`, `openDatabase`.
- Produces:
```ts
// chats.ts
export type ChatType = "group" | "supergroup" | "channel";
export type FilterAction = "delete" | "delete_ban";
export interface ChatRecord {
  id: number; type: ChatType; title: string; username: string | null;
  botStatus: string; canDelete: boolean; canRestrict: boolean; linkedChatId: number | null;
  moderationEnabled: boolean;
  linkFilterEnabled: boolean; linkFilterAction: FilterAction;
  wordFilterEnabled: boolean; wordFilterAction: FilterAction;
  floodFilterEnabled: boolean; floodFilterAction: FilterAction;
  floodCount: number; floodSeconds: number;
  botFilterEnabled: boolean;
  createdAt: number; updatedAt: number; // unix, segundos
}
export type ChatSettings = Pick<ChatRecord, "moderationEnabled" | "linkFilterEnabled" | "linkFilterAction" | "wordFilterEnabled" | "wordFilterAction" | "floodFilterEnabled" | "floodFilterAction" | "floodCount" | "floodSeconds" | "botFilterEnabled">;
export type ChatInfo = Partial<Pick<ChatRecord, "title" | "username" | "botStatus" | "canDelete" | "canRestrict" | "linkedChatId" | "type">>;
export function getChat(db: Db, id: number): ChatRecord | undefined;
export function listChats(db: Db): ChatRecord[];
export function insertChat(db: Db, input: { id: number; type: ChatType; title: string; username: string | null }, seedWords: string[]): ChatRecord;
export function updateChatInfo(db: Db, id: number, info: ChatInfo): void;
export function updateChatSettings(db: Db, id: number, patch: Partial<ChatSettings>): ChatRecord | undefined;
export function migrateChatId(db: Db, fromId: number, toId: number): void;
export function deleteChat(db: Db, id: number): void;

// lists.ts
export function listWords(db: Db, chatId: number): string[];
export function addWord(db: Db, chatId: number, word: string): void;      // idempotente
export function removeWord(db: Db, chatId: number, word: string): boolean;
export function listWhitelist(db: Db, chatId: number): string[];
export function addWhitelistEntry(db: Db, chatId: number, entry: string): void; // idempotente
export function removeWhitelistEntry(db: Db, chatId: number, entry: string): boolean;

// events.ts
export type FilterName = "link" | "word" | "flood" | "bot";
export type SenderType = "user" | "chat";
export interface EventRecord {
  id: number; chatId: number; senderType: SenderType; senderId: number; senderName: string;
  filter: FilterName; matched: string; text: string | null; action: FilterAction;
  deleteOk: boolean | null; banOk: boolean | null; error: string | null;
  dryRun: boolean; unbannedAt: number | null; createdAt: number;
}
export type NewEvent = Omit<EventRecord, "id" | "unbannedAt" | "createdAt">;
export function insertEvent(db: Db, event: NewEvent, now?: number): EventRecord;
export function getEvent(db: Db, chatId: number, id: number): EventRecord | undefined;
export function listEvents(db: Db, chatId: number, opts: { limit: number; before?: number }): EventRecord[];
export function isActiveBan(event: EventRecord): boolean;
export function markUnbanned(db: Db, chatId: number, senderType: SenderType, senderId: number, at: number): void;
export function purgeEvents(db: Db, now: number): number;
```

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
// chats.test.ts
test("un chat nuevo llega apagado, con filtros activos y semillas propias", () => {
  const c = insertChat(db, chatA, ["hola"]);
  expect(c).toMatchObject({ moderationEnabled: false, linkFilterEnabled: true, linkFilterAction: "delete_ban", floodCount: 5, floodSeconds: 10, botFilterEnabled: true });
  insertChat(db, chatB, ["hola"]);
  removeWord(db, chatA.id, "hola");
  expect(listWords(db, chatB.id)).toEqual(["hola"]);
});
test("updateChatSettings es parcial y devuelve undefined si no existe", () => { /* patch floodCount: 9; title intacto; id 1 → undefined */ });
test("migrateChatId conserva configuración, palabras, lista blanca y eventos", () => { /* afterwards getChat(from) undefined; getChat(to).moderationEnabled true */ });
test("migrateChatId reemplaza la fila recién creada del destino", () => {
  insertChat(db, { ...chatA, id: -1 }, ["vieja"]);
  updateChatSettings(db, -1, { moderationEnabled: true });
  insertChat(db, { ...chatA, id: -1001 }, ["nueva"]);
  migrateChatId(db, -1, -1001);
  expect(getChat(db, -1001)?.moderationEnabled).toBe(true);
  expect(listWords(db, -1001)).toEqual(["vieja"]);
});
test("migrateChatId no hace nada si el origen no existe", () => { /* el destino sigue igual */ });
test("deleteChat borra en cascada", () => { /* words, whitelist y events vacíos */ });

// lists.test.ts
test("addWord y addWhitelistEntry son idempotentes; remove indica si existía", () => {});

// events.test.ts
test("trunca el texto a 1000 caracteres", () => {
  expect(insertEvent(db, ev({ text: "x".repeat(1500) })).text).toHaveLength(1000);
});
test("listEvents pagina del más nuevo al más viejo", () => { /* limit 2, before */ });
test("markUnbanned marca todos los bans activos de ese remitente en ese chat", () => {});
test("purgeEvents conserva bans vigentes sin texto y elimina el resto de lo antiguo", () => {
  const now = 200 * DAY;
  // antiguos (now - 91 días): banVigente, simulado, deshecho, soloBorrado; reciente: banReciente
  expect(purgeEvents(db, now)).toBe(3);
  expect(getEvent(db, chat, banVigente.id)?.text).toBeNull();
  expect(getEvent(db, chat, simulado.id)).toBeUndefined();
  expect(getEvent(db, chat, deshecho.id)).toBeUndefined();
  expect(getEvent(db, chat, soloBorrado.id)).toBeUndefined();
  expect(getEvent(db, chat, banReciente.id)?.text).not.toBeNull();
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/db`
Expected: FAIL, módulos no encontrados.

- [ ] **Step 3: Implementar los tres módulos**

Un ban activo es `banOk === true && !dryRun && unbannedAt === null`. `migrateChatId` corre en transacción: si el origen no existe, retorna; si existe el destino, lo borra; luego actualiza el `id` y deja que la cascada haga el resto. Después de la purga, el texto de los bans vigentes queda en `NULL`.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/db`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/db
git commit -m "feat: capa de datos de chats, listas e historial"
```

---

### Task 3: Filtro de palabras

**Files:**
- Create: `src/moderation/normalize.ts`, `src/moderation/words.ts`, `src/moderation/default-words.ts`
- Test: `src/moderation/words.test.ts`

**Interfaces:**
- Produces: `normalizeText(raw: string): string`; `normalizeWord(raw: string): string | null`; `findBannedWord(text: string, words: string[]): string | undefined`; `DEFAULT_WORDS: readonly string[]`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each([
  ["mi computadora nueva", ["puta"], undefined],
  ["feliz año", ["ano"], undefined],
  ["un cono de helado", ["coño"], undefined],
  ["¡PUTAAAA!", ["puta"], "puta"],
  ["Vendo CÓDIGOS ya", ["codigos"], "codigos"],
  ["gana   dinero RÁPIDO hoy", ["gana dinero rapido"], "gana dinero rapido"],
  ["qué coño", ["coño"], "coño"],
])("findBannedWord(%s, %j)", (text, words, expected) => {
  expect(findBannedWord(text, words)).toBe(expected);
});
test("normalizeWord", () => {
  expect(normalizeWord("  Coño ")).toBe("coño");
  expect(normalizeWord("   ")).toBeNull();
  expect(normalizeWord("ab".repeat(51))).toBeNull();
});
test("la lista inicial ya está normalizada, sin duplicados ni términos ambiguos", () => {
  for (const w of DEFAULT_WORDS) expect(normalizeWord(w)).toBe(w);
  expect(new Set(DEFAULT_WORDS).size).toBe(DEFAULT_WORDS.length);
  expect(DEFAULT_WORDS).not.toContain("ano");
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/words.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`normalizeText`, en este orden, conserva la `ñ`:

```ts
raw.normalize("NFKC").toLowerCase()
  .normalize("NFD").replace(/ñ/g, "ñ").replace(/\p{M}/gu, "")
  .replace(/(\p{L})\1{2,}/gu, "$1")
  .replace(/\s+/g, " ").trim();
```

`findBannedWord` usa límites Unicode: `(?<![\p{L}\p{N}])<palabra escapada>(?![\p{L}\p{N}])` con la bandera `u`. `normalizeWord` devuelve `null` si queda vacía o supera 100 caracteres.

`DEFAULT_WORDS`: `hijo de puta`, `hijueputa`, `malparido`, `puta`, `mierda`, `pendejo`, `gilipollas`, `comemierda`, `gana dinero rapido`, `dinero facil`, `inversion garantizada`, `duplica tu dinero`, `criptomonedas gratis`.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/words.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/moderation/normalize.ts src/moderation/words.ts src/moderation/default-words.ts src/moderation/words.test.ts
git commit -m "feat: filtro de palabras por palabra completa"
```

---

### Task 4: Filtro de enlaces

**Files:**
- Create: `src/moderation/links.ts`
- Test: `src/moderation/links.test.ts`

**Interfaces:**
- Produces: `type LinkSource = Pick<Message, "text" | "caption" | "entities" | "caption_entities" | "reply_markup">`; `extractLinks(message: LinkSource): string[]`; `normalizeWhitelistEntry(raw: string): string | null`; `findUnauthorizedLink(links: string[], whitelist: string[]): string | undefined`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test("extrae url exacta aunque haya un emoji antes (offsets UTF-16)", () => {
  const text = "😀 mira https://spam.example/x fin";
  const offset = text.indexOf("https");
  expect(extractLinks({ text, entities: [{ type: "url", offset, length: 22 }] })).toEqual(["https://spam.example/x"]);
});
test("extrae text_link, caption y botones", () => {
  expect(extractLinks({ text: "clic", entities: [{ type: "text_link", offset: 0, length: 4, url: "https://oculto.example" }] })).toEqual(["https://oculto.example"]);
  expect(extractLinks({ caption: "a.example", caption_entities: [{ type: "url", offset: 0, length: 9 }] })).toEqual(["a.example"]);
  expect(extractLinks({ reply_markup: { inline_keyboard: [[{ text: "x", url: "https://b.example" }]] } })).toEqual(["https://b.example"]);
});
test("las menciones no son enlaces", () => {
  expect(extractLinks({ text: "@ana", entities: [{ type: "mention", offset: 0, length: 4 }] })).toEqual([]);
});
test.each([
  ["https://www.Example.com/", "example.com"],
  ["t.me/MiCanal/", "t.me/micanal"],
  ["example.com/a?x=1#y", "example.com/a"],
  ["", null], ["no es dominio", null], ["localhost", null], ["javascript:alert(1)", null],
])("normalizeWhitelistEntry(%s)", (raw, expected) => {
  expect(normalizeWhitelistEntry(raw)).toBe(expected);
});
test.each([
  ["https://example.com/x", ["example.com"], undefined],
  ["sub.example.com", ["example.com"], undefined],
  ["EXAMPLE.com.", ["example.com"], undefined],
  ["example.com:8080/a", ["example.com"], undefined],
  ["example.com.evil.com", ["example.com"], "example.com.evil.com"],
  ["evil.com/example.com", ["example.com"], "evil.com/example.com"],
  ["https://example.com@evil.com", ["example.com"], "https://example.com@evil.com"],
  ["t.me/micanal/5", ["t.me/micanal"], undefined],
  ["t.me/micanal2", ["t.me/micanal"], "t.me/micanal2"],
  ["t.me/otro", ["t.me/micanal"], "t.me/otro"],
  ["https://", ["example.com"], "https://"],
  ["a.example", [], "a.example"],
])("findUnauthorizedLink(%s, %j)", (link, list, expected) => {
  expect(findUnauthorizedLink([link], list)).toBe(expected);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/links.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

Para interpretar un enlace: si no cumple `/^[a-z][a-z0-9+.-]*:\/\//i`, anteponer `https://`; usar `new URL` y quitar el punto final del host. Si lanza error, no está autorizado. Host válido: igual a la entrada o terminado en `.` + la entrada. Con ruta en la entrada: la ruta en minúsculas debe ser igual o empezar con la ruta + `/`. `normalizeWhitelistEntry` exige protocolo `http`/`https` si lo hay, un host con punto, y quita `www.`, query, fragmento y `/` final.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/links.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/moderation/links.ts src/moderation/links.test.ts
git commit -m "feat: filtro de enlaces con lista blanca"
```

---

### Task 5: Detección de flood

**Files:**
- Create: `src/moderation/flood.ts`
- Test: `src/moderation/flood.test.ts`

**Interfaces:**
- Consumes: `normalizeText`.
- Produces:
```ts
export interface Fingerprint { kind: "text" | "media"; value: string }
export function fingerprintOf(message: Message): Fingerprint | undefined;
export interface FloodLimits { count: number; seconds: number }
export class FloodTracker {
  record(key: string, entry: { messageId: number; date: number; fingerprint: Fingerprint }, limits: FloodLimits): number[] | null;
  get size(): number;
}
```

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
const limits = { count: 5, seconds: 10 };
test("al quinto mensaje igual devuelve los cinco ids y limpia la ventana", () => {
  const t = new FloodTracker();
  for (let i = 1; i <= 4; i++) expect(t.record("k", msg(i, 100 + i, "hola"), limits)).toBeNull();
  expect(t.record("k", msg(5, 105, "HOLA"), limits)).toEqual([1, 2, 3, 4, 5]);
  expect(t.record("k", msg(6, 106, "hola"), limits)).toBeNull();
});
test("usa message.date: mensajes atrasados procesados juntos no son flood", () => {
  const t = new FloodTracker();
  for (let i = 0; i < 6; i++) expect(t.record("k", msg(i, i * 11, "hola"), limits)).toBeNull();
});
test("no mezcla remitentes ni textos distintos", () => {});
test("textos largos casi iguales cuentan; textos cortos parecidos no", () => {
  // "oferta increíble de criptomonedas para ti" frente a la misma frase con "hoy" al final cuenta
  // "hola" frente a "hole" no cuenta
});
test("la misma multimedia cuenta por file_unique_id", () => {
  expect(fingerprintOf(photoMessage("abc"))).toEqual({ kind: "media", value: "abc" });
  expect(fingerprintOf(stickerMessage("abc"))).toEqual({ kind: "media", value: "abc" });
});
test("un mensaje de servicio no tiene huella", () => {
  expect(fingerprintOf(serviceMessage())).toBeUndefined();
});
test("olvida remitentes inactivos", () => {
  const t = new FloodTracker();
  t.record("viejo", msg(1, 0, "a"), limits);
  t.record("nuevo", msg(2, 4000, "a"), limits);
  expect(t.size).toBe(1);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/flood.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

Multimedia: `file_unique_id` de foto (último tamaño), sticker, video, animación, documento, audio, voz o nota de video; tiene prioridad sobre el pie de foto. Texto: `normalizeText(text ?? caption)`. Similares: valor igual, o coeficiente de Dice sobre bigramas de al menos 0.85 cuando ambos textos tienen 20 caracteres o más. La ventana se poda con `entry.date - limits.seconds`. Máximo 100 entradas por remitente. Barrido global de claves sin actividad en 3600 s, como mucho cada 600 s de `date`.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/flood.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/moderation/flood.ts src/moderation/flood.test.ts
git commit -m "feat: detección de flood por ventana deslizante"
```

---

### Task 6: Remitentes, exenciones y ejecución de acciones

**Files:**
- Create: `src/moderation/sender.ts`, `src/moderation/enforcer.ts`
- Test: `src/moderation/sender.test.ts`, `src/moderation/enforcer.test.ts`

**Interfaces:**
- Consumes: `insertEvent`, `FilterAction`, `FilterName`, `AppEnv`, `Db`.
- Produces:
```ts
// sender.ts
export interface Sender { type: SenderType; id: number; name: string }
export function senderOf(message: Message): Sender;
export function isStructurallyExempt(message: Message, chat: { id: number; linkedChatId: number | null }): boolean;

// enforcer.ts
export interface Violation {
  chatId: number; sender: Sender; filter: FilterName; matched: string;
  text: string | null; action: FilterAction; messageIds: number[];
  adminCheckUserId: number | null;
}
export type EnforcerApi = Pick<Api, "getChatMember" | "deleteMessages" | "banChatMember" | "banChatSenderChat">;
export function createEnforcer(deps: { api: EnforcerApi; db: Db; appEnv: AppEnv; sleep?: (ms: number) => Promise<void> }): {
  enqueue(violation: Violation): void;
  drain(): Promise<void>;
};
```

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
// sender.test.ts
test("usa sender_chat antes que from", () => { /* type "chat", id del canal */ });
test.each(["reenvío automático", "admin anónimo", "canal vinculado"])("%s está exento", () => {});
test("otro canal no está exento", () => {});

// enforcer.test.ts (api falsa que registra llamadas; `await e.drain()` antes de afirmar)
test("production: miembro normal se borra, se banea sin until_date y se registra", () => {
  // deleteMessages(chat, ids); banChatMember(chat, 10) con dos argumentos
  // evento { deleteOk: true, banOk: true, dryRun: false, error: null }
});
test.each(["creator", "administrator"])("production: %s no recibe acción ni evento", () => {});
test("si getChatMember falla no borra ni banea, y registra el error", () => {
  // evento { deleteOk: null, banOk: null, error: <mensaje> }
});
test("acción delete no banea", () => { /* banOk null */ });
test("remitente canal: usa banChatSenderChat y no consulta getChatMember", () => {});
test("development: borra, nunca banea ni consulta admin; evento simulado", () => {
  // getChatMember y banChatMember sin llamadas; { dryRun: true, banOk: null, deleteOk: true }
});
test("si el ban falla guarda el error y procesa el siguiente del mismo chat", () => {
  // primera violación: banOk false, error; segunda: deleteMessages llamado
});
test("divide el borrado en lotes de 100", () => { /* 101 ids, 2 llamadas */ });
test("en 429 espera retry_after y reintenta", () => {
  // deleteMessages lanza GrammyError(429, retry_after 3) una vez; sleep(3000); deleteOk true
});
test("un chat esperando no retrasa a otro; el mismo chat mantiene el orden", () => {});
test("enqueue retorna sin esperar a Telegram", () => {
  // getChatMember nunca resuelve; enqueue() retorna igual
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/sender.test.ts src/moderation/enforcer.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

Exento estructural: `is_automatic_forward`, `sender_chat.id === chat.id` o `sender_chat.id === chat.linkedChatId`. Cola: una cadena de promesas por `chatId`, con catch que registra el error y mantiene viva la cadena. Secuencia: comprobación de admin solo si `appEnv === "production"` y `adminCheckUserId !== null`; borrado por lotes de 100; ban solo si `action === "delete_ban"`, en `production`; evento al final. `dryRun = appEnv === "development" && action === "delete_ban"`. Reintento: hasta 3 intentos ante `GrammyError` 429, esperando `parameters.retry_after * 1000` ms.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/sender.test.ts src/moderation/enforcer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/moderation/sender.ts src/moderation/sender.test.ts src/moderation/enforcer.ts src/moderation/enforcer.test.ts
git commit -m "feat: exenciones y cola de acciones por chat"
```

---

### Task 7: Registro de chats

**Files:**
- Create: `src/moderation/registration.ts`, `src/test/harness.ts`, `src/test/updates.ts`
- Test: `src/moderation/registration.test.ts`

**Interfaces:**
- Consumes: funciones de `chats.ts`, `DEFAULT_WORDS`.
- Produces:
```ts
// registration.ts
export function createRegistrationHandler(deps: { db: Db }): Composer<Context>;

// harness.ts: bot id 999; respuesta por defecto `true`
export interface ApiCall { method: string; payload: any }
export function createTestBot(): {
  bot: Bot; calls: ApiCall[];
  callsOf(method: string): ApiCall[];
  respond(method: string, fn: (payload: any) => unknown): void;
};

// updates.ts: chat -100 supergrupo "Grupo", remitente 10 "Ana", date 1_000_000; ids autoincrementales
export function groupMessage(overrides?: Partial<Message>): Update;
export function editedGroupMessage(overrides?: Partial<Message>): Update;
export function myChatMember(input: { chat?: Chat; status: "administrator" | "member" | "left" | "kicked"; canDelete?: boolean; canRestrict?: boolean }): Update;
export function channelPost(overrides?: Partial<Message>): Update;
```

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test("el primer mensaje de un grupo desconocido lo registra apagado y sigue a next()", async () => {
  await bot.handleUpdate(groupMessage({ text: "hola" }));
  expect(getChat(db, -100)).toMatchObject({ title: "Grupo", moderationEnabled: false });
  expect(listWords(db, -100)).toEqual(expect.arrayContaining(["mierda"]));
  expect(nextCalled).toBe(true);
});
test("no bloquea el update esperando a getChat", async () => {
  t.respond("getChat", () => new Promise(() => {}));
  await bot.handleUpdate(groupMessage({ text: "hola" })); // no debe colgarse
});
test("guarda linked_chat_id y permisos cuando responde Telegram", async () => {});
test("my_chat_member guarda estado y permisos", async () => {
  await bot.handleUpdate(myChatMember({ status: "administrator", canDelete: true, canRestrict: true }));
  expect(getChat(db, -100)).toMatchObject({ botStatus: "administrator", canDelete: true, canRestrict: true });
});
test("left marca un chat conocido y no crea uno desconocido", async () => {});
test("channel_post registra el canal", async () => {});
test("un chat privado no se registra", async () => {});
test("new_chat_title actualiza el título", async () => {});
test("migrate_to_chat_id y migrate_from_chat_id migran en cualquier orden", async () => {
  // orden A: migrate_to en -1 y luego migrate_from en -1001
  // orden B: mensaje normal en -1001, migrate_from en -1001, migrate_to en -1
  // en ambos: getChat(-1) undefined; getChat(-1001) conserva moderationEnabled true
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/registration.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar**

`insertChat` es síncrono, para que los mensajes siguientes ya vean el chat. Tras insertarlo, `void refresh(...)` llama a `getChat` y `getChatMember(botId)` y guarda `linkedChatId`, `botStatus`, `canDelete` y `canRestrict`; sus errores solo se registran. La migración también lanza `refresh` sobre el id nuevo. El handler siempre llama a `next()`.

`harness.ts`: `new Bot("1:test", { botInfo })` y `bot.api.config.use` para interceptar todas las llamadas y devolver `{ ok: true, result }` sin red.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/registration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/moderation/registration.ts src/moderation/registration.test.ts src/test
git commit -m "feat: registro automático de grupos y canales"
```

---

### Task 8: Middleware de moderación y conexión al bot

**Files:**
- Create: `src/moderation/handler.ts`
- Modify: `src/index.ts`
- Test: `src/moderation/handler.test.ts`

**Interfaces:**
- Consumes: `createEnforcer`, `FloodTracker`, `fingerprintOf`, `extractLinks`, `findUnauthorizedLink`, `findBannedWord`, `senderOf`, `isStructurallyExempt`, `getChat`, `listWords`, `listWhitelist`, `createTestBot`.
- Produces: `createModerationHandler(deps: { db: Db; enforcer: { enqueue(v: Violation): void }; flood: FloodTracker }): Composer<Context>`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Bot real de prueba con registro, moderación, un `bot.command("start")` que responde y un `next` espía. Enforcer real en `production` con `getChatMember` respondiendo `member`. Se espera `enforcer.drain()` antes de cada afirmación.

```ts
test("chat apagado: ni llamadas a Telegram ni eventos ni texto guardado", async () => {});
test("enlace no autorizado: borra, banea, registra y no sigue a next()", async () => {
  await bot.handleUpdate(groupMessage({ text: "a.example", entities: [{ type: "url", offset: 0, length: 9 }] }));
  await enforcer.drain();
  expect(t.callsOf("deleteMessages")).toHaveLength(1);
  expect(t.callsOf("banChatMember")[0].payload).toMatchObject({ chat_id: -100, user_id: 10 });
  expect(listEvents(db, -100, { limit: 1 })[0]).toMatchObject({ filter: "link", matched: "a.example" });
  expect(nextCalled).toBe(false);
});
test("/start con enlace se modera y no se responde", async () => { /* sendMessage sin llamadas */ });
test("una edición que agrega un enlace se detecta", async () => {});
test("enlace en la lista blanca sigue a next()", async () => {});
test("palabra en el pie de una foto se detecta", async () => {});
test("cinco mensajes iguales en 10 s borran los cinco", async () => {});
test("mensajes atrasados no son flood; las ediciones no cuentan", async () => {});
test.each(["reenvío automático", "admin anónimo", "canal vinculado"])("%s no recibe acción", async () => {});
test("admin confirmado no recibe acción ni evento", async () => {});
test("mensaje como otro canal usa banChatSenderChat", async () => {});
test("filtro apagado no actúa; acción delete no banea", async () => {});
test("un no admin agrega un bot: se banea al bot y se borra el aviso", async () => {
  // new_chat_members: [{ id: 50, is_bot: true }], from 10 (member)
  // banChatMember user_id 50; deleteMessages; evento filter "bot"; adminCheckUserId 10
});
test("un admin agrega un bot: no se hace nada", async () => {});
test("agregar nuestro propio bot o a una persona no activa el filtro", async () => {
  // new_chat_members: [{ id: 999, is_bot: true }] y [{ id: 11, is_bot: false }]
});
test("chats privados y canales nunca se evalúan", async () => {});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/moderation/handler.test.ts`
Expected: FAIL

- [ ] **Step 3: Implementar el middleware**

Solo `message` y `edited_message` de `group` y `supergroup`. Orden: chat encendido, exención estructural, nuevos bots, enlaces, palabras, flood (solo `message` con huella). Si hay infracción, `enforcer.enqueue` y retornar sin `next()`. Clave de flood: `${chatId}:${sender.id}`. `adminCheckUserId`: el remitente si es usuario; `null` si es canal; quien agregó al bot en el filtro de bots. Excluir `ctx.me.id` de los bots nuevos.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/moderation/handler.test.ts`
Expected: PASS

- [ ] **Step 5: Conectar en `src/index.ts`**

Antes de `bot.command("start", ...)`: abrir la base con `config.databasePath`, crear `FloodTracker` y enforcer con `bot.api` y `config.appEnv`, y luego `bot.use(createRegistrationHandler({ db }))` y `bot.use(createModerationHandler(...))`.

- [ ] **Step 6: Verificar con Telegram real**

Run: `docker compose run --rm bot pnpm typecheck && docker compose up -d bot && docker compose logs --tail 5 bot`
Expected: sin errores de tipos; `Bot iniciado como @...`. Pedir al dueño escribir en el grupo de prueba y comprobar: `docker compose exec bot node -e "console.log(require('better-sqlite3')('data/development.sqlite').prepare('select id,title,moderation_enabled,can_delete,can_restrict from chats').all())"`. El grupo aparece con `moderation_enabled: 0`.

- [ ] **Step 7: Commit**

```bash
git add src/moderation/handler.ts src/moderation/handler.test.ts src/index.ts
git commit -m "feat: middleware de moderación antes de los comandos"
```

---

### Task 9: API REST

**Files:**
- Create: `src/api/guard.ts`, `src/api/app.ts`
- Modify: `src/index.ts`
- Test: `src/api/app.test.ts`

**Interfaces:**
- Consumes: capa de datos, `normalizeWord`, `normalizeWhitelistEntry`, `isActiveBan`, `AppEnv`.
- Produces: `type ApiTelegram = Pick<Api, "leaveChat" | "unbanChatMember" | "unbanChatSenderChat">`; `createApi(deps: { db: Db; telegram: ApiTelegram; appEnv: AppEnv }): Hono`.

Respuestas: errores `{ error: string }` en español. `GET /api/health` → `{ status: "ok", appEnv }`. `GET /api/chats` → `ChatRecord[]`. `GET` y `PATCH /api/chats/:id` → `ChatRecord`. `DELETE /api/chats/:id` → 204. `GET .../words` → `{ words: string[] }`; `POST` → 201 `{ word }`. `GET .../whitelist` → `{ entries: string[] }`; `POST` → 201 `{ entry }`. `DELETE ...?word=` o `?entry=` → 204 o 404. `GET .../events?limit=50&before=<id>` → `{ events: EventRecord[], nextBefore: number | null }`, con `limit` máximo 100. `POST .../events/:eventId/unban` → `EventRecord`.

- [ ] **Step 1: Escribir las pruebas que fallan**

```ts
test.each(["bot.localhost", "localhost:9000", "127.0.0.1:8088", "[::1]:5173"])("acepta Host %s", async (host) => {
  expect((await get("/api/health", { Host: host })).status).toBe(200);
});
test.each(["evil.example", "bot.localhost.evil.example"])("rechaza Host %s también en lecturas", async (host) => {
  expect((await get("/api/chats", { Host: host })).status).toBe(403);
});
test("rechaza escrituras con Origin de otro host", async () => {
  const r = await patch("/api/chats/-100", { floodCount: 6 }, { Host: "bot.localhost", Origin: "https://evil.example" });
  expect(r.status).toBe(403);
  expect(r.headers.get("access-control-allow-origin")).toBeNull();
});
test("acepta Origin del mismo host", async () => {});
test.each([
  [{ floodCount: 1 }], [{ floodCount: 51 }], [{ floodSeconds: 0 }], [{ floodSeconds: 3601 }],
  [{ linkFilterAction: "kick" }], [{ title: "x" }],
])("PATCH inválido %j da 400 con mensaje", async (body) => {});
test("PATCH parcial guarda y devuelve el chat; id desconocido da 404", async () => {});
test("un canal no se puede encender", async () => { /* 400 */ });
test("JSON mal formado da 400", async () => {});
test("palabras: normaliza, duplicada no falla, vacía da 400, borrar por query", async () => {
  expect(await json(post(".../words", { word: " Coño " }))).toEqual({ word: "coño" });
  expect((await post(".../words", { word: "coño" })).status).toBe(201);
  expect((await post(".../words", { word: "  " })).status).toBe(400);
  expect((await del(".../words?word=co%C3%B1o")).status).toBe(204);
  expect((await del(".../words?word=nada")).status).toBe(404);
});
test("lista blanca: normaliza, inválida da 400 legible, borra con barra", async () => {
  expect(await json(post(".../whitelist", { entry: "t.me/MiCanal/" }))).toEqual({ entry: "t.me/micanal" });
  expect((await del(".../whitelist?entry=t.me%2Fmicanal")).status).toBe(204);
});
test("eventos paginan con nextBefore", async () => {});
test("desbanear usuario usa only_if_banned y marca el evento", async () => {
  // telegram.unbanChatMember(-100, 10, { only_if_banned: true }); unbannedAt definido
});
test("desbanear canal usa unbanChatSenderChat", async () => {});
test("desbanear simulado o ya deshecho da 409", async () => {});
test("si Telegram falla al desbanear da 502 y no marca", async () => {});
test("salir y olvidar llama leaveChat y borra", async () => {});
test("si el bot ya no estaba (400/403) también borra; otro error da 502 y conserva", async () => {});
test("ruta desconocida bajo /api da 404 JSON", async () => {});
```

- [ ] **Step 2: Verificar que fallan**

Run: `docker compose run --rm bot pnpm test src/api`
Expected: FAIL

- [ ] **Step 3: Implementar `guard.ts` y `app.ts`**

Guard: el hostname de `Host`, sin puerto, debe ser exactamente uno de los hosts permitidos. En métodos que no sean `GET` ni `HEAD`, si hay `Origin`, su host debe ser igual a `Host`. Sin middleware de CORS. Esquema de `PATCH` con zod `.strict()`. `:id` y `:eventId` con patrón `-?\d+`.

- [ ] **Step 4: Verificar**

Run: `docker compose run --rm bot pnpm test src/api`
Expected: PASS

- [ ] **Step 5: Conectar en `src/index.ts`**

`serve({ fetch: api.fetch, port: config.apiPort })` de `@hono/node-server`. Purga al arrancar y con `setInterval` cada 24 h, con `.unref()`. Cierre en `SIGINT`/`SIGTERM`: `bot.stop()`, cerrar el servidor, `await enforcer.drain()` y `db.close()`.

- [ ] **Step 6: Verificar en el contenedor**

Run: `docker compose run --rm bot pnpm typecheck && docker compose up -d bot && docker compose exec bot wget -qO- --header 'Host: bot.localhost' http://127.0.0.1:3000/api/health`
Expected: `{"status":"ok","appEnv":"development"}`

- [ ] **Step 7: Commit**

```bash
git add src/api src/index.ts
git commit -m "feat: API REST para configurar la moderación"
```

---

### Task 10: Panel, Traefik y lista de chats

**Files:**
- Create: `front/` (Vite vue-ts), `front/Dockerfile`, `front/src/lib/api.ts`, `front/src/stores/chats.ts`, `front/src/router.ts`, `front/src/views/ChatsView.vue`
- Modify: `compose.yml`, `front/src/App.vue`, `front/src/main.ts`, `front/vite.config.ts`

**Interfaces:**
- Consumes: las respuestas de la API de la Tarea 9.
- Produces:
```ts
// lib/api.ts: tipos ChatRecord, ChatSettings, EventRecord iguales a los del servidor
export class ApiError extends Error { status: number }
export const api: {
  health(): Promise<{ status: string; appEnv: "development" | "production" }>;
  listChats(): Promise<ChatRecord[]>;
  getChat(id: number): Promise<ChatRecord>;
  updateChat(id: number, patch: Partial<ChatSettings>): Promise<ChatRecord>;
  forgetChat(id: number): Promise<void>;
  listWords(id: number): Promise<string[]>;
  addWord(id: number, word: string): Promise<string>;
  removeWord(id: number, word: string): Promise<void>;
  listWhitelist(id: number): Promise<string[]>;
  addWhitelistEntry(id: number, entry: string): Promise<string>;
  removeWhitelistEntry(id: number, entry: string): Promise<void>;
  listEvents(id: number, before?: number): Promise<{ events: EventRecord[]; nextBefore: number | null }>;
  unban(id: number, eventId: number): Promise<EventRecord>;
};
// stores/chats.ts: useChatsStore → { chats, appEnv, loading, error, load(), forget(id) }
```

- [ ] **Step 1: Crear el paquete en el host**

Se hace en el host para que los archivos sean del usuario; el `node_modules` del contenedor va en un volumen aparte. `front/pnpm-workspace.yaml` debe existir antes de instalar: sin él, pnpm toma como raíz el `pnpm-workspace.yaml` del bot y falla contra su `node_modules` de root.

```bash
pnpm create vite@latest front --template vue-ts
cd front
printf 'allowBuilds:\n  esbuild: true\n' > pnpm-workspace.yaml
pnpm pkg set packageManager="$(node -p "require('../package.json').packageManager")"
pnpm add pinia vue-router tailwindcss @tailwindcss/vite vue-sonner
pnpm add -D @types/node
```

Seguir la guía de shadcn-vue para Vite (alias `@`, `@import "tailwindcss"`, `pnpm dlx shadcn-vue@latest init`). Igual que `playhubplus-api/front`: estilo `new-york`, color base `neutral`, iconos `lucide`, CSS en `src/style.css`. Luego:

`pnpm dlx shadcn-vue@latest add button card input label switch select badge tabs alert alert-dialog table sonner`

Si pnpm bloquea otro build, agregarlo a `allowBuilds`. Si `vue-tsc` no soporta la versión de TypeScript instalada, fijar `typescript@~6.0.3` como el proyecto hermano.

- [ ] **Step 2: Configurar Vite**

```ts
server: {
  host: true, port: 5173,
  allowedHosts: ["bot.localhost"],
  proxy: { "/api": { target: "http://bot:3000", changeOrigin: false } },
}
```

`changeOrigin: false` conserva el `Host` que valida la API.

- [ ] **Step 3: Docker y Traefik**

`front/Dockerfile`, etapa `dev`, sobre `node:24-alpine` con corepack: `CMD ["sh", "-c", "pnpm install && pnpm dev"]`.

`compose.yml`:

```yaml
  bot-front:
    build:
      context: ./front
      target: dev
    volumes:
      - ./front:/app
      - front_node_modules:/app/node_modules
    depends_on:
      - bot
    restart: unless-stopped
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.bot-front.rule=Host(`bot.localhost`)"
      - "traefik.http.routers.bot-front.entrypoints=web"
      - "traefik.http.routers.bot-front.service=bot-front"
      - "traefik.http.services.bot-front.loadbalancer.server.port=5173"
```

Agregar `front_node_modules:` a `volumes`. Ningún servicio declara `ports`.

- [ ] **Step 4: Verificar la ruta completa**

```bash
docker compose up -d --build
curl -sS -H 'Host: bot.localhost' http://127.0.0.1/api/health
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1/api/health
docker compose ps --format '{{.Service}} {{.Publishers}}'
```
Expected: `{"status":"ok","appEnv":"development"}`; `404` (Traefik no enruta otro host); ningún puerto publicado.

- [ ] **Step 5: Implementar cliente, stores, router y lista**

Rutas `/` y `/chats/:id`. Cliente con `fetch` y rutas relativas `/api`; lanza `ApiError` con el `error` del servidor. En `DELETE`, `word` y `entry` van con `encodeURIComponent` en la query.

`App.vue`: aviso fijo cuando `appEnv === "development"`: "Modo desarrollo: los bans son simulados". Montar el `Toaster` de sonner.

`ChatsView.vue`: tarjeta o fila por chat con nombre, tipo y estado (encendido, apagado o inactivo si `botStatus` es `left` o `kicked`). Aviso si es grupo sin `canDelete` o sin `canRestrict`: "Hazme admin con permisos de eliminar mensajes y banear usuarios". "Salir y olvidar" con `AlertDialog`. Estado vacío: "Agrega el bot a un grupo y escribe un mensaje para que aparezca aquí". Errores con toast.

- [ ] **Step 6: Verificar en el navegador**

Run: `docker compose exec bot-front pnpm build` (solo comprobación de tipos y build)
Expected: termina sin errores.

Abrir `http://bot.localhost`: la lista muestra el grupo de prueba como apagado, sin errores en consola, y se ve el aviso de desarrollo.

- [ ] **Step 7: Commit**

```bash
git add front compose.yml
git status --short   # front/node_modules y front/dist no deben aparecer
git commit -m "feat: panel Vue en bot.localhost con lista de chats"
```

---

### Task 11: Detalle del grupo

**Files:**
- Create: `front/src/views/ChatDetailView.vue`, `front/src/components/FiltersPanel.vue`, `front/src/components/WordsPanel.vue`, `front/src/components/WhitelistPanel.vue`, `front/src/components/HistoryPanel.vue`, `front/src/stores/chatDetail.ts`
- Modify: `front/src/router.ts`

**Interfaces:**
- Consumes: `api` y tipos de `lib/api.ts`.
- Produces: `useChatDetailStore(id)` con `{ chat, words, whitelist, events, nextBefore, load(), update(patch), addWord(w), removeWord(w), addEntry(e), removeEntry(e), loadMoreEvents(), unban(eventId) }`.

- [ ] **Step 1: Implementar la vista con pestañas Filtros, Palabras, Lista blanca e Historial**

- **Filtros:** interruptor general destacado. Si la lista blanca está vacía y el filtro de enlaces activo, aviso al encender: "Cualquier enlace de un miembro provocará un ban". Por filtro: `Switch` y `Select` ("Solo borrar", "Borrar y banear"). El filtro de bots solo tiene interruptor. Flood: número de mensajes y segundos. Cada cambio se guarda al momento; si la API responde error, se muestra en toast y se restaura el valor anterior.
- **Palabras:** campo y botón, lista con quitar. Muestra lo que devuelve la API (normalizado).
- **Lista blanca:** igual, con ejemplos `example.com` y `t.me/micanal`, y el error de la API junto al campo.
- **Historial:** tabla con fecha local, remitente, filtro, qué coincidió, resultado (borrado y ban, con error si lo hay), `Badge` "Simulado", y texto con interpolación normal. "Desbanear" solo en bans activos, con confirmación, aclarando que el usuario debe volver a entrar por su cuenta. "Cargar más" usa `nextBefore`.
- **Canales:** sin pestañas de filtros, con la nota: "En un canal solo publican admins. Para moderar los comentarios, agrega el bot a su grupo de discusión y configúralo allí".

- [ ] **Step 2: Verificar tipos y build**

Run: `docker compose exec bot-front pnpm build`
Expected: termina sin errores.

- [ ] **Step 3: Verificar en el navegador, en `http://bot.localhost`, con el grupo de prueba**

1. Encender el grupo muestra el aviso y persiste tras recargar.
2. Flood con 1 mensaje muestra el error y restaura el valor.
3. `https://www.Example.com/` queda como `example.com`; `t.me/micanal` se agrega y se quita.
4. ` Coño ` queda como `coño`; agregarla otra vez no da error.
5. Con filtros encendidos, pedir al dueño enviar al grupo un enlace y luego `<img src=x onerror=alert(1)>` con una palabra prohibida. El mensaje desaparece; el historial lo marca "Simulado" y muestra el texto literal, sin ejecutar nada.
6. El ban simulado no ofrece "Desbanear".
7. En la consola del navegador no hay errores.

- [ ] **Step 4: Commit**

```bash
git add front/src
git commit -m "feat: configuración e historial por grupo en el panel"
```

---

### Task 12: Producción y prueba final

**Files:**
- Create: `front/nginx.conf`
- Modify: `front/Dockerfile`, `compose.prod.yml`

**Interfaces:**
- Consumes: el `pnpm build` del panel y la API en `bot:3000`.

- [ ] **Step 1: nginx y etapa de producción**

`front/Dockerfile`: etapa `build` con `pnpm install --frozen-lockfile && pnpm build`; etapa `prod` con `nginx:1-alpine`, copiando `dist` y `nginx.conf`.

`front/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  location /api/ {
    proxy_pass http://bot:3000;
    proxy_set_header Host $http_host;
  }
  location / { try_files $uri /index.html; }
}
```

`compose.prod.yml`: servicio `bot-front` con `target: prod`, `depends_on: [bot]`, `restart: unless-stopped` y `ports: ["127.0.0.1:8088:80"]`. El servicio `bot` no publica puertos ni usa la red `traefik`.

- [ ] **Step 2: Verificar en un proyecto temporal**

Mismo token, así que primero se detiene desarrollo. El proyecto separado evita mezclar el volumen `data` de desarrollo, que es de root. Crear en el scratchpad de la sesión un archivo de override con `services: { bot: { environment: { APP_ENV: production } } }`.

```bash
docker compose stop bot bot-front
docker compose -p telegram-bot-prodtest -f compose.prod.yml -f <override> up -d --build
curl -sS -H 'Host: localhost:9000' http://127.0.0.1:8088/api/health
curl -sS -o /dev/null -w '%{http_code}\n' -H 'Host: evil.example' http://127.0.0.1:8088/api/health
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8088/chats/1
curl -sS -o /dev/null --max-time 3 -w '%{http_code}\n' "http://$(hostname -I | awk '{print $1}'):8088/" || echo NO_ALCANZABLE
docker compose -p telegram-bot-prodtest -f compose.prod.yml -f <override> exec bot sh -c 'ls -ln /app/data && id -u'
```
Expected: `{"status":"ok","appEnv":"production"}`; `403`; `200` (index.html); `NO_ALCANZABLE`; `production.sqlite` existe y su dueño coincide con `id -u` (no root).

- [ ] **Step 3: Probar `APP_ENV` obligatorio**

Run: `docker compose -p telegram-bot-prodtest -f compose.prod.yml run --rm -e APP_ENV=staging bot`
Expected: termina con un error que menciona `APP_ENV`.

- [ ] **Step 4: Limpiar el proyecto temporal y volver a desarrollo**

```bash
docker compose -p telegram-bot-prodtest -f compose.prod.yml -f <override> down -v
docker compose up -d
docker compose run --rm bot pnpm test
docker compose run --rm bot pnpm typecheck
```
Expected: todas las pruebas pasan; `http://bot.localhost` funciona. `down -v` solo afecta a `telegram-bot-prodtest`.

- [ ] **Step 5: Comprobar los comandos que quedan**

Pedir al dueño, en privado con el bot: `/start` y `/help`.
Expected: responden con los textos de la Tarea 0.

- [ ] **Step 6: Prueba del dueño con una segunda cuenta (ban real)**

No se puede automatizar: requiere otra cuenta de Telegram. Es opcional antes de desplegar y va con `APP_ENV=production` en `.env` y `docker compose up -d --force-recreate bot`. Esa base es otra, así que el grupo vuelve a aparecer apagado y hay que encenderlo. La segunda cuenta envía un enlace: se borra, queda baneada y "Desbanear" la libera. Volver después a `APP_ENV=development`.

- [ ] **Step 7: Commit**

```bash
git add front/Dockerfile front/nginx.conf compose.prod.yml
git commit -m "feat: despliegue de producción con panel solo en loopback"
```
