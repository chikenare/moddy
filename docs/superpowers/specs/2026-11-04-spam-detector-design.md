# Detector de spam y panel de moderación: diseño

Fecha: 2026-11-04. Estado: aprobado.

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

- Varias cuentas o roles en el panel: hay una sola cuenta, la del dueño.
- Comandos de Telegram para configurar (`/addword` y similares): la configuración se hace en el panel. Solo hay comandos para actuar sobre una persona.
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
- El panel tiene login con un usuario por defecto y contraseña aleatoria, que se cambia desde el propio panel.
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
| Acceso al panel en producción por dominio con HTTPS, detrás del Traefik de Dokploy | Queda expuesto a internet protegido solo por el login; por eso exige `PANEL_HOST`, obliga a cambiar la contraseña inicial y rechaza las más comunes |
| Login con usuario y contraseña guardados en SQLite, no en `.env` ni con Telegram | Un solo dueño; un error de configuración no para la moderación, y no depende de conocer su ID de Telegram |
| Se quita todo el flujo de compra (`/planes`, `/terms`, `/paysupport`, `/refund`), no solo la llamada a la API. El proyecto `playhubplus-api` no se modifica | Sin esa API no hay planes que vender. Sigue recuperable desde git |
| Nombre `moddy` para paquete, imagen y proyecto de Docker | Lo eligió el dueño |

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
- Una palabra repetida sin nada en medio también cuenta (`xd` coincide con `xdxdxd`, pero no con `sexdrive`). A cambio, una palabra muy corta como `pa` también coincidiría con `papa`.
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
| `GET /api/health` | Estado, sin datos del bot; público |
| `GET /api/auth/session` | Si hay sesión; público |
| `POST /api/auth/login`, `POST /api/auth/logout` | Abrir y cerrar sesión; públicos |
| `POST /api/auth/password` | Cambiar la contraseña; lo único disponible, además de lo público, hasta cambiar la inicial |
| `GET /api/info` | Entorno y usuario del bot |
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
| `GET /api/chats/:id/photo` | Foto del grupo (JPEG, en caché; 404 si no tiene) |
| `GET`, `POST /api/chats/:id/staff`, `DELETE /api/chats/:id/staff/:userId` | Listar, agregar y quitar personal exento |
| `GET`, `POST /api/chats/:id/auto-replies`, `PUT`, `DELETE /api/chats/:id/auto-replies/:replyId` | Respuestas automáticas |
| `GET`, `POST /api/messages`, `POST /api/messages/:messageId/cancel` | Mensajes del dueño a varios grupos, inmediatos o programados; listar y cancelar |
| `GET /api/recurring`, `GET /api/recurring/preview` | Mensajes recurrentes y vista previa de sus próximas ejecuciones |
| `POST /api/recurring`, `PUT`, `DELETE /api/recurring/:rid`, `POST /api/recurring/:rid/pause`, `POST /api/recurring/:rid/resume` | Crear, editar, borrar, pausar y reanudar una regla recurrente |
| `GET /api/metrics?days=7\|30\|90&chatId=...` | Estadísticas agregadas, globales o de un grupo |

Los envíos del dueño cuentan en las métricas (`broadcasts`) para cualquier grupo, estén o no activos, porque los mandó él a propósito.

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

## Comandos en Telegram

`/ban`, `/unban` y `/warn`, con un interruptor por grupo en el panel, apagado por defecto. Solo se atienden en mensajes nuevos de texto: no en ediciones, pies de foto, reenvíos ni mensajes de bots inline. `/ban@otro_bot` se ignora.

**Quién puede usarlos.** El creador, los admins con permiso de banear, los admins anónimos y la lista de staff. Un admin sin ese permiso recibe un aviso y ningún warn. Quien publica como canal sigue por los filtros normales, porque no se puede comprobar ni avisar. Si Telegram no permite comprobar quién lo pidió, no se hace nada ni se castiga a nadie.

**A quién apuntan.** A quien se nombra primero (`@usuario`, si el bot lo ha visto y Telegram confirma que sigue siendo suyo, o una mención sin usuario), luego al autor del mensaje respondido y, sin respuesta, a un ID numérico. En una respuesta, un número es parte del motivo. No cuentan como respuesta la automática de un tema de foro a su primer mensaje ni la de un comentario a la publicación del canal. Responder a un aviso de servicio apunta a la persona que entró si es una sola, nunca a quien la añadió; los demás avisos no tienen objetivo. Las confirmaciones muestran el ID, para que un error se vea enseguida. Lo que siga es el motivo, de hasta 200 caracteres.

**A quién no pueden tocar** `/ban` y `/warn`: admins, staff, quien lo pide, el propio bot, las cuentas de servicio de Telegram, los admins anónimos y el canal vinculado. Si no se puede comprobar al objetivo, no se hace nada. Estas protecciones también valen en desarrollo.

**Qué hacen.**

- `/ban` banea, y borra el comando y el mensaje respondido. Si el ban falla, el mensaje se queda como prueba.
- `/warn` suma un warn y borra solo el comando. Al llegar al límite banea y borra también el mensaje respondido.
- `/unban` levanta el ban, borra los warns y marca como deshechos los bans anteriores. El botón del historial también borra los warns.
- Sin permiso, cualquiera de los tres borra el comando y suma un warn a quien lo usó, con un aviso de como máximo uno cada 10 segundos por grupo. Al llegar al límite, le banea. Telegram convierte en botón cualquier `/comando` escrito en un mensaje, y tocarlo lo envía sin argumentos, dirigido al bot o como respuesta: eso solo borra el mensaje, sin warn, para que nadie pueda usarlo de cebo. Por eso los mensajes del bot nunca escriben un comando.

Los warns duran 30 días y el límite por grupo va de 1 a 20, con 3 por defecto. Todo queda en el historial con quién lo hizo y el motivo. En desarrollo los bans y desbaneos se simulan. Los mensajes del bot no usan formato ni repiten nombres que parezcan enlaces. Telegram muestra estos comandos en el menú solo a los admins, en todos los grupos, aunque estén apagados en alguno.

Límites conocidos de los comandos:

- Un admin sin permiso de banear puede activar el anonimato y usarlos, porque Telegram no revela quién es.
- Poner `/ban` delante de spam evita los filtros, a cambio de que el mensaje se borre y sume un warn, así que como mucho consigue un mensaje borrado por warn hasta el límite.
- En un grupo básico (no supergrupo), Telegram no admite `/unban` ni el botón de desbanear, y un ban podría no impedir volver por enlace de invitación.
- La lista de staff da estos poderes aunque la persona deje de ser admin, hasta que se la quite de la lista.

## Acceso, login y despliegue

**Login.** El primer arranque crea el usuario `admin` con una contraseña aleatoria y la muestra una sola vez en los logs, en la línea `Panel login`. En ese estado el servidor solo admite cambiarla: el resto de la API responde 403, y el panel lleva a `/change-password`. Después se cambia desde el panel (pide la actual, de 12 a 256 caracteres, sin repeticiones ni palabras comunes como `password1234`), y si se pierde, `node dist/scripts/reset-panel-password.js` dentro del contenedor genera otra, también de cambio obligatorio. No hay credenciales en el entorno, así que un error ahí no impide arrancar al bot ni para la moderación.

Toda la API exige sesión salvo `GET /api/health`, `GET /api/auth/session`, `POST /api/auth/login` y `POST /api/auth/logout`, con denegación por defecto y una prueba que recorre todas las rutas; los archivos del panel son públicos para poder mostrar el login. La sesión es la cookie `panel_session`, `HttpOnly`, `SameSite=Strict`, y `Secure` detrás de HTTPS, de 30 días. Cerrar sesión la termina en el servidor; cambiar o restablecer la contraseña termina todas, y el navegador que la cambia recibe una nueva.

SQLite guarda la contraseña como hash scrypt con sal propia (N=2^17, r=8, p=1, lo que recomienda OWASP) y el SHA-256 del token de cada sesión. Una copia de la base no permite usar sesiones, pero sí probar contraseñas sin conexión, y por eso se exige un mínimo de 12 caracteres y conviene proteger los respaldos. El hash se calcula de forma síncrona, bloquea el proceso unos 270 ms y usa 128 MB, así que el contenedor necesita al menos 192 MB; el límite de intentos lo acota a 10 cada 15 minutos. Un cambio de contraseña solo se guarda si la contraseña sigue siendo la que comprobó, para que no deshaga un restablecimiento hecho mientras tanto (responde 409).

Tras 10 intentos fallidos de login en 15 minutos, el login se bloquea para todos durante ese tiempo, sin afectar a las sesiones abiertas. Cambiar la contraseña tiene su propio contador con el mismo límite, para que nadie desde fuera pueda impedírselo al dueño. El cuerpo se lee antes de comprobar el límite, y la comprobación y el registro del fallo no ceden el control, así que un intento retenido a medio enviar también cuenta. El cuerpo de estas peticiones admite como máximo 4 KB. El inicio del bloqueo se registra en el log sin credenciales. Las escrituras vuelven a comprobar la sesión al recibir el cuerpo, porque pudo terminar mientras llegaba.

Límites conocidos del login:

- Con un dominio público, cualquiera en internet puede mantener el login bloqueado con 10 peticiones cada 15 minutos. No puede entrar ni afecta a las sesiones abiertas, y reiniciar el bot borra el bloqueo.
- Hasta el primer inicio de sesión, quien pueda leer los logs tiene la contraseña inicial. Basta con cambiarla nada más desplegar. Reemplazar el contenedor pierde esa línea del log, pero la cuenta sigue en el volumen, así que hay que usar el script.
- El script solo funciona dentro del contenedor, y no borra un bloqueo del login: para eso hay que reiniciar o esperar.
- Solo hay una cuenta, y su usuario no se puede cambiar.

En desarrollo la API no publica ningún puerto: solo la alcanza el contenedor del panel, que hace proxy de `/api` hacia `bot:3000`. En producción, el mismo proceso sirve la API y el panel.

- **Desarrollo:** el servidor de Vite tampoco publica puertos. Se entra por Traefik en `http://bot.localhost`, solo HTTP, sin certificado. Los servicios viven en la red externa `traefik`, como los demás proyectos.
- **Producción:** se despliega con Dokploy, con una sola imagen y un solo contenedor, en la red externa `dokploy-network` y sin publicar puertos. El propio bot sirve el panel ya compilado (`PANEL_DIR=/app/public`, con `index.html` como respaldo para las rutas del panel y caché inmutable para `/assets/`). El dominio se configura en la pestaña Domains de Dokploy, hacia el puerto 3000 con HTTPS, y debe coincidir con `PANEL_HOST`. Las variables se pasan una a una desde la pestaña Environment. El servidor admite 256 conexiones a la vez y 30 segundos por petición, y los logs rotan a 10 MB por 3 archivos.
- **Una sola réplica, con `order: stop-first`.** Telegram solo permite un proceso haciendo long polling por token: un segundo recibe `409` y el bot termina con error. Además, el contador de flood y el límite de login viven en memoria de cada proceso. Durante una actualización el bot se detiene unos segundos: Telegram guarda las actualizaciones pendientes y las entrega al volver, así que la moderación se retrasa, pero no se pierde nada. El volumen de SQLite tampoco sigue al contenedor a otro nodo, así que el despliegue es de un solo nodo. `update_config` solo aplica si Dokploy lo despliega como Stack.
- **Imagen.** GitHub Actions la construye para `linux/amd64` y `linux/arm64` tras pasar las comprobaciones. Cada push a `main` solo pasa las comprobaciones; la imagen se publica con una etiqueta `v1.2.3`, como `:1.2.3` y `:latest`, que es la que usa `compose.prod.yml` por defecto.
- La API no habilita CORS, valida `Host` en toda petición y `Origin` en las escrituras, para que una página web maliciosa no pueda usar el navegador del dueño contra el panel. Acepta `bot.localhost`, `panel.localhost`, `localhost`, `127.0.0.1` y `[::1]` en cualquier puerto, además del dominio de `PANEL_HOST`. Vite reenvía el `Host` original del navegador, y en producción lo hace Traefik. Todas las respuestas llevan `X-Frame-Options: DENY`, una `Content-Security-Policy` que solo admite scripts, peticiones y fuentes del propio panel y prohíbe incrustarlo en marcos, `X-Content-Type-Options: nosniff` y `Referrer-Policy: same-origin`.

Límite conocido: Traefik escucha en todas las interfaces de la máquina de desarrollo, así que alguien de la misma red local puede llegar a la pantalla de login enviando ese `Host`. Sin la contraseña no puede hacer nada, pero el tráfico va por HTTP sin cifrar: en una red no confiable, la contraseña y la sesión podrían interceptarse.

Cambios de infraestructura:

- `compose.yml`: `name: moddy`, para que renombrar la carpeta no deje huérfano el volumen de la base; en `compose.prod.yml` el nombre lo pone Dokploy; servicio `bot-front` solo en desarrollo; volumen con nombre `data` en `/app/data`.
- `compose.yml`: red externa `traefik` y labels del panel (un solo router, entrypoint `web`).
- `Dockerfile`: una etapa compila el panel desde `front/` y `prod` lo copia a `./public`; crear `/app/data` con dueño `node` antes de `USER node`, o la imagen de producción no podrá escribir la base.
- `.dockerignore`: agregar `data`, `docs`, `front/node_modules` y `front/dist`. `.gitignore`: agregar `data/`.
- `.env.example`: agregar `APP_ENV`, `API_PORT` y `DATABASE_PATH` (opcional).
- `config.ts`: `APP_ENV` obligatorio y validado.
- `index.ts`: cierre ordenado de bot, servidor HTTP y base de datos en `SIGINT`/`SIGTERM`.

## Panel completo

El dueño pidió un panel más completo. Valoró un modelo SaaS y lo descartó, así que sigue siendo para un solo dueño.

- **Mensajes recurrentes:** expresión cron y zona horaria, con opciones simples en la interfaz. Mínimo 5 minutos entre envíos para que el bot no inunde un grupo. Cada ejecución crea un mensaje programado normal, y así reutiliza envío, historial y protección contra duplicados. Con el bot parado, las ejecuciones perdidas se reducen a una, que se descarta si lleva más de una hora de retraso.
- **Formato de Telegram** en auto replies, mensajes y reglas, guardado como texto y entidades.
- **Fotos de grupos:** por proxy en la API con caché de una hora, porque la URL de archivos de Telegram contiene el token del bot.
- **Navegación lateral y modo oscuro.**
- **Métricas:** contadores diarios por chat, sin guardar contenido, solo en chats con alguna función encendida.

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
