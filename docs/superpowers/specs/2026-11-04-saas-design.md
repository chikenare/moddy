# SaaS y panel completo: diseño

Fecha: 2026-11-04. Extiende `2026-11-04-spam-detector-design.md`; donde se contradigan, manda este documento.

## Por qué

El dueño quiere revender el bot como servicio: cualquier administrador de un grupo de Telegram entra al panel con su cuenta, configura sus grupos y paga un plan. Pidió además un panel completo con métricas, mensajes recurrentes y fotos de los grupos, porque hoy lo siente vacío. Autorizó avanzar sin más preguntas, así que las decisiones de producto de abajo son del diseñador y el dueño puede cambiarlas.

## Objetivos

- Login con Telegram, sin contraseñas.
- Multi-inquilino: cada usuario ve y cambia solo los chats que administra.
- Planes con límites, editables desde un panel de administración de plataforma.
- Métricas por usuario, por chat y de toda la plataforma.
- Mensajes recurrentes y formato de Telegram en mensajes y reglas.
- Fotos de grupos y una interfaz más completa con navegación lateral.
- Despliegue público con HTTPS por Traefik.

## No objetivos (por ahora)

- Cobro automático. El dueño dijo que las suscripciones irán con su backend propio más adelante: los planes se asignan a mano y queda el punto de integración.
- Un bot por cliente (marca blanca) y equipos o roles dentro de una cuenta.
- Webhooks, Postgres o varias instancias. Un proceso con SQLite y long polling alcanza para empezar.
- Textos legales: las páginas de términos y privacidad existen, pero su contenido lo aporta el dueño.
- Traducciones. Todo en inglés.

## Anti-objetivos: esto sería un fracaso aunque funcione

- Que un usuario vea o cambie datos de un chat que no administra, por cualquier ruta.
- Que una ruta de la API quede sin autenticación por descuido.
- Que el token del bot llegue al navegador o a los logs.
- Que un enlace de login enviado por un atacante le dé acceso a la cuenta de la víctima.
- Que un admin degradado en Telegram conserve permisos de escritura.
- Que los límites de plan sancionen o borren algo sin que el usuario lo vea.
- Romper lo que ya funciona: moderación, staff, reglas, auto replies y mensajes.

## Decisiones del diseñador

| Decisión | Motivo |
| --- | --- |
| Login por enlace al bot: el panel abre `t.me/<bot>?start=login_<token>`, el bot pide confirmar con un botón y el panel recibe la sesión | Funciona en cualquier dominio, también `bot.localhost`. El widget oficial exige un dominio público y HTTPS |
| El bot muestra quién inicia sesión y exige pulsar "Confirm" | Sin eso, enviar un enlace a una víctima daría acceso a su cuenta |
| Sesión en cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción, 30 días, guardada con hash | El navegador no necesita leerla; una copia de la base no da acceso |
| Puede gestionar un chat quien es `creator` o admin con `can_restrict_members` en Telegram | Quien no puede banear en Telegram no debe controlar la moderación |
| Lectura desde la tabla `chat_admins`; escritura con comprobación en vivo, cacheada 60 s | Listar chats no puede llamar a Telegram por cada uno, pero un admin degradado debe perder el acceso rápido |
| `ADMIN_IDS` en `.env` define a los administradores de plataforma | Ya existe en el `.env` del dueño y no debe poder cambiarse desde la web |
| El primer admin que enciende funciones en un chat es su dueño, y ese chat cuenta en su plan. Si deja de ser admin, otro puede reclamarlo | Los límites necesitan a quién cobrarle |
| Planes en base de datos, editables en el panel, con valores iniciales Free, Pro y Business | "Todo configurable desde la UI", y los precios los decide el dueño |
| Un plan vencido baja a Free y se apagan los chats que exceden el límite, empezando por los más nuevos; el usuario lo ve en su cuenta | El servicio debe poder dejar de prestarse si no se paga, sin borrar configuración |
| Suspender a un usuario apaga sus chats y corta sus sesiones | Herramienta mínima contra abuso |
| Mensajes recurrentes con expresión cron y zona horaria, con opciones simples en la interfaz. Mínimo 5 minutos entre envíos | Es lo que pidió el dueño, sin permitir que el bot inunde un grupo |
| Cada ejecución recurrente crea un mensaje programado normal | Reutiliza envío, historial, reintentos y protección contra duplicados |
| Las métricas se guardan como contadores diarios por chat, no como mensajes | Bastan para las gráficas y no guardan contenido |
| Foto del grupo por proxy en la API con caché | La URL de archivos de Telegram contiene el token del bot |
| La interfaz sigue en inglés y con shadcn-vue; navegación lateral y modo oscuro | Continúa lo ya construido |

## Límites iniciales de los planes

Editables desde el panel. `∞` significa sin límite.

| Plan | Chats | Auto replies por chat | Recurrentes | Mensajes al mes |
| --- | --- | --- | --- | --- |
| Free | 1 | 3 | 0 | 10 |
| Pro | 5 | 50 | 20 | 1000 |
| Business | ∞ | ∞ | ∞ | ∞ |

## Límite conocido

Con el servicio abierto, cualquiera puede agregar el bot a su grupo y registrarse. Telegram limita el envío por bot, y un solo proceso atiende a todos, así que hay que vigilar la carga al crecer. El dueño debe además aportar términos y política de privacidad antes de vender, porque el historial guarda texto de mensajes de terceros durante 90 días. Cobrar por funciones digitales dentro de Telegram puede exigir Telegram Stars según sus reglas; conviene revisarlo cuando se haga el cobro.
