# PANDA — Fase 6: infraestructura para dinero de terceros (PLAN, nada ejecutado)

**Estado:** decisiones tomadas (Neon, Drizzle; Upstash fail-closed en dinero / fail-open en lectura; los dominios apagados se migran cuando se enciendan). **Punto 1 (Postgres) implementado, pendiente de tu revisión** (§1). **Punto 2 (Upstash) implementado** (§2). Los puntos 3–5 no están empezados.
**Por qué existe:** hoy la persistencia es Vercel Blob (JSON con bloqueo optimista por ETag), el rate limiting vive en la memoria de
cada instancia, la auditoría es de solo-añadir *por convención* en archivos legibles por URL, las sesiones no se pueden revocar antes
de 2 h y el CSP no controla `script-src`. Con dinero de terceros (`FEATURE_HOLDER_REWARDS`, claims, y más adelante estrategias,
airdrops o NFT) ninguno de los cinco es aceptable a escala.

> **(sin verificar)** = precio, límite o comportamiento de un proveedor que no puedo comprobar desde el código. Las cifras de coste son
> **órdenes de magnitud** de memoria; confírmalas en la página de precios de cada uno antes de decidir. Los esfuerzos son **estimaciones
> mías en días de trabajo**, sin contar tu revisión ni la espera de observación.

---

## Estado final (2026-09-26): fase 6 cerrada en producción

| Punto | Estado |
|---|---|
| 1. Blob → Postgres | **Hecho.** Los siete dominios (`rewards, trades, activity, pause, audit, sessions, launch`) en `postgres`. Blob queda para imágenes/metadatos y para los archivos de funciones apagadas (puntos, airdrops, ramas, temas/NFT, estrategias, abuso), que migrarán cuando se enciendan. Las copias congeladas de Blob de los siete dominios se conservan 30 días como vuelta atrás; **borrarlas es decisión tuya**, con `npm run blob:purge` (simulación por defecto; ver `docs/DEPLOY_CHECKLIST.md` §4.3). |
| 2. Upstash | **Hecho y verificado** contra Upstash real (camino feliz, formato de duración, ~4 ms, contador atómico compartido). Rutas de dinero fallan cerradas; lecturas, inicio de sesión y admin abiertas. |
| 3. Auditoría con hash-chain | **Hecho.** Cadena verificada (21/21 eventos), triggers append-only en la base, anclaje en Solana con memo firmado por la wallet admin (0 anclajes hechos todavía). |
| 4. Sesiones revocables + limpieza de nonces | **Hecho.** `sessions=postgres`: un token vale solo mientras su fila esté viva; cerrar sesión y "cerrar todas" revocan de verdad; cron diario de limpieza. |
| 5. CSP con nonces | **Hecho en modo `report-only`** (por defecto). Para aplicar: revisar `/admin` → informes CSP tras 1–2 semanas de uso real (Phantom, móvil) y poner `CSP_MODE=enforce`. |

Procedimiento y valores de `PANDA_STORAGE_MODES` usados:
1. `pause=dual,trades=dual,activity=dual,audit=dual,launch=dual,sessions=dual,rewards=dual` (backfill hecho con `claims` y `fee_processing` pausados; con el ledger de holders vacío).
2. `pause=postgres,trades=postgres,activity=postgres,audit=postgres,launch=postgres,rewards=dual,sessions=dual`.
3. `pause=postgres,trades=postgres,activity=postgres,audit=postgres,launch=postgres,sessions=postgres,rewards=postgres` (**valor final**).
Marcha atrás: volver el dominio a `blob` (Blob no se ha modificado desde el cambio 2). Diferencia respecto al plan: no se creó una *rama* de Neon (se usó un esquema temporal en la misma base) y las comprobaciones contra los servicios reales se ejecutaron dentro del build de Vercel (`PANDA_BUILD_TASKS`), porque las variables Sensitive no se pueden descargar.

## 0. Resumen

| # | Punto | Depende de | Esfuerzo | Coste mensual incremental (sin verificar) |
|---|---|---|---|---|
| 1 | Blob → Postgres | tu elección de proveedor | **7–10 días** | 0–25 $ (gratis solo para pruebas; para dinero, plan de pago) |
| 2 | Rate limiting → Upstash Redis | — (paralelizable) | **1–1,5 días** | 0–6 $ |
| 3 | Auditoría con hash-chain, sin blobs públicos | 1 | **2 días** | ≈ 0 |
| 4 | Sesiones revocables + limpieza de nonces | 1 | **1,5–2 días** | 0 |
| 5 | CSP con nonces (`script-src`) | — (paralelizable) | **1,5–2 días** + 1–2 semanas en modo *report-only* | 0 |

Total: **13–17 días de trabajo** ≈ **3–4 semanas de calendario** (por la observación del CSP y la revisión). Coste incremental
estimado: **≈ 20–35 $/mes** sobre Vercel Pro, que ya es obligatorio (`docs/DEPLOY_CHECKLIST.md` §5).

**Orden recomendado:** 1 → (2 y 5 en paralelo mientras se revisa el 1) → 3 → 4. Nada de `FEATURE_HOLDER_REWARDS` ni de claims con
volumen real hasta cerrar el 1, el 3 y el 4.

**Dato que abarata el punto 1:** como en mainnet todavía no ha corrido dinero real, **si se migra antes del primer usuario real no hay
histórico que rescatar**; el trabajo de "sin pérdida de datos" se reduce a no perder lo que generen las pruebas del plan de
`docs/MAINNET_TEST_PLAN.md`. Es la mejor razón para hacerlo *antes* de abrir al público.

---

## 1. Blob → Postgres

**Proveedor:** Neon o Supabase, contratado desde el Marketplace de Vercel (variables inyectadas y facturación en Vercel) **(sin
verificar: disponibilidad e integración actuales)**. Criterios que importan a PANDA: copias de seguridad con recuperación a un punto
en el tiempo (exígelo: solo en planes de pago), región cercana a las funciones de Vercel, y un driver apto para serverless (pooling o
HTTP). Para tu decisión: **Neon** encaja mejor si solo quieres Postgres; **Supabase** si además quieres su panel/Auth (PANDA no lo usa).
Recomendación por defecto: el que ya tengas o el más barato con PITR incluido.

### Estado del punto 1 (implementado, pendiente de tu revisión)

**Hecho (código + pruebas, 526 tests en verde, lint/tsc/build limpios):** esquema Drizzle y migración `drizzle/0000_core_schema.sql`;
repositorios de rewards, trades, actividad/economía y pausas (`src/lib/db/*`); un interruptor por dominio (`PANDA_STORAGE_MODES`, §1.4);
doble escritura; backfill y comparador de solo lectura; check de salud y variables de entorno (`DATABASE_URL`, `DATABASE_URL_UNPOOLED`).
**Por defecto todo sigue en Blob** (sin la variable no cambia nada de lo que corre hoy).

**Qué prueban los tests y qué no.** Corren contra un Postgres real en el proceso (PGlite: `CHECK`, `ON CONFLICT`, `FOR UPDATE`, transacciones). PGlite tiene
**una sola conexión**, así que los tests «25 reclamaciones simultáneas» prueban la lógica y las restricciones, **no** las carreras de bloqueo entre conexiones.
Eso lo cubre `src/lib/db/concurrency.real.test.ts`, que **no se ha ejecutado** (no hay base de datos aquí): se activa con `TEST_DATABASE_URL` apuntando a una
rama desechable de Neon. **Nada de esto se ha probado contra Neon ni desde Vercel** (driver por WebSocket, cadena *pooled*, latencia, límites de conexiones): (sin verificar).

**Desviaciones respecto al borrador (todas para poder migrar sin perder ni cambiar significado):**
- **Drizzle** (tu decisión) en lugar de SQL plano; migraciones numeradas con `drizzle-kit`.
- `reward_distributions (source_sig, mint)` como ancla de idempotencia: un mismo `distributeCreatorFees` no se acredita dos veces aunque el cron reintente (Blob, como antes, no lo evita).
- `trades`: clave `(wallet, signature)`; importes como `double precision` y `ts` en ms (`bigint`), no `numeric`/`timestamptz`: se guardan **exactamente** como los calcula la app, y el comparador exige igualdad.
- `economy_daily`/`economy_total` con una columna `bigint` por métrica (no `jsonb`): sumar es un `UPDATE … SET x = x + n` atómico. Una cifra que pasase de 2^53 se rechaza con la transacción entera.
- El journal del día se limita y se ventanea por **día de escritura** (como los documentos diarios de Blob); en Postgres un mismo id no se repite ni entre días (más estricto).
- API del libro de recompensas: `reserveClaim` devuelve una `Reservation` y aparecen `markClaimSent` / `confirmClaim` / `releaseClaim(reservation)`; `creditHolders` recibe la firma de la distribución.
  Estados de una reclamación: `reserved → sent → confirmed | released`. **Una reclamación «sent» sin desenlace se queda reservada** (no se puede pagar dos veces) y `db:compare` la lista como aviso para revisarla en la cadena.
- Las pausas, journal, economía y trades siguen usando exactamente los mismos módulos; `blob-store.ts` ganó un modo memoria **solo fuera de producción** (para poder probar todo sin Blob real).
- **No incluido en el punto 1** (según el plan): auditoría (punto 3) y sesiones/nonces (punto 4) siguen en Blob; tampoco se ha borrado nada de Blob (retención de 30 días tras el cambio de lectura).

**Cómo se ejecuta (tú, con tus claves; yo no las veo):**
1. Vercel → Storage → Neon (Marketplace). Comprueba que hay copias con recuperación a un punto en el tiempo (plan de pago) y región cercana a las funciones **(sin verificar cómo se llaman hoy las variables que inyecta)**. `vercel env pull .env.local` en tu máquina.
2. `npm run db:migrate` (usa `DATABASE_URL_UNPOOLED`).
3. Por dominio, en este orden **pause → trades → activity → rewards** (el dinero, el último):
   pausar el dominio (panel admin; para rewards: `claims` y `fee_processing`) → `npm run db:backfill` (simulación) → `npm run db:backfill -- --domains <dominio> --yes` → poner `PANDA_STORAGE_MODES=<dominio>=dual` y redesplegar → reanudar →
   `npm run db:compare` cada día → tras **dos días sin diferencias**, `<dominio>=postgres`. Marcha atrás en cualquier momento: volver a `blob` (Blob no se ha tocado).
4. `GET /api/health/trading` muestra el check `database` (alcanzable + en qué modo está cada dominio).
5. Antes de poner rewards en `postgres`, ejecuta `TEST_DATABASE_URL=… npm test` contra una rama desechable.

### 1.1 Qué hay hoy y adónde va

| Dato (ruta Blob) | Naturaleza | Destino Postgres |
|---|---|---|
| `rewards/registry.json`, `rewards/ledger/<mint>.json`, `rewards/payout-day.json` | **dinero**: créditos, reclamaciones, tope diario | `reward_credits`, `reward_claims`, `payout_days` |
| `portfolio/trades/<wallet>.json`, `portfolio/backfill/<wallet>.json` | historial de operaciones | `trades`, `backfill_marks` |
| `activity/journal/<día>.json`, `economy/daily/*`, `economy/total.json` | eventos verificados + agregados | `activity_events`, `economy_daily` |
| `audit/events/<día>/<id>.json` | auditoría | `audit_events` (punto 3) |
| `auth/nonces/<nonce>.json` | un blob por nonce | `auth_nonces` (punto 4) |
| `protocol/pause.json` | interruptores de pausa | `protocol_pause` |
| `otc/launches/<mint>.json`, `strategies/<wallet>.json` | funciones apagadas (`FEATURE_OTC_REWARDS`, `FEATURE_STRATEGIES`) | fase 6b, al activarlas |
| `points/*`, `epochs/*`, `airdrop/*`, `nft/*`, `market/*`, `themes/*`, `branches/*`, `abuse/*` | funciones apagadas | fase 6b, al activarlas (la abstracción `src/lib/storage/store.ts` ya está pensada como "el único archivo a sustituir") |

Alcance de la fase 6: solo lo del núcleo + lo que toca dinero cuando se reactive Holders. Lo apagado se migra cuando se encienda.

### 1.2 Esquema (borrador, SQL)

```sql
-- Dinero: créditos a holders (solo se añade) y reclamaciones (máquina de estados). El saldo se deriva, nunca se edita.
CREATE TABLE reward_credits (
  id            bigserial PRIMARY KEY,
  mint          text        NOT NULL,
  wallet        text        NOT NULL,
  lamports      bigint      NOT NULL CHECK (lamports > 0),
  source_sig    text        NOT NULL,             -- firma de la distribución que lo originó
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_sig, mint, wallet)                -- un crédito no puede contarse dos veces
);
CREATE TABLE reward_balances (                     -- fila bloqueable por (mint, wallet)
  mint text NOT NULL, wallet text NOT NULL,
  credited_lamports bigint NOT NULL DEFAULT 0,
  reserved_lamports bigint NOT NULL DEFAULT 0,     -- reservado o enviado, aún no confirmado
  claimed_lamports  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (mint, wallet),
  CHECK (reserved_lamports + claimed_lamports <= credited_lamports)   -- la base de datos impide pagar de más
);
CREATE TABLE reward_claims (
  id uuid PRIMARY KEY, mint text NOT NULL, wallet text NOT NULL, lamports bigint NOT NULL CHECK (lamports > 0),
  status text NOT NULL CHECK (status IN ('reserved','sent','confirmed','failed','released')),
  signature text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payout_days (day date PRIMARY KEY, paid_lamports bigint NOT NULL DEFAULT 0);

-- Operaciones y actividad: el id del evento es la clave -> idempotente, como hoy.
CREATE TABLE trades (
  signature text PRIMARY KEY, wallet text NOT NULL, mint text NOT NULL, side text NOT NULL,
  sol_lamports bigint NOT NULL, token_amount numeric NOT NULL, sol_price_usd numeric NOT NULL, ts timestamptz NOT NULL
);
CREATE INDEX ON trades (wallet, ts DESC);
CREATE TABLE activity_events (id text PRIMARY KEY, kind text NOT NULL, ts timestamptz NOT NULL, mint text, wallet text, lamports bigint, token_amount numeric, signature text);
CREATE TABLE economy_daily (day date PRIMARY KEY, totals jsonb NOT NULL);

-- Auditoría (punto 3), sesiones y nonces (punto 4), pausas.
CREATE TABLE audit_events (seq bigserial PRIMARY KEY, ts timestamptz NOT NULL, actor text NOT NULL, action text NOT NULL, object text NOT NULL,
  old_state jsonb, new_state jsonb, reason text, request_id text, prev_hash bytea NOT NULL, hash bytea NOT NULL);
CREATE TABLE sessions (jti uuid PRIMARY KEY, wallet text NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE INDEX ON sessions (wallet) WHERE revoked_at IS NULL;
CREATE TABLE auth_nonces (nonce text PRIMARY KEY, wallet text NOT NULL, domain text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz);
CREATE TABLE protocol_pause (subsystem text PRIMARY KEY, paused boolean NOT NULL, reason text, since timestamptz, by_wallet text);
```

### 1.3 Transacciones atómicas

- **Crédito de la distribución (cron `collect-fees`):** una sola transacción: `INSERT reward_credits … ON CONFLICT DO NOTHING` + `UPDATE reward_balances
  SET credited_lamports += …` (con `INSERT … ON CONFLICT` sobre la fila) + el evento de `activity_events` + el total de `economy_daily`. Hoy son escrituras
  separadas y un fallo entre ellas puede infracontar (documentado en la auditoría); en Postgres es todo o nada. Se mantiene el invariante actual
  (créditos + polvo = distribuido) como comprobación antes del `COMMIT`.
- **Reclamación:** `BEGIN; SELECT … FROM reward_balances WHERE (mint,wallet) FOR UPDATE;` → comprueba disponible y tope por reclamación →
  `UPDATE reserved += x` + `INSERT reward_claims(status='reserved')` + `UPDATE payout_days SET paid = paid + x WHERE paid + x <= cap` (0 filas = tope
  alcanzado, se hace `ROLLBACK`) → `COMMIT` **antes** de enviar SOL. Tras enviar: `sent` con la firma; al confirmar: `confirmed` (`reserved -= x, claimed += x`);
  si falla de forma definitiva: `released` (`reserved -= x`). El `CHECK` de `reward_balances` hace imposible pagar de más aunque el código tenga un fallo.
- **Journal:** `INSERT activity_events … ON CONFLICT (id) DO NOTHING RETURNING id`; los totales de `economy_daily` se suman **solo si** se insertó fila, en la misma transacción.

### 1.4 Migración sin pérdida de datos

1. **Capa de repositorio** delante de `storage/store.ts` (misma interfaz que hoy usan los stores); nada más cambia arriba.
2. **Esquema + migraciones versionadas** (sin ORM nuevo si no quieres otra dependencia: SQL plano con el driver del proveedor; con ORM sería Drizzle **(decisión tuya)**).
3. **Doble escritura** por dominio (Blob sigue siendo la fuente de lectura). Comparación diaria (recuentos y sumas de lamports) con un script de solo lectura.
4. **Backfill** desde Blob con un script idempotente (mismas claves únicas), ejecutado con el dominio en pausa (`pause` de `claims`/`fee_processing`) para congelar escrituras el rato que dure.
5. **Cambio de lectura** por dominio; el **libro de recompensas y las reclamaciones, los últimos**, tras dos días de comparación sin diferencias.
6. Blob queda **solo lectura 30 días** y luego se borra (también para retirar los archivos públicos con direcciones de wallet). Marcha atrás = volver a apuntar la lectura a Blob.
7. Pruebas: propiedad (créditos + polvo = distribuido), concurrencia real contra una base de pruebas (N reclamaciones simultáneas → un único pago), idempotencia del journal, y el `CHECK` que impide sobrepago.

Riesgos: latencia y límites de conexiones desde funciones serverless (usar el driver/pooler del proveedor **(sin verificar)**), y que Postgres pasa a ser un componente crítico (copias con PITR, alerta de disponibilidad).

**Esfuerzo: 7–10 días** (esquema 1, repositorio y stores del núcleo 3–4, doble escritura + comparador 1–2, backfill + cambio de lectura 1, pruebas de concurrencia 1–2).

---

## 2. Rate limiting → Upstash Redis

### Estado del punto 2 (implementado)

**Hecho:** `rateLimited` es ahora **asíncrono** y usa Upstash Redis (`@upstash/ratelimit`, ventana deslizante); los ~50 llamadores están actualizados y un test estático
impide que un llamador olvide el `await` (una promesa sin `await` es siempre «verdadera» = siempre limitado). La política de fallo se decide **por tipo de ruta**, como pediste:

| Tipo | Ejemplos | Si Upstash no responde |
|---|---|---|
| **Dinero — falla cerrado** (`moneyRateGate`, 503 `RATE_LIMIT_UNAVAILABLE`) | comprar/vender/swap, crear moneda (Estándar y OTC), reclamar rewards y airdrops, mint/confirmación de NFT, mercado NFT, estrategias, **enviar una transacción por `/api/rpc`** | se **rechaza** la petición |
| **Lectura — falla abierto** (`rateLimited`) | mercados, portfolio, actividad, salud, sign-in, ramas, **admin** | sigue funcionando con el limitador por instancia de antes |

- **Admin es fail-open a propósito:** una pausa de emergencia no puede depender de que Redis esté vivo. Tienes un test que lo fija.
- **Decisión implícita que debes conocer:** en **producción sin Upstash configurado** las rutas de dinero también se rechazan (503). Es la lectura estricta de «si no responde, se rechaza»: sin las variables no se puede operar. `/api/health/trading` (check `ratelimit`) y el esquema de entorno lo marcan como obligatorio en producción.
- Timeout de 1,5 s por consulta y un «cortacircuitos» de 5 s: una caída cuesta un timeout, no uno por petición. Claves con prefijo del entorno (`panda:<production|preview>:rl`) para que Preview no gaste el presupuesto de Producción.
- Fuera de producción y sin Upstash todo usa el limitador en memoria (desarrollo y tests).
- Acepta `UPSTASH_REDIS_REST_URL/TOKEN` o `KV_REST_API_URL/TOKEN` (**sin verificar** cuál inyecta hoy la integración de Vercel).

**Verificado:** 12 tests (contador compartido con un Redis simulado, fail-closed/fail-open, timeout, cortacircuitos, no configurado, cuerpos 429 propios, política por ruta) y un servidor de **producción** real (`next start`): sin Upstash y con un Upstash inalcanzable, `POST /api/pump/buy`, `/api/rewards/claim` y `sendTransaction` por `/api/rpc` dan **503**, las lecturas (`/api/coins`, `/api/activity`, `getLatestBlockhash`) dan 200, y la segunda petición ya no espera el timeout.
**No verificado:** ninguna llamada real a Upstash (no hay cuenta aquí): el camino feliz, el formato de la duración `"<n> ms"` en su SDK real y la latencia añadida a cada petición.


- Hoy `rateLimited(key, limit, windowMs)` (`src/lib/rate-limit.ts`) es **síncrona** y en memoria por instancia; se usa en **~50 puntos**. Pasa a asíncrona con `@upstash/ratelimit` (ventana deslizante) sobre Upstash Redis **(nueva dependencia)**.
- Cambio mecánico: misma firma pero `await` en los ~50 llamadores (un *codemod*) y tipos.
- Política si Upstash falla: **degradar al limitador en memoria actual** (y registrar), no abrir del todo ni bloquear todo el sitio. Para rutas que mueven dinero se puede exigir fallar cerrado — decisión tuya.
- Claves: mismas que hoy (`trade-build:<ip>`, `rpc:<ip>`…), con prefijo de entorno para separar Production de Preview.
- Prueba: test de integración con dos instancias simuladas que comparten contador (hoy es imposible), y el límite de `/api/rpc` bajo carga.

**Esfuerzo: 1–1,5 días.** **Coste (sin verificar):** hay un plan gratuito y uno de pago por uso (del orden de 0,2 $ por 100.000 comandos); un límite consulta ~2–3 comandos → con ~1 M de comprobaciones al mes, **≈ 4–6 $**.

## 3. Auditoría con hash-chain y sin blobs legibles por URL

- Tabla `audit_events` con `prev_hash` y `hash = sha256(prev_hash ‖ JSON canónico del evento)`. Las inserciones se serializan (`pg_advisory_xact_lock`) para que la cadena no se bifurque.
- Endpoint de lectura solo para admin (hoy los eventos son archivos públicos por URL); la escritura sigue siendo "mejor esfuerzo" **pero** el fallo se alerta (`alertOps`) y se registra también en los logs de Vercel, como hoy.
- **Verificador** `scripts/verify-audit-chain.ts` (solo lectura): recorre la cadena y falla en el primer eslabón roto.
- **Anclaje externo** para que sea evidencia incluso frente a quien administre la base: publicar periódicamente (p. ej. semanal) el hash de la cabeza en una transacción *memo* de Solana **(el coste de una transacción, ≈ 0,000005 SOL)** o enviarlo por email al dueño. Sin anclaje, quien controle Postgres podría reescribir la cadena entera.
- Migración: los eventos históricos de Blob se importan en orden como tramo inicial; después se borran los blobs.

**Esfuerzo: 2 días** (tras el punto 1).

## 4. Sesiones revocables y limpieza de nonces

- El token de sesión (cookie `panda_session`, HMAC, 2 h) gana un `jti` y se registra en `sessions`. `getSession` pasa a comprobar en base de datos que ese `jti` no está revocado ni caducado (una consulta indexada por petición autenticada). Todos los llamadores pasan a `await` (cambio mecánico).
- Revocación: **cerrar sesión** revoca el `jti` (hoy solo borra la cookie); botón "cerrar todas mis sesiones" (`revoked_at` en todas las de la wallet); y una acción de admin para revocar las de una wallet sospechosa.
- Nonces: hoy un blob por nonce que se acumula. En `auth_nonces` se consume atómicamente (`UPDATE … SET used_at = now() WHERE nonce = $1 AND used_at IS NULL AND expires_at > now() RETURNING …`) y un cron diario borra los caducados (segunda entrada en `vercel.json`).
- Pruebas: reutilizar un nonce falla, una sesión revocada deja de valer de inmediato, un token con `jti` inexistente se rechaza, el cron no borra los vigentes.

**Esfuerzo: 1,5–2 días** (tras el punto 1).

## 5. CSP con nonces (`script-src`)

- Hoy el CSP solo fija `frame-ancestors`, `base-uri`, `object-src` y `form-action` (deliberadamente, porque los scripts de arranque de Next necesitan nonce).
- Plan: un **`proxy.ts`** (el antiguo *middleware* en Next 16 **(sin verificar el nombre exacto en esta versión: se comprueba en la documentación instalada al empezar)**) genera un nonce por petición, fija `Content-Security-Policy` con `script-src 'self' 'nonce-…' 'strict-dynamic'` y lo pasa por cabecera para que Next lo aplique a sus scripts.
- **Consecuencia:** todas las páginas pasan a renderizarse por petición (hoy `/create`, `/portfolio` y `/rewards` son estáticas): más carga de servidor, sin cambio visible.
- Directivas del resto: `connect-src 'self'` (el navegador ya habla con `/api/rpc` y con las APIs propias), `img-src` amplio (`https:` y `data:`: los logos de las monedas vienen de dominios de terceros), `style-src` con `'unsafe-inline'` mientras Tailwind/Next lo requieran.
- **Despliegue seguro:** primero `Content-Security-Policy-Report-Only` con un endpoint de informes, **1–2 semanas** observando violaciones reales (extensiones de wallet, fuentes, imágenes), y solo entonces se aplica.
- Riesgo: romper la conexión con la wallet o las imágenes; por eso el modo *report-only* y una prueba en móvil (Phantom in-app) antes de aplicar.

**Esfuerzo: 1,5–2 días + observación.**

---

## 6. Coste mensual estimado (sin verificar; orientativo)

| Concepto | Mínimo (solo pruebas, **no recomendado con dinero**) | Recomendado |
|---|---|---|
| Vercel Pro (ya obligatorio, paso 5 del checklist) | 20 $ | 20 $ |
| Postgres (Neon o Supabase) | plan gratuito | **≈ 19–25 $** (con copias/PITR) |
| Upstash Redis | plan gratuito | **≈ 0–6 $** |
| CSP, hash-chain, revocación de sesiones | 0 | 0 (anclaje en Solana ≈ céntimos) |
| **Incremental sobre Pro** | **0 $** | **≈ 20–30 $/mes** |
| **Total con Pro** | **≈ 20 $** | **≈ 40–50 $/mes** |

## 7. Lo que necesito de ti

1. **Proveedor de Postgres** (Neon o Supabase) y **de Redis** (Upstash), y crear las cuentas tú: yo no recibo claves; tú pones las variables en Vercel.
2. ¿**SQL plano** con el driver del proveedor (sin dependencia nueva de ORM) o **Drizzle**? Mi recomendación: SQL plano + migraciones numeradas.
3. Política de fallo de Upstash para rutas de dinero: ¿**degradar** al limitador en memoria o **fallar cerrado**?
4. ¿Migro también las funciones apagadas (puntos, airdrops, NFT…) ahora o cuando se enciendan? Recomendación: **cuando se enciendan**.
5. Luz verde para empezar por el punto 1.
