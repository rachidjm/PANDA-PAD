# Ecosistema de Telegram de PANDA

Bot de Telegram dentro del propio proyecto (Next.js en Vercel), por **webhook**, detrás de `FEATURE_TELEGRAM_BOT` (apagado por defecto). Este documento cubre la Fase 1 (Bloque 1, ya programado), prepara las Fases 2 y 3 (solo diseño) y el Bloque 2.

---

## 0. Inspección y verificación de datos

Antes de programar se revisó el repositorio y se comprobó **cada dato con una consulta real de solo lectura** (contra la web pública de PANDA, Dexscreener y GeckoTerminal, y llamando a las funciones del propio proyecto desde una máquina local sin base de datos). Fecha de la comprobación: 2026-10-09.

| Dato | Fuente en el código | Refresco | Fiabilidad | Comprobación real | Uso |
|---|---|---|---|---|---|
| Precio, cap. de mercado, liquidez, 24 h de **una** moneda | `getLiveCoin(mint)` (`src/lib/live-coins.ts`): GeckoTerminal + Dexscreener + Pump.fun, igual que la ficha de la moneda en la web | En cada consulta (caché de Next ~20–60 s) | Alta. En monedas de la curva, la liquidez solo la da GeckoTerminal (`reserve_in_usd`); Dexscreener la deja vacía | $PANDA: precio 0,00000317 $, cap. 3.177 $, liquidez 2.507 $, pool `ARijaU8…mU8` (coinciden Dexscreener y GeckoTerminal) | `/token` |
| Lista de monedas (volumen 24 h, cap.) | `getLiveCoins()`: caché compartida en Upstash que el cron `warm-coins` refresca **cada minuto** | 1 min | Alta (la misma que ve la portada) | 20 monedas, todas con volumen y cap.; top por volumen: TIKTOK, HEEHAW, PQC | `/trending` (= orden "trending" de la portada: volumen 24 h) |
| Búsqueda por ticker | `searchLiveCoins(q)` (búsqueda de GeckoTerminal) | En cada consulta | **Ambigua**: buscar "PANDA" devuelve otras monedas llamadas PANDA (p. ej. 2bN9Yo…, 76K $) y **no** la oficial | Confirmado | `/token <ticker>` lista varias con su dirección y un aviso; "PANDA" siempre es la oficial. `/watch` y `/alert` solo aceptan direcciones |
| Precio y cap. de **muchas** monedas a la vez | `fetchDexTokensBatch` (Dexscreener, 30 por llamada) | En cada ronda del cron (1/min) | Alta para monedas con par en Dexscreener | 2 tokens consultados, 2 pares devueltos | Alertas y `/watchlist` |
| Monedas **lanzadas en PANDA** | Tabla `panda_launches` (se escribe en `/api/launch/record` solo tras verificar el lanzamiento en la cadena) | Al lanzar | Alta (verificada en la cadena) | La lista pública ahora mismo no tiene ninguna marcada (la creación está en pausa). `/api/launches` **no** sirve: es el feed general de Pump.fun | Publicación "New coins" y `/new` |
| Reparto de comisiones de una moneda | `getFeeSharingConfig` (cuenta `SharingConfig` de Pump.fun en la cadena) | Lectura directa | Máxima (es el dato de la cadena) | $PANDA: 5 % tesorería PANDA, 30 % `35gHk…`, 65 % `5BKt…` | Publicación "New coins" |
| **Compras de $PANDA** | GeckoTerminal `pools/<pool>/trades` (`fetchPoolTradesStrict`) | GeckoTerminal indexa con ~1 min de retraso | Buena: trae tipo (compra/venta), importe en $, SOL, wallet y hash de la transacción. Fuente de terceros: si falla, no se pierde nada (el cursor no avanza) | 72 operaciones en 20 h; la última, de hace 2 h 15 min (coherente con la poca actividad) | Publicación de compras ≥ `TELEGRAM_MIN_BUY_USD` |
| **Pagos a holders** | Tabla `holder_payout_runs` (la escribe el cron `collect-fees` tras confirmar en la cadena) | Cada 5 min (cron) | Alta. **Todavía no ha habido ningún pago** (`/api/rewards/mint-summary` de $PANDA: 0) | Fuente comprobada; sin eventos aún | Resumen horario: estará en silencio hasta el primer pago |

**Por qué las compras salen de GeckoTerminal** (y no de un webhook de Helius ni de leer la cadena):
- Es lo más barato: una sola llamada por minuto, gratis, y el proyecto ya usa GeckoTerminal.
- Es fiable: trae el hash de la transacción (sirve para no repetir y para enlazar a Solscan) y el importe ya en dólares.
- Alternativas descartadas por ahora:
  - **Webhook de Helius:** más inmediato, pero necesita una cuenta y una clave nuevas.
  - **Leer la cadena:** obliga a descifrar cada transacción y gasta mucho más RPC.
- Si en el futuro se quiere inmediatez real, se puede cambiar a Helius sin tocar nada más (`trades` es una dependencia inyectada).

**Descartado o ajustado por falta de datos fiables:**
- **"Trending" real** (por momentum o redes sociales): no existe esa fuente. `/trending` es honesto y dice exactamente lo que es: las monedas más operadas por volumen de 24 h, con el aviso "no es una recomendación".
- **Alertas y seguimiento por ticker:** los tickers no son únicos y facilitan las estafas por imitación. Solo se aceptan direcciones de contrato.

**Infraestructura existente reutilizada (inspección):**
- Next.js 16 (App Router) en Vercel. Postgres (Neon) con Drizzle; migraciones numeradas en `drizzle/`.
- Upstash Redis para la caché de monedas y los límites de peticiones (`src/lib/rate-limit.ts`).
- Crons en `vercel.json`: `collect-fees` (5 min), `cleanup-auth` (diario), `warm-coins` (1 min), `panda-orders` (1 min) y ahora `telegram` (1 min).
- Flags `FEATURE_*` (`src/lib/config/flags.ts`).
- Pausas de emergencia por subsistema (`src/lib/protocol/pause.ts`): se añade `telegram`.
- Auditoría encadenada (`recordAudit`).
- Sesiones de wallet (`src/lib/auth`).
- Precios, cap. y liquidez (`live-coins`, `strategy/market`).
- Referidos por `?ref=<wallet>` / `?code=<código>`.

---

## 1. Migraciones y bases de datos (adenda A)

- **Quién aplica migraciones:**
  - `scripts/vercel-build.ts` (lo que ejecuta Vercel al construir), **solo** si `VERCEL_ENV=production` y hay `DATABASE_URL(_UNPOOLED)`. Se aplica contra la base de datos de **Producción** y, si falla, el deploy no sale.
  - `npm run db:migrate`, a mano. Lee `.env.local`.
  - Nada más. `next build` por sí solo **no** migra. `npm run db:generate` (drizzle-kit) no conecta con ninguna base de datos.
- **Local:**
  - `.env.local` no contiene `DATABASE_URL` ni claves de Blob, KV o Redis (solo nombres comprobados, nunca valores), así que ni el build local ni los tests pueden llegar a producción.
  - Los tests usan Postgres en memoria (PGlite, `src/lib/db/testing.ts`) con las migraciones reales aplicadas.
  - La prueba con Postgres real (`concurrency.real.test.ts`) solo corre si se define `TEST_DATABASE_URL`.
  - Ningún test lee `.env.local`: el script `test` es `tsx --test` sin `--env-file`.
- **Migración nueva:** `drizzle/0014_telegram.sql`. Solo `CREATE TABLE` y `CREATE INDEX` (8 tablas nuevas): no modifica ni borra nada existente. Se aplicará sola en el primer deploy de producción después de fusionar en `main`.
- **Los deploys de Preview usan la base de datos de PRODUCCIÓN.**
  - En Vercel, `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, las variables `KV_*` y el token de Blob están definidas **una sola vez para "Preview, Production"**: el mismo valor.
  - Un preview no aplica migraciones (no es producción), pero su código lee y escribe en la base de datos real.
  - Por eso esta rama **no se sube**: GitHub → Vercel crearía un preview conectado a producción con un esquema que aún no existe allí.
  - Recomendación: crear una rama de Neon para Preview, o quitar Preview de esas variables.

---

## 2. Arquitectura (las 3 fases)

```
Telegram ──webhook──▶ /api/telegram/webhook ──▶ updates.ts (valida) ──▶ commands.ts ──▶ telegram_outbox
                         ▲ cabecera secreta                                                  │
                         │                                    /api/cron/telegram (1 min) ────┤
Fuentes verificadas ─────┘  launches · $PANDA buys · payouts · alerts ──▶ feeds.ts/alerts.ts ┘
                                                                                             ▼
                                                                    queue.ts ──▶ api.ts ──▶ Bot API
Web (launchonpanda.app): /telegram/link (firma) · /admin → TelegramPanel · /api/admin/telegram
```

- **Una sola salida:** todo lo que el bot envía pasa por `telegram_outbox`, con reintentos (15 s, 30 s, 1 min… hasta 1 h; 6 intentos) y `retry_after` de Telegram en los 429. El ritmo respeta los límites: ~25 mensajes/s en total, 1/s por chat privado y 20/min por grupo o canal, medidos en la base de datos.
- **Telegram nunca bloquea PANDA:** las publicaciones automáticas solo leen fuentes y encolan; no hay ningún gancho dentro del flujo de lanzamientos, operaciones ni pagos. Si Telegram cae, los mensajes esperan en la cola.
- **Idempotencia:**
  - Cada `update_id` se procesa una vez (`telegram_updates`).
  - Cada evento automático lleva una clave única: `launch:<mint>`, `buy:<tx>`, `payouts:<hora>`, `alert:<id>`.
  - Las primeras ejecuciones arrancan "desde ahora": nunca inundan el grupo con el historial.
- **El token** solo existe en el servidor (`src/lib/telegram/api.ts`). Nunca se registra en logs ni se devuelve, y los errores de red no se repiten tal cual porque la URL contiene el token.
- **Idioma:** inglés por defecto y español si `language_code` empieza por "es". Las publicaciones en grupo y canal van en inglés.
- **Sin promesas:** nunca subidas, ganancias, recompensas ni funciones futuras. "Not financial advice / No es asesoramiento financiero" en `/token`, `/trending`, `/new`, compras y lanzamientos.

**Fase 2 (trading desde Telegram) — solo diseño, nada implementado:**
1. **Flujo sin custodia.** El bot nunca firma ni guarda claves:
   - `/buy <mint> <importe>` crea una **intención** en la tabla `telegram_intents`: id, `telegram_id`, wallet vinculada, operación, importe, slippage, comisión calculada con las mismas reglas que la web (`feeBpsForWallet`, referidos), caducidad de 2 minutos y un solo uso.
   - El bot responde con el resumen ("Comprar 0,5 SOL de $X · comisión 1 % · slippage 5 %") y un botón **Confirmar** que abre la web o la Mini App con la intención.
   - Allí la wallet del usuario firma la transacción construida por las mismas rutas que la web (`/api/pump/buy`, `/api/pump/sell`, Jupiter). Mismas comisiones, mismos límites, mismas pausas.
2. **Opciones de wallet dentro de Telegram:**
   - **Deep links de Phantom** (`phantom.app/ul/v1/connect` y `signAndSendTransaction`, con intercambio de claves cifrado y `redirect_link` de vuelta a `t.me/<bot>`). Sin custodia: Phantom firma en el móvil del usuario. Es la opción recomendada. Implica guardar la sesión cifrada de Phantom por usuario y gestionar el ida y vuelta entre apps.
   - **Navegador de la web** (botón que abre `launchonpanda.app` fuera de Telegram) con el adaptador de wallets ya existente. Es lo más simple y lo que usa la vinculación de la Fase 1.
   - **Wallets embebidas (Privy, Turnkey).** El usuario no instala nada, pero las claves (o fragmentos MPC) las gestiona un tercero ligado a la cuenta de Telegram. Es custodia o semicustodia, con implicaciones regulatorias (MiCA y servicios de custodia), un tercero más en el que confiar y un riesgo enorme si se roba la cuenta de Telegram (SIM swap). **No se recomienda** para PANDA, cuyo diseño es no custodial.
3. **Protección:**
   - Cada intención solo puede firmarla la wallet vinculada a esa cuenta de Telegram.
   - Confirmación explícita con importe y comisión antes de firmar.
   - Límite de intenciones por minuto.
   - Nunca se envía nada sin la firma del usuario.

**Fase 3 (Mini App) — solo diseño:**
- **Dónde vive:** dentro de la web actual, en rutas `/tg/*`, con los mismos componentes adaptados al viewport de Telegram.
- **Autenticación:**
  - El cliente envía `Telegram.WebApp.initData` y el servidor la valida.
  - Clave secreta: `HMAC_SHA256(key="WebAppData", data=bot_token)`.
  - Comprobación: `hash == HMAC_SHA256(secret, data_check_string)` (campos ordenados, separados por `\n`, sin `hash`) y `auth_date` de hace menos de 1 hora.
  - Con eso se emite una sesión **de Telegram**: cookie con el `telegram_id`, no la wallet. La wallet sigue necesitando su propia firma y su vinculación (Fase 1).
- **CSP:**
  - Para `/tg/*`, permitir `https://telegram.org/js/telegram-web-app.js` en `script-src`.
  - Permitir `frame-ancestors` de `web.telegram.org` (en Telegram Web la Mini App va en un iframe; en el móvil, en un WebView).
  - El resto de la web no cambia.
- **Wallet dentro del navegador de Telegram:**
  - El WebView de Telegram no tiene la extensión de Phantom ni el Mobile Wallet Adapter.
  - Se conecta y se firma con los deep links de Phantom (ver Fase 2), que devuelven a la Mini App con `startapp=<intent>`.
  - En escritorio o Telegram Web se puede ofrecer abrir la web normal.
- **Sin rehacer nada:**
  - Fase 2 añade `telegram_intents` y una ruta que lee las intenciones.
  - Fase 3 añade `/tg/*` y la validación de `initData`.
  - Las tablas de la Fase 1 (usuarios, vinculación, cola) se reutilizan tal cual.

---

## 3. Modelos de datos (migración 0014)

| Tabla | Para qué | Datos personales |
|---|---|---|
| `telegram_users` | ID numérico, idioma, **una** wallet vinculada (única), si ha bloqueado al bot | Solo el ID de Telegram y la wallet si la vincula. **No** se guardan nombre, @usuario, teléfono ni mensajes |
| `telegram_link_codes` | Códigos de `/link`: **solo el SHA-256**, ID de Telegram, creación, caducidad (10 min), uso | — |
| `telegram_watchlist` | (ID, mint), máximo 20 por usuario | — |
| `telegram_alerts` | Alerta de precio o cap.; salta **una vez** (`fired_at`); máximo 10 activas por usuario | — |
| `telegram_outbox` | Cola de envío con reintentos y clave única por evento | El texto enviado (se borra a los 14 días) |
| `telegram_updates` | `update_id` ya procesados (se borran a los 2 días) | Ninguno |
| `telegram_state` | Cursores de las publicaciones automáticas | — |
| `telegram_suggestions` | Texto de `/suggest` (1–1000 caracteres; 5 al día por usuario), visible en `/admin` | El texto y el ID |

---

## 4. Vinculación Telegram ↔ wallet (adenda B)

**Revisión del sistema de sesiones existente:**
- `src/lib/auth/wallet-auth.ts` y `session.ts`: reto de un solo uso (nonce de 16 bytes, 5 min, guardado en Postgres), mensaje que el servidor **reconstruye** desde su propio registro (dominio, wallet, nonce, emitido, caduca), verificación ed25519 y quema atómica del nonce.
- Es buen diseño, pero **no sirve tal cual**: el mensaje no nombra la cuenta de Telegram, así que una firma de inicio de sesión podría "vincular" cualquier cuenta.
- **Se adapta así:** mismo patrón y misma verificación (`verifyEd25519`), con un mensaje y una tabla propios.

**El mensaje firmado incluye:**
- Dominio (`launchonpanda.app`).
- Wallet.
- **ID de Telegram.**
- **Código.**
- Si reemplaza otra vinculación (sí o no).
- Fecha de emisión y de caducidad.
- La frase "nunca pedirá tu frase semilla ni tu clave privada".

**El servidor:**
1. Reconstruye ese mensaje con **sus** datos: ID y fechas del registro del código, y dominio de su configuración. Si el usuario firmó algo distinto (otro ID, otro dominio, otro código, otro valor de "reemplazar"), la firma no coincide.
2. Comprueba la firma ed25519 de esa wallet.
3. En **una transacción**, quema el código solo si sigue sin usar, no ha caducado y pertenece a ese ID de Telegram, y vincula. Un segundo uso falla.
4. Si la wallet ya está vinculada a **otra** cuenta: responde 409 sin gastar el código. La web avisa y pide **firmar otra vez** con "Reemplazar: sí". La cuenta anterior recibe un aviso por privado.

Tests que **deben fallar** (y fallan) en `src/lib/telegram/link.test.ts`: firma reutilizada, código reutilizado, código caducado, firma de otra wallet, ID de Telegram cambiado, mensaje de otro dominio, código cambiado, firma de "no reemplazar" usada para reemplazar, y datos basura.

---

## 5. Comandos

| Comando | Dónde | Notas |
|---|---|---|
| `/start [ref_<wallet o código>]` | Privado y grupo | Bienvenida. Con código de reclutador: botón a `launchonpanda.app/?ref=…` o `?code=…` (la web lo aplica, como hoy) |
| `/help` | Privado y grupo | |
| `/new` | Privado y grupo | Últimas monedas de `panda_launches` |
| `/trending` | Privado y grupo | Volumen 24 h de la caché (sin llamadas extra) |
| `/token <CA o ticker>` | Privado y grupo | Por ticker: lista con aviso; "PANDA" = la oficial |
| `/watch`, `/unwatch`, `/watchlist` | Solo privado | Solo direcciones; máximo 20 |
| `/alert <CA> price\|mcap above\|below <valor>`, `/alert remove <n>`, `/alerts` | Solo privado | Máximo 10; salta **una vez**; rechaza un nivel ya alcanzado; nunca salta con un dato ausente |
| `/link`, `/unlink` | Solo privado | Código de un solo uso, 10 min; como mucho 5 por hora |
| `/suggest <texto>` | Privado y grupo | Se guarda y se ve en `/admin` |
| `/chatid` | Solo `TELEGRAM_ADMIN_IDS` | ID del chat y del tema. Para el **canal**: reenvía al bot por privado un mensaje del canal |
| `/stats` | Solo `TELEGRAM_ADMIN_IDS` | Usuarios, vinculaciones, alertas, cola y actualizaciones recibidas en 1 h |

**Límites y validación:**
- 20 comandos por minuto por usuario de Telegram; al pasarse, un aviso y después silencio.
- Cuerpo del webhook de 64 KB como máximo y texto de 4096 caracteres como máximo.
- Cada campo se valida.
- Los mensajes de bots se ignoran, igual que los comandos dirigidos a otro bot.

Los comandos se registran con `setMyCommands` (EN y ES) desde `/admin`. Los comandos de admin no se publican.

---

## 6. Bloque 2: leer solo el tema "Suggestions"

**Qué recibe un bot en un grupo** (documentación de Telegram, "Privacy mode"):
- **Con el modo privacidad activado** (el valor por defecto, que se cambia en @BotFather → Bot Settings → Group Privacy), el bot solo recibe:
  - los comandos dirigidos a él (`/cmd` y `/cmd@bot`);
  - las **respuestas a sus propios mensajes**;
  - los mensajes de servicio.
- **Un bot administrador del grupo recibe TODOS los mensajes**, tenga o no el modo privacidad. No hay forma de suscribirse a un solo tema: con el modo privacidad apagado o siendo administrador, el bot recibiría todas las conversaciones de todos los temas.

**Diseño recomendado para el Bloque 2** (sin recopilar el resto de conversaciones):
1. El bot **no** es administrador del grupo y mantiene el modo privacidad **activado**.
2. En el tema "Suggestions" el bot publica y fija un mensaje: "Responde a este mensaje con tu sugerencia". Las respuestas a un mensaje del bot sí le llegan con el modo privacidad activado.
3. También vale `/suggest <texto>` en cualquier tema.
4. El webhook procesaría solo los mensajes con `message_thread_id == TELEGRAM_TOPIC_SUGGESTIONS` que sean respuesta a ese mensaje del bot. Cualquier otro se descarta sin guardar nada.

**Implicaciones:**
- Para fijar el mensaje hace falta que un administrador humano lo fije, porque el bot no es administrador.
- Si algún día se hace administrador al bot (por ejemplo, para moderar), empezará a recibir todos los mensajes del grupo. El código seguiría descartándolos sin guardarlos, pero llegarían a los servidores de PANDA.

**Prueba real (para hacer en Telegram cuando el bot esté activo):**
1. En @BotFather → Bot Settings → Group Privacy, confirma que está **Enabled**.
2. Añade el bot al grupo de pruebas con temas **sin** hacerlo administrador.
3. Como admin, escribe `/stats` al bot por privado y apunta "Actualizaciones recibidas (1 h)". Solo se cuentan IDs, nunca se guarda contenido.
4. En el grupo, escribe un mensaje normal en "General" y otro en "Suggestions" sin mencionar al bot.
5. Repite `/stats`: el número debe haber subido **solo por los comandos que tú mismo has enviado al bot** (cada `/stats` cuenta uno), no por los dos mensajes normales.
6. Escribe `/suggest prueba` en el grupo: debe subir en 1 y la sugerencia debe aparecer en `/admin`.
7. Responde en el grupo a un mensaje del bot: debe subir en 1, porque las respuestas a sus mensajes llegan.
8. Para comparar: haz al bot administrador, repite el paso 4 y comprueba que **sí** suben los mensajes normales. Después **quítale** el rol de administrador.

---

## 7. Puesta en marcha paso a paso (después de aprobar y fusionar en `main`)

1. **@BotFather:**
   - `/newbot`, y apunta el @usuario y el token.
   - `/setprivacy` → Enable.
   - `/setjoingroups` → Enable (solo para añadirlo a vuestro grupo; se puede volver a desactivar después).
2. **Vercel → Settings → Environment Variables (Production):**
   - `TELEGRAM_BOT_TOKEN`: el token, como **Sensitive**.
   - `TELEGRAM_WEBHOOK_SECRET`: **ya está creada** (Sensitive, generada aleatoriamente y sin mostrar).
   - `TELEGRAM_BOT_USERNAME`: sin @.
   - `TELEGRAM_ADMIN_IDS`: tu ID numérico. Puedes saberlo con @userinfobot o con `/chatid` por privado cuando el bot funcione: el ID del chat privado es tu ID.
   - `TELEGRAM_MIN_BUY_USD`: opcional; por defecto 20.
3. **Fusionar en `main`.** El build de producción aplica la migración 0014 y despliega con el bot **apagado**.
4. **Encender:** poner `FEATURE_TELEGRAM_BOT=true` y redeplegar.
5. **`/admin` → Bot de Telegram:**
   - "Cargar estado": token "set", secreto "set" y el @usuario que devuelve Telegram.
   - "Registrar webhook": registra `https://launchonpanda.app/api/telegram/webhook` con el secreto y solo actualizaciones `message`.
   - "Registrar comandos (EN + ES)".
6. **Obtener IDs:**
   - Escribe `/start` al bot por privado.
   - Añádelo al grupo (sin administrador) y escribe `/chatid` en cada tema: obtienes el ID del grupo y el `message_thread_id` de cada tema.
   - Para el **canal**: añade el bot como administrador del canal (necesario para publicar), publica algo y **reenvíaselo al bot por privado**; te responde con el ID del canal.
7. **Rellenar en Vercel** y redeplegar: `TELEGRAM_GROUP_ID`, `TELEGRAM_CHANNEL_ID`, `TELEGRAM_TOPIC_NEW_COINS`, `TELEGRAM_TOPIC_BUYS`, `TELEGRAM_TOPIC_PAYOUTS`, `TELEGRAM_TOPIC_SUGGESTIONS`.
8. **Probar:**
   - `/token PANDA`, `/trending`, `/new`.
   - `/watch <CA>` y `/alert <CA> mcap above <valor>`.
   - `/link`: abre el enlace, conecta la wallet y firma.
   - `/stats`.
   - Un anuncio de prueba desde `/admin`: primero "Vista previa" y luego "Enviar al canal".
9. **Página legal:** con el flag encendido, la Política de Privacidad muestra la sección del bot.

---

## 8. Mantenimiento, costes y cómo apagarlo

**Mantenimiento:**
- En `/admin` → Bot de Telegram: estado del webhook (actualizaciones pendientes y último error de Telegram), la cola (pendientes, fallidos, enviados en 24 h) y las sugerencias.
- Los errores del cron salen en los logs de Vercel como `[PANDA telegram]`, sin contenido de usuarios.
- Limpieza automática diaria: actualizaciones procesadas (2 días), códigos de vinculación (1 día tras caducar), mensajes enviados o fallidos (14 días), alertas ya saltadas (30 días).

**Costes:**
- Bot API de Telegram: gratis.
- Vercel: un cron por minuto (unas 43.000 invocaciones al mes). Con el flag apagado responde al instante y no hace nada.
- Neon: unas pocas filas pequeñas.
- GeckoTerminal: +1 llamada por minuto (compras de $PANDA), dentro del plan gratuito.
- Dexscreener: 1 llamada por minuto por cada 30 monedas con alertas o en listas de seguimiento.
- Ningún servicio nuevo de pago.

**Apagarlo:**
- **Al instante, sin deploy:** `/admin` → Pausas → "El bot de Telegram". El webhook responde OK sin hacer nada y el cron no envía.
- **Del todo:** `FEATURE_TELEGRAM_BOT=false` y redeploy. El webhook pasa a responder 404 y el cron se salta.
- **Que Telegram deje de llamar:** `/admin` → "Quitar webhook".
- **Revocar el bot:** @BotFather → `/revoke` del token.
