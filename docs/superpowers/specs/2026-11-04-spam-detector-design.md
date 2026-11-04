# Detector de spam y panel de moderación: diseño

Fecha: 2026-11-04. Estado: pendiente de aprobación.

## Por qué

El bot (grammY, TypeScript, long polling, sin base de datos) vendía planes con Telegram Stars usando `playhubplus-api`. Esa parte se quita: las suscripciones volverán después con un backend propio. Su dueño lo va a integrar en sus grupos y quiere que el spam desaparezca sin moderar a mano, y poder ajustar todo desde una interfaz web, no con comandos de Telegram.

## Objetivos

- Detectar en cada grupo: enlaces no autorizados, palabras prohibidas, mensajes repetidos (flood) y bots agregados por quien no es admin.
- Al detectar spam, borrar el mensaje y banear al remitente.
- Configuración independiente por grupo, editable por completo desde el panel.
- API REST con todo lo que el panel necesita y panel web en `front/` construido en esta entrega (no solo el esqueleto).
- Historial de acciones por grupo, con opción de desbanear.
- `APP_ENV` en `.env`: el bot se comporta distinto en desarrollo y en producción.

## No objetivos (por ahora)

- Login o permisos en el panel. El dueño lo pospuso de forma explícita.
- Comandos de Telegram para administrar (`/addword` y similares). Se descartaron a favor del panel.
- Captcha de entrada, listas globales de spammers, análisis con IA, antigüedad de la cuenta.
- Tratar `@menciones` como enlaces: son parte de la conversación normal.
- Evasiones avanzadas de palabras (`p.u.t.a`, caracteres cirílicos parecidos).
- Avisos privados a los admins al banear: el panel es el registro.
- Modo Bot-to-Bot de BotFather (ver "Filtro de bots").
- Acceso al panel por VPN o dominio público: llega junto con el login.
- Suscripciones y pagos con el backend propio: el dueño los deja para después.

## Anti-objetivos: esto sería un fracaso aunque funcione

- Banear a un miembro legítimo sin forma de deshacerlo.
- Que una oleada de spam detenga el procesamiento de los demás updates del bot.
- Que el panel sin login quede alcanzable desde internet.
- Moderar grupos ajenos o guardar sus mensajes: el bot es público y cualquiera puede agregarlo a su grupo.
- Banear por coincidencias parciales: `computadora` contiene `puta`, y `año` sin tilde sería `ano`.
- Que el canal vinculado de un grupo termine baneado.

## Decisiones del dueño

- El bot modera sus propios grupos ("mis grupos").
- Acción ante spam: borrar mensaje y banear usuario.
- Palabras: lista editable que arranca con algunas por defecto.
- Enlaces: lista blanca que arranca vacía; cualquier otro enlace es spam.
- Admins exentos de los filtros.
- Flood: 5 mensajes iguales o similares en 10 segundos, configurable.
- SQLite.
- Frontend con Vue, shadcn (shadcn-vue en Vue) y Pinia, en la carpeta `front/`.
- Sin login por ahora.
- Grupos y canales con configuración separada.
- Todo se ejecuta con Docker.
- En desarrollo el panel se abre en `http://bot.localhost`, por el Traefik que ya está corriendo y solo por HTTP.
- El código deja de llamarse PlayHub+. El dueño renombra la carpeta después.
- Todos los textos del bot, la API y el panel van en inglés. Las traducciones llegarán después.
- Se quita la suscripción basada en `playhubplus-api`.

## Decisiones del diseñador (el dueño puede cambiarlas)

| Decisión | Motivo |
| --- | --- |
| API dentro del mismo proceso del bot, con Hono | Un solo escritor de SQLite; los cambios del panel aplican de inmediato sin caché ni sincronización |
| `better-sqlite3` | Maduro y síncrono. Probado: la versión 13.0.3 instala y funciona con `npm` en `node:24-alpine` |
| Todo grupo nuevo llega apagado y se enciende desde el panel | El bot es público y el dueño quiere moderar solo sus grupos. Además, da tiempo de cargar la lista blanca: con ella vacía, el primer enlace de un miembro provoca un ban |
| Acción configurable por filtro: `delete` o `delete_ban` (default `delete_ban`) | "Todo configurable", y permite suavizar un filtro sin apagarlo |
| Ban permanente | Es lo que hace Telegram si no se indica duración; el panel permite deshacerlo |
| Filtro de bots como cuarto filtro | El dueño pidió cubrir bots que entran |
| Canales sin filtros (ver "Canales") | En un canal solo publican admins |
| Conducta de `APP_ENV` (ver abajo) | El dueño pidió que difiera; la diferencia concreta la propone este diseño |
| Historial con retención de 90 días y texto truncado a 1000 caracteres; los bans vigentes se conservan sin texto | Permite auditar sin guardar mensajes para siempre, y un ban antiguo sigue pudiéndose deshacer desde el panel |
| Acceso al panel en producción solo por túnel SSH | Sin login, cualquier otra vía expone un panel que puede banear |
| Se quita todo el flujo de compra (`/planes`, `/terms`, `/paysupport`, `/refund`), no solo la llamada a la API. El proyecto `playhubplus-api` no se modifica | Sin esa API no hay planes que vender. Sigue recuperable desde git |
| Nombre neutro `telegram-bot` para paquete y proyecto de Docker | El dueño quitó la marca sin indicar otro nombre; textos del bot sin marca |

## Comportamiento del detector

### Permisos del bot en Telegram

El bot debe ser admin del grupo con `can_delete_messages` y `can_restrict_members`. Ser admin también es lo que le permite ver los mensajes normales: con el modo privacidad por defecto, un bot que es miembro común no los recibe, así que tampoco detecta nada. El panel avisa si faltan permisos.

### Registro de chats

- Un chat se registra (upsert) en dos casos: al llegar un `my_chat_member`, y al ver **cualquier** update de un grupo, supergrupo o canal aún desconocido. El segundo caso es necesario: el bot ya fue agregado al grupo de prueba antes de que exista este código, y ese evento no se repite.
- Al registrar un chat se consultan título, `linked_chat_id` y los permisos del bot, y se copian las palabras por defecto a ese chat. Editarlas en un grupo no afecta a otro.
- Todo chat nuevo queda **apagado**: el bot no evalúa filtros ni guarda mensajes de ese chat hasta que se encienda en el panel. El resto del bot funciona igual.
- Si el bot sale del grupo, el registro se conserva como inactivo.
- El panel ofrece "Salir y olvidar": el bot abandona el grupo y se borran su configuración e historial. Sirve para grupos ajenos.
- `migrate_to_chat_id`: cuando un grupo se convierte en supergrupo **su id cambia**. Se actualiza el id en cascada para conservar configuración e historial.

### Orden de ejecución

1. El middleware de moderación se registra **antes** que todos los demás, incluidos `/start` y `/help`. Si fuera después, `/start https://spam.example` se saltaría el filtro, porque esos handlers no llaman a `next()`. `/start` y `/help` solo responden en chats privados.
2. Procesa `message` y `edited_message` de grupos y supergrupos. Un mensaje inofensivo editado después para meter un enlace también se detecta. Si el chat está apagado o no hay infracción, llama a `next()`.
3. Evalúa filtros de forma síncrona (SQLite y memoria), sin llamadas a Telegram.
4. Solo si un filtro se activa, consulta `getChatMember` para comprobar la exención. Los mensajes limpios no generan llamadas a la API.
5. Borra, banea y registra el evento.

**Los pasos 4 y 5 no deben bloquear la cola de updates.** `bot.start()` procesa los updates en secuencia, así que una oleada de spam o una espera por error 429 retrasaría todos los demás updates. Las acciones se encolan por chat, respetando `retry_after`, y el middleware retorna. Las consultas a Telegram al registrar un chat tampoco bloquean la cola.

### Filtros

| Filtro | Se activa cuando | Al encender el grupo |
| --- | --- | --- |
| Enlaces | Hay un enlace fuera de la lista blanca | activo, `delete_ban` |
| Palabras | El texto contiene una palabra o frase de la lista | activo, `delete_ban` |
| Flood | El remitente alcanza N mensajes similares en S segundos | activo, 5 en 10 s, `delete_ban` |
| Bots | Quien no es admin agrega una cuenta bot | activo, banea al bot |

**Enlaces**

- Se toman de las entidades `url` y `text_link` en `entities` y `caption_entities`, y de los botones con URL de `reply_markup`. `text_link` importa porque el enlace real no se ve en el texto.
- `example.com` en la lista permite ese dominio y sus subdominios.
- `t.me/micanal` permite esa ruta exacta y lo que cuelgue de ella. Hace falta porque autorizar `t.me` completo abriría todos los enlaces de Telegram.
- No deben coincidir: `example.com.evil.com`, `evil.com/example.com`, `t.me/micanal2`.
- Un enlace que no se pueda interpretar cuenta como no autorizado.
- Al guardar una entrada se normaliza: `https://www.Example.com/` queda como `example.com`.

**Palabras**

- Coincidencia por palabra completa, nunca por subcadena. Se admiten frases.
- Se ignoran mayúsculas y acentos, pero **se conserva la `ñ`**.
- Las repeticiones de 3 o más letras se reducen a una (`putaaaa` coincide con `puta`).
- La misma normalización se aplica a la lista y al mensaje.
- Se revisa `text` y `caption`.
- Longitud mínima de una palabra: 2 caracteres, ya normalizada (`xxx` queda en `x` y se rechaza).
- No se escanean las menciones (`mention`, `text_mention`) ni las URLs (`url`): sus rangos se sustituyen por espacios antes de buscar. `text_link` sí se escanea, porque su texto visible lo escribe el remitente.
- La lista inicial debe ser conservadora porque banea a la primera: sin términos ambiguos.

**Flood**

- Ventana deslizante en memoria por chat y remitente. Perderla al reiniciar es aceptable.
- Usa `message.date`, no la hora de llegada. Si no, al arrancar con updates pendientes, mensajes de varias horas parecerían llegar juntos y provocarían bans falsos.
- Similar: texto normalizado igual, o muy parecido si ambos son suficientemente largos. Multimedia: mismo `file_unique_id`.
- Al activarse se borran los mensajes similares de la ventana con `deleteMessages` (esto reemplaza a "todos" los de la ventana), no solo el último, y se limpia la ventana de ese remitente.
- Los mensajes de servicio no cuentan.

**Bots**

- Se usa el servicio `new_chat_members`. Si entra una cuenta con `is_bot` y quien la agregó no es admin, se banea al bot y se borra el aviso. A quien lo agregó no se le hace nada.
- Los bots agregados por un admin se respetan.
- Las cuentas humanas automatizadas, que son la mayoría de los "bots de spam", son usuarios normales para Telegram y las cubren los otros filtros.
- Los mensajes de otros bots no son visibles salvo que se active el modo Bot-to-Bot en BotFather. Queda apagado: el filtro de entrada cubre el caso y así se evita el riesgo de bucles que advierte Telegram.

### Exenciones

Nunca se actúa contra:

- Remitentes con estado `creator` o `administrator`, comprobado en el momento y sin caché, para que un admin recién nombrado no sea baneado.
- Admins anónimos: `sender_chat.id` igual al id del grupo.
- Reenvíos automáticos del canal vinculado: `is_automatic_forward`.
- Mensajes enviados como el canal vinculado: `sender_chat.id` igual a `linked_chat_id`, un canal que coincide con el `linked_chat_id` guardado queda exento sin consultar. Cualquier otro canal se comprueba en vivo con `getChat` antes de actuar, y si coincide no se actúa y se actualiza la fila. Un canal que fue desvinculado sigue exento hasta el siguiente refresco.

Si `getChatMember` falla, no se actúa y se registra el error. Sin confirmar que no es admin, no se banea. Igual con `getChat`: si falla al comprobar un canal, no se actúa y se registra el error.

### Acciones

- Usuario normal: `banChatMember`, sin `until_date`.
- Mensaje enviado como otro canal (`sender_chat`): `banChatSenderChat`. El `from` de esos mensajes es una cuenta genérica de Telegram, así que banearlo no sirve de nada y el flood debe agruparse por `sender_chat.id`.
- Desbanear: `unbanChatMember` **siempre con `only_if_banned: true`** (sin ese parámetro, Telegram expulsa al miembro si sigue en el grupo) o `unbanChatSenderChat`. El usuario no regresa solo; debe volver a entrar.
- No se confía en `revoke_messages` para limpiar mensajes. El borrado se hace de forma explícita.
- Si el borrado o el ban fallan, el evento guarda el error y el proceso sigue.
- Aviso opcional por grupo, apagado por defecto: una plantilla con `{user}`, `{action}` y `{reason}`, de hasta 500 caracteres. Se publica en silencio solo si el bot borró o baneó, como máximo uno cada 10 segundos por chat y sin reintentos. Nunca revela la palabra que coincidió. Si el nombre del remitente parece un enlace o una mención, se muestra su ID, para que el bot no repita spam.

### Staff

Lista por grupo de usuarios exentos de todos los filtros, también en desarrollo, sin ser admins. Se agregan por ID, comprobado contra Telegram, o por `@usuario`. Como Telegram no permite buscar un `@usuario`, el bot recuerda a quienes escriben en chats con moderación o auto replies encendidas; en chats apagados no guarda nada, y lo guardado se borra a los 90 días sin actividad.

### Reglas

Texto por grupo, hasta 4000 caracteres, editable en el panel. `/rules` lo publica en el grupo como máximo una vez por minuto; sin texto, el comando no responde. La moderación va antes.

### Auto replies

Lista por grupo de palabras y respuesta en texto con enlaces, apagada por defecto. La coincidencia es la de la blacklist, sin contar menciones ni URL. Cada respuesta sale como máximo una vez por minuto por grupo, y un mensaje produce una sola respuesta. No responde a ediciones, a reenvíos automáticos del canal ni a mensajes sancionados. Una palabra no puede estar en dos respuestas del mismo grupo.

### Mensajes programados

Desde el panel se envía un texto con enlaces a uno o varios chats, ahora o en una fecha, una sola vez. Se guardan en SQLite y sobreviven a un reinicio. Cada destino se marca como enviándose antes de la llamada: si el proceso se cae, queda como fallido en vez de enviarse dos veces. Un mensaje con más de una hora de retraso se marca como perdido y no se envía. Se conserva 90 días.

### Canales

En un canal solo publican admins, así que no hay spam de miembros que filtrar. El spam de un canal está en los comentarios, que viven en su grupo de discusión vinculado; ese grupo se configura como cualquier otro. Los canales aparecen en el panel sin filtros, con una nota que lo explica.

### `APP_ENV`

Obligatorio, `development` o `production`. Si falta o es otro valor, el bot no arranca: asumir cualquiera de los dos por defecto sería peligroso.

| | `development` | `production` |
| --- | --- | --- |
| Ban | No se ejecuta; el evento queda como simulado (`dry_run`) | Real |
| Borrado de mensajes | Real | Real |
| Exención de admins con cuenta propia | Desactivada | Activa |
| Base de datos por defecto | `data/development.sqlite` | `data/production.sqlite` |

Motivo: el dueño del grupo de prueba es admin, así que con la exención activa no podría probar los filtros desde su propia cuenta. Las demás exenciones (canal vinculado, reenvíos automáticos) siguen activas en ambos modos.

Desarrollo y producción deben usar tokens distintos: Telegram solo admite un proceso de long polling por token.

## Datos (SQLite)

Modo WAL y `PRAGMA foreign_keys = ON`. Migraciones con `PRAGMA user_version`. Esquema orientativo:

- `chats`: id (clave primaria), tipo, título, username, estado y permisos del bot, `linked_chat_id`, interruptor general, por filtro su activación y su acción, `flood_count`, `flood_seconds`, fechas.
- `chat_words`: `chat_id`, palabra normalizada; clave primaria compuesta.
- `chat_whitelist`: `chat_id`, entrada normalizada; clave primaria compuesta.
- `moderation_events`: id, `chat_id`, tipo e id de remitente, nombre visible, filtro, qué coincidió, texto truncado, acción, resultado del borrado y del ban, error, `dry_run`, `unbanned_at`, fecha.

Las claves foráneas usan `ON UPDATE CASCADE` por la migración a supergrupo. Los eventos de más de 90 días se purgan al arrancar y una vez al día. Excepción: un ban real que sigue vigente conserva su evento, con el texto vaciado, para poder deshacerlo desde el panel.

## API

Hono en `/api`, JSON. Las escrituras validan su entrada y responden 4xx con un mensaje legible.

| Método y ruta | Uso |
| --- | --- |
| `GET /api/health` | Estado |
| `GET /api/chats` | Chats registrados con estado y permisos del bot |
| `GET /api/chats/:id` | Detalle y configuración |
| `PATCH /api/chats/:id` | Actualización parcial de la configuración |
| `DELETE /api/chats/:id` | Salir del grupo y borrar sus datos |
| `GET`, `POST /api/chats/:id/words` | Listar y agregar palabras |
| `DELETE /api/chats/:id/words?word=...` | Quitar palabra |
| `GET`, `POST /api/chats/:id/whitelist` | Listar y agregar entradas |
| `DELETE /api/chats/:id/whitelist?entry=...` | Quitar entrada (va en la query porque `t.me/micanal` contiene `/`) |
| `GET /api/chats/:id/events` | Historial paginado por cursor |
| `POST /api/chats/:id/events/:eventId/unban` | Desbanear y marcar el evento |

Límites de flood: entre 2 y 50 mensajes, entre 1 y 3600 segundos.

## Panel (`front/`)

Vue 3, TypeScript, Vite, Pinia, Vue Router, shadcn-vue y Tailwind, en inglés. Paquete independiente del bot, con su propio lockfile y contexto de Docker. Llama a la API con la ruta relativa `/api`.

- **Lista de chats**: nombre, tipo, estado (encendido, apagado o inactivo), aviso si faltan permisos y "Salir y olvidar" con confirmación. El botón "Agregar grupo" abre el enlace de Telegram `t.me/<bot>?startgroup&admin=delete_messages+restrict_members`, porque un bot no puede unirse a un grupo por sí mismo; el usuario elige el grupo en Telegram. La lista se recarga al volver a la pestaña.
- **Detalle de un grupo**, con cuatro secciones:
  - **Filtros**: interruptor general; por filtro, activación y acción; números del flood.
  - **Palabras**: agregar y quitar.
  - **Lista blanca**: agregar y quitar, con ejemplos de formato.
  - **Historial**: quién, qué filtro, qué coincidió, resultado, marca de simulado y botón de desbanear.
- El texto del spam se muestra siempre como texto plano: sin `v-html` y sin enlaces clicables.
- Un aviso visible cuando la API está en `development`, para que nadie crea que los bans son reales.

## Acceso sin login y despliegue

La API no publica ningún puerto en ningún entorno: solo la alcanza el contenedor del panel, que hace proxy de `/api` hacia `bot:3000`.

- **Desarrollo:** el servidor de Vite tampoco publica puertos. Se entra por Traefik en `http://bot.localhost`, solo HTTP, sin certificado. Los servicios viven en la red externa `traefik`, como los demás proyectos.
- **Producción:** nginx con el build publica el puerto **únicamente en `127.0.0.1:8088`**, accesible solo por túnel SSH (por ejemplo, `ssh -L 9000:127.0.0.1:8088 servidor`). El 8080 lo ocupa el dashboard de Traefik.
- La API no habilita CORS, valida `Host` en toda petición y `Origin` en las escrituras, para que una página web maliciosa no pueda usar el navegador del dueño contra el panel. Acepta `bot.localhost`, `localhost`, `127.0.0.1` y `[::1]` en cualquier puerto. Vite y nginx reenvían el `Host` original del navegador.

Límite conocido: Traefik escucha en todas las interfaces de la máquina de desarrollo, así que alguien de la misma red local puede llegar al panel enviando ese `Host`. Se acepta en desarrollo, igual que los otros paneles de esa máquina, y se resuelve con el login.

Cambios de infraestructura:

- `compose.yml` y `compose.prod.yml`: `name: telegram-bot`, para que renombrar la carpeta no deje huérfano el volumen de la base; servicio `bot-front`; volumen con nombre `data` en `/app/data`.
- `compose.yml`: red externa `traefik` y labels del panel (un solo router, entrypoint `web`).
- `Dockerfile`: crear `/app/data` con dueño `node` antes de `USER node`, o la imagen de producción no podrá escribir la base.
- `.dockerignore`: agregar `front`, `data`, `docs`. `.gitignore`: agregar `data/`.
- `.env.example`: agregar `APP_ENV`, `API_PORT` y `DATABASE_PATH` (opcional).
- `config.ts`: `APP_ENV` obligatorio y validado.
- `index.ts`: cierre ordenado de bot, servidor HTTP y base de datos en `SIGINT`/`SIGTERM`.

## Cómo se prueba

Pruebas automatizadas sobre la lógica pura y la API con SQLite en memoria, sin llamar a Telegram. Casos obligatorios:

- `computadora` con la palabra `puta` no coincide; `año` con la palabra `ano` no coincide.
- `example.com.evil.com`, `evil.com/example.com` y `t.me/micanal2` no pasan la lista blanca.
- `text_link` con texto inocente se detecta como enlace.
- `/start https://spam.example` y una edición que agrega un enlace se detectan.
- Mensajes atrasados, procesados juntos al arrancar, no cuentan como flood.
- Las cuatro exenciones se respetan.
- El ban usa `banChatSenderChat` cuando el mensaje se envía como canal.
- La migración a supergrupo conserva configuración, palabras, lista blanca e historial.
- `APP_ENV=development` nunca llama a la API de ban.
- Un chat apagado no borra, no banea y no guarda texto.
- La purga conserva los bans vigentes sin texto y elimina los simulados y los ya deshechos.
- La API rechaza un `Host` no permitido.

Prueba manual en el grupo de prueba real, con los contenedores levantados:

1. El grupo aparece apagado en `http://bot.localhost` después de escribir un mensaje, y se enciende desde ahí.
2. Cada filtro actúa.
3. Con `APP_ENV=production` y una segunda cuenta: ban real y desbaneo desde el panel.

## A criterio de quien lo construya

- Estructura de carpetas, nombres y framework de pruebas.
- Esquema exacto de tablas y formato de respuestas de la API.
- Algoritmo y umbral de "muy parecido" en flood.
- Lista inicial de palabras, respetando que sea conservadora.
- Composición visual del panel dentro de shadcn-vue.
- Validar la instalación de `better-sqlite3` con pnpm, porque la prueba se hizo con `npm`. Si pnpm exige aprobar el build, agregarlo a `allowBuilds` en `pnpm-workspace.yaml`.

## Referencias

- [Privacidad y bots admin](https://core.telegram.org/bots/features)
- [FAQ de bots](https://core.telegram.org/bots/faq)
- [Bot API](https://core.telegram.org/bots/api)
- [shadcn-vue con Vite](https://www.shadcn-vue.com/docs/installation/vite)
