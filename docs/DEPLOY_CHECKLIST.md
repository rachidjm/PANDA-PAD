# PANDA — checklist de despliegue (lo que haces tú, en orden)

Alcance de este lanzamiento: **Discover, comprar/vender, crear moneda Estándar y Portfolio.** Todo lo demás
(`FEATURE_STRATEGIES`, `FEATURE_OTC_REWARDS`, puntos, airdrops, NFT) está **apagado por defecto** y se queda así hasta que
esté probado con dinero real. Ningún paso de este documento requiere que me pases una clave: las claves solo las pones tú
en Vercel.

Cómo saber en cualquier momento qué falta: con la sesión de admin iniciada en ese navegador (menú de la wallet → «Entrar como admin»), abre `https://<tu-dominio>/api/health/trading` (a cualquiera sin sesión de admin le da 404). Dice, variable por variable,
si está `present`, `absent` o `invalid` (nunca su valor), la red que detecta el RPC, el saldo de la tesorería y qué corregir.

> Marcado **(sin verificar)** = dato de un tercero (precios, planes, normativa) que no he podido comprobar desde el código.
> Contrástalo en la fuente antes de decidir.

---

## 1. RPC dedicado

**Por qué:** el RPC público de Solana rechaza con 403 las consultas que usa Portfolio (leer todas las cuentas de token de
una wallet) y descarta o limita transacciones cuando hay carga. Con él, una compra puede quedarse sin confirmar sin culpa
de nadie. `/api/health/trading` avisa si es el que está en uso.

**Qué necesita PANDA de un proveedor** (sacado del código, no de un catálogo):
- JSON-RPC por **HTTPS** (no usa WebSockets: la confirmación se hace por polling HTTP).
- Métodos que usa el servidor: `getLatestBlockhash`, `getGenesisHash`, `getBalance`, `getAccountInfo`, `getMultipleAccounts`,
  `getParsedTokenAccountsByOwner` (con el programa de tokens clásico **y** Token-2022), `getSignaturesForAddress`,
  `getParsedTransaction` / `getTransaction`, `simulateTransaction`, `sendTransaction`, `getSignatureStatuses`.
- Un proveedor que **no** limite `getParsedTokenAccountsByOwner` ni `getSignaturesForAddress` en el plan que elijas.

**Plan mínimo:**
1. Para las pruebas con 0,01–0,05 SOL (`docs/MAINNET_TEST_PLAN.md`): basta el plan gratuito del proveedor, siempre que
   cumpla la lista de arriba. La documentación anterior del repo ya decía que una clave gratuita sirve para empezar.
2. **Antes de abrir al público:** el primer plan de pago del proveedor. El gratuito tiene topes de peticiones/créditos que
   se agotan justo cuando hay más tráfico (que es cuando se opera). **(sin verificar: nombres, precios y límites actuales —
   míralos en la página de precios del proveedor).** No puedo darte una cifra de peticiones por usuario sin haberlo medido:
   durante las pruebas mira el panel de uso del proveedor y extrapola.
3. Elige uno de los que ya nombraba el proyecto: Helius, QuickNode, Alchemy (o Triton).

Guarda la URL completa (lleva la clave) **solo** en `SOLANA_RPC_URL` (variable de servidor). No la pongas en
`NEXT_PUBLIC_SOLANA_RPC_URL`: esa variable viaja al navegador.

## 2. Variables de entorno en Vercel

`Project → Settings → Environment Variables`. Marca como **Sensitive** todo lo que sea clave o secreto. La lista completa,
agrupada y comentada, está en `.env.example`.

**Obligatorias para el núcleo** (sin ellas el subsistema afectado queda parado; la app no se rompe):

| Variable | Qué es | Sin ella |
|---|---|---|
| `NETWORK` | `mainnet` (producción) | Producción no mueve dinero (guard de red). |
| `TREASURY_IS_MULTISIG` | `true` cuando la tesorería sea un multisig (paso 4.1) | En mainnet no se pueden crear monedas (el trading sigue). |
| `SOLANA_RPC_URL` | URL del RPC dedicado (paso 1) | Producción no mueve dinero. |
| `PANDA_LOOKUP_TABLE` | Dirección de la Address Lookup Table de PANDA (paso 4.2) | Un lanzamiento pide **dos** firmas y la moneda queda fuera de las listas hasta fijar el reparto. Opcional pero muy recomendada. |
| `NEXT_PUBLIC_PANDA_TREASURY` | Dirección pública de la tesorería (paso 3/4) | Producción no mueve dinero (si no, la comisión iría a una dirección por defecto). |
| `AUTH_SESSION_SECRET` | ≥ 32 caracteres aleatorios | Nadie inicia sesión ni reclama recompensas. |
| `ADMIN_WALLETS` | Direcciones públicas separadas por comas | Nadie es admin. |
| `CRON_SECRET` | Cadena aleatoria larga | El cron diario se niega a ejecutarse. |
| `BLOB_READ_WRITE_TOKEN` | Lo pone Vercel al conectar un Blob store | No se puede crear moneda (metadatos) ni guardar imágenes. |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Las pone la integración de Neon (paso 4.3) | Con `PANDA_STORAGE_MODES` en `postgres` la app falla cerrada (no cae a Blob). |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` (o `UPSTASH_REDIS_REST_*`) | Las pone la integración de Upstash (paso 4.4) | En producción las rutas de dinero dan 503. |
| `PANDA_STORAGE_MODES` | **Valor final (fase 6 cerrada):** `pause=postgres,trades=postgres,activity=postgres,audit=postgres,launch=postgres,sessions=postgres,rewards=postgres` | Sin ella todo sigue en Blob (comportamiento antiguo). |
| `CSP_MODE` | Opcional. Por defecto `report-only`; `enforce` bloquea; `off` lo quita. Ponlo en `enforce` solo tras 1–2 semanas de informes limpios en `/admin` (Phantom y móvil incluidos). | Se queda en solo informar. |

Generar los secretos aleatorios (un comando por secreto, en tu máquina):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Entornos separados (importante):**
- **Production:** `NETWORK=mainnet` + RPC de mainnet.
- **Preview:** `NETWORK=devnet` + un RPC de devnet. Así una rama de pruebas no puede tocar dinero real: si alguien
  configura mal una de las dos cosas, el guard bloquea los flujos de dinero.

**Déjalas SIN definir** (apagadas) para el lanzamiento del núcleo: `FEATURE_STRATEGIES`, `FEATURE_OTC_REWARDS`,
`FEATURE_PANDA_POINTS`, `FEATURE_PANDA_AIRDROPS`, `FEATURE_MERKLE_CLAIMS`, `FEATURE_NFT_*`. Solo `"true"` exacto las activa.

**Decisión tomada — reparto a "Holders" FUERA del lanzamiento.** `FEATURE_HOLDER_REWARDS` queda **sin definir** (apagado): Create no
muestra la banda Holders (el reparto es PANDA 5 % + Creator + partner opcional), el servidor rechaza cualquier reparto que la
incluya, y los textos legales no mencionan el Rewards Pool. Se reactivará tras la fase 6 (`docs/PHASE6_PLAN.md`). Consecuencia a
tener en cuenta: el 5 % de PANDA (y la parte del creador) de cada moneda se reparte con `distributeCreatorFees` on-chain, que es
**sin permisos**, pero hoy solo lo dispara el cron diario, y el cron necesita `PANDA_REWARDS_POOL_SECRET_KEY` como pagador de
esa transacción. Sin esa clave, las comisiones se acumulan en la bóveda del creador de la moneda hasta que alguien llame al reparto
(cualquiera puede). Decide si quieres un pagador para el cron aunque Holders esté apagado.

**`TREASURY_IS_MULTISIG` (mainnet):** mientras no sea exactamente `"true"`, en mainnet **crear monedas está bloqueado** (comprar y
vender siguen funcionando) con un aviso ES/EN en Create y `503 COIN_CREATION_BLOCKED` en el servidor. Ponla a `true` solo cuando
`NEXT_PUBLIC_PANDA_TREASURY` ya sea la dirección de vault de tu multisig de Squads (paso 4.1). Es tu declaración: el código no
puede comprobar desde la cadena que una dirección sea un multisig.

Después de desplegar: abre `/api/health/trading` (con sesión de admin) y comprueba `network.state = "ok"`, `moneyFlows.allowed = true` y que
ninguna variable obligatoria salga `absent` o `invalid`.

## 3. Fondear la tesorería

- La tesorería es la wallet de `NEXT_PUBLIC_PANDA_TREASURY`. Recibe el 0,5 % de cada compra y venta (y el 5 % de PANDA de
  las comisiones de creador de cada moneda).
- Una cuenta de sistema que queda por debajo del mínimo exento de renta (≈ 0,00089 SOL) hace que **toda la transacción**
  falle. El código lo evita omitiendo la comisión cuando la tesorería no puede recibirla, pero entonces **esa operación no
  paga comisión**. Por eso: envía **al menos 0,002 SOL** a la tesorería antes de operar. `/api/health/trading` avisa si
  tiene menos de 0,002 SOL.
- Envíalo desde tu wallet personal, y comprueba el saldo en Solscan.

## 4. Tesorería y pool en multisig con Squads

**4.1 Tesorería (recibe comisiones; PANDA nunca firma con ella) → sí puede ser un multisig.**

1. Entra en la web oficial de Squads (squads.xyz) y crea un **multisig nuevo** en la red correcta (mainnet).
   **(sin verificar: textos y pasos exactos de su interfaz actual — sigue su documentación oficial).**
2. Define los miembros y el **umbral**. Recomendación: al menos 3 miembros y umbral 2, con wallets hardware (Ledger) y
   claves en dispositivos distintos. Un multisig 1-de-1 no aporta nada.
3. Squads te da una dirección de multisig y una **dirección de vault** (la que guarda los fondos). La que va en
   `NEXT_PUBLIC_PANDA_TREASURY` es la de **vault**, no la del multisig ni la de un miembro.
4. **Antes de crear ninguna moneda real:** fija ahí la tesorería definitiva. La dirección de la tesorería se escribe en la
   configuración de comisiones **on-chain de cada moneda** al crearla (es el 5 % de PANDA), así que cambiarla después no
   corrige las monedas ya creadas.
5. Envía ≥ 0,002 SOL al vault (paso 3). Haz una compra de prueba y comprueba con `scripts/verify-tx.ts` que el 0,5 %
   llega al vault (`docs/MAINNET_TEST_PLAN.md`, prueba 5).
6. Para mover fondos fuera del vault se necesita el umbral de firmas: eso es lo que se busca.

**4.2 Rewards Pool (paga las reclamaciones de holders) → NO puede ser un multisig tal cual.**
El servidor de PANDA firma cada pago automáticamente con `PANDA_REWARDS_POOL_SECRET_KEY`; un vault multisig necesita
varias personas para firmar, así que no puede ser la wallet que paga. Lo honesto es:
- Mantenerla como wallet **caliente y con saldo acotado**: solo lo que quieras exponer a un fallo del servidor o de la clave.
- Rellenarla desde el vault de Squads cuando haga falta (una aprobación de umbral por recarga).
- Ajustar `REWARDS_DAILY_CAP_SOL` a ese saldo acotado, y poner `ALERT_WEBHOOK_URL` para saber cuándo baja de 0,05 SOL.
- La alternativa de fondo (un programa on-chain que aplique el reparto sin clave de servidor) **no existe hoy** y es trabajo
  aparte. Hasta entonces, la custodia de esa wallet es tu responsabilidad y los textos legales ya lo declaran.

### 4.2 Lookup table de lanzamientos (una firma en vez de dos)

Crear una moneda y fijar su reparto (el 5 % bloqueado de PANDA) **no cabe** en una transacción normal (1.238–1.347 bytes frente a 1.232).
Como transacción v0 con una Address Lookup Table propia sí cabe (medido: 846–1.153 bytes con 1–10 repartos y metadatos cortos; con
metadatos del tamaño real, hasta **9 de 10** repartos caben; si no cabe, el servidor usa las dos transacciones). Es atómico: la moneda no puede existir sin su reparto.

1. Simulación, sin firmar nada: `npm run create-lookup-table -- --rpc <tu RPC>` (lista las 14 cuentas fijas y el coste: ~0,0032 SOL de renta).
2. Créala **tú**, con una wallet tuya con ~0,01 SOL (yo no firmo nada): `npm run create-lookup-table -- --rpc <RPC> --keypair <archivo.json> --yes`.
   Crea la tabla, la rellena y la **congela** (sin autoridad: nadie puede cambiarla ni cerrarla). Imprime su dirección.
3. Ponla en Vercel como `PANDA_LOOKUP_TABLE` (es pública, no un secreto).
4. Comprueba, solo lectura: `npm run check-lookup-table -- --rpc <RPC>` → `CHECK OK` (activa, congelada, con todas las cuentas y un lanzamiento de 1 y de 10 repartos dentro del límite).

Sin la variable todo funciona igual con el respaldo de dos transacciones, pero la moneda se **oculta** de todas las listas de PANDA
(inicio, Discover, búsqueda, launches, Activity) hasta que el reparto esté on-chain, su creador ve un aviso persistente con el botón
"Fijar reparto de comisiones" en la página de la moneda, y cada moneda creada sin reparto queda en auditoría
(`token.created_without_fee_split`, y `token.fee_split_locked` cuando se fija).

### 4.3 Postgres (Neon) — hecho (fase 6 cerrada)

La migración está terminada: los siete dominios (`rewards, trades, activity, pause, audit, sessions, launch`) están en `postgres` (valor exacto en la tabla del paso 2).
Blob se queda solo para imágenes/metadatos y para los archivos de funciones apagadas (puntos, airdrops, ramas, temas/NFT, estrategias, abuso), que se migrarán cuando se enciendan.
- Las migraciones se aplican solas en cada despliegue de producción (`scripts/vercel-build.ts`; si una falla, el despliegue no sale y el anterior sigue sirviendo).
- Comprobaciones contra los servicios reales (las variables Sensitive no se pueden descargar, así que corren dentro del build): `vercel deploy --prod --build-env PANDA_BUILD_TASKS=verify-services,verify-audit,compare`
  y lee el log del build; imprime también los modos activos (`dominio=modo`), sin secretos.
- Las copias congeladas de Blob de los siete dominios se conservan 30 días como vuelta atrás. **Borrarlas es decisión tuya** (no hay script): no lo hagas antes de que pase ese plazo y de haber mirado `compare`.
  La política de privacidad dice que esas copias antiguas se eliminan tras un periodo de transición: hazlo de verdad.
- Marcha atrás de un dominio: ponerlo otra vez en `blob` (la copia de Blob no se ha tocado desde el cambio 2; lo escrito después solo está en Postgres).

### 4.4 Rate limiting (Upstash Redis) — obligatorio en producción

Sin él, en producción **todas las rutas de dinero se rechazan con 503** (comprar, vender, crear moneda, reclamar, enviar transacciones…); el resto de la web sigue.
Crea una base en Upstash (integración de Vercel o cuenta propia; plan gratuito para empezar) y pon `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` (o `KV_REST_API_URL/TOKEN`
si la integración usa esos nombres). Comprueba `GET /api/health/trading` → check `ratelimit` en verde. Si Upstash cae, las rutas de dinero vuelven a 503 hasta que responda (fallo cerrado, por diseño).

## 5. Vercel Pro

- El plan Hobby es para uso personal no comercial según los términos de Vercel **(sin verificar: confírmalo en su página
  de precios/condiciones)**. PANDA cobra una comisión, así que su uso es comercial: pasa a **Pro** antes de abrir al público.
- El código ya está ajustado a los límites de Hobby (cron una vez al día a las 12:00 UTC; presupuesto de 25 s para una
  función de 30 s). Con Pro se pueden revisar, pero no es necesario para lanzar.

## 6. Dominio propio

1. Compra un dominio y añádelo en `Project → Settings → Domains`; sigue las instrucciones DNS de Vercel.
2. Define `NEXT_PUBLIC_SITE_URL` con la URL final (solo se usa para enlaces de metadatos NFT, pero conviene tenerlo).
3. El inicio de sesión con wallet vincula el mensaje firmado al dominio y la cookie es `SameSite=Strict`: tras el cambio,
   **los usuarios tendrán que volver a iniciar sesión**. Comprueba el inicio de sesión y una reclamación de prueba en el
   dominio nuevo.
4. Motivo práctico: Phantom trata los dominios `*.vercel.app` con más recelo que un dominio propio.
   **(sin verificar: comportamiento actual de Phantom)**.

## 7. Consulta legal (antes de activar nada custodial)

Los textos legales del repo son un **borrador escrito por el equipo, no por un abogado**, y tienen huecos deliberados marcados como
`[COMPLETAR: …]` (titular, NIF, domicilio, correo, edad mínima, jurisdicción, plazo de conservación; se ven resaltados en la web y `legalPlaceholders()` los lista). Antes de abrir al público y, sobre todo, **antes de activar
`FEATURE_STRATEGIES`**, pide a un abogado con experiencia en criptoactivos (en el EEE, MiCA) que responda:

1. **Custodia.** ¿Se considera PANDA custodio o prestador de servicios de criptoactivos por (a) el Rewards Pool
   (fondos de holders en una wallet cuya clave tiene el servidor) y (b) la bóveda de Jupiter/Privy de las estrategias
   (`FEATURE_STRATEGIES`)? ¿Qué autorización o registro exigiría?
2. **Comisiones sobre operaciones.** El 0,5 % en compra y venta (y el 1 % de una estrategia): ¿es ejecución u
   intermediación de órdenes? ¿Cambia algo que la transacción sea firmada por el usuario y la comisión sea una transferencia
   visible en su wallet?
3. **MiCA en particular.** Régimen aplicable a proveedores de servicios de criptoactivos y sus plazos transitorios
   **(sin verificar: fechas y su aplicación en tu Estado miembro)**; y si una interfaz de software puramente no custodial
   queda fuera.
4. **Emisión.** ¿Qué implica lanzar el token $PANDA cuando llegue el momento (folleto/whitepaper, restricciones)?
5. **Datos personales.** Neon (EE. UU.), Upstash y Vercel guardan direcciones de wallet, sesiones y auditoría (inmutable: la base rechaza editar o borrar) y la IP como clave de un contador de
   rate limit durante un minuto (hasta una hora en unas pocas acciones): ¿base jurídica, transferencia fuera del EEE, derecho de supresión frente a una auditoría inmutable, plazos de conservación?
6. **Entidad, domicilio y jurisdicción** para rellenar los campos `[COMPLETAR]`, y términos de servicio revisados.
7. **Publicidad y consumidores.** Textos de riesgo y "no es asesoramiento" en ES/EN: ¿suficientes?

Mientras esa respuesta no exista, `FEATURE_STRATEGIES` se queda apagado. Los textos legales ya cambian solos cuando se
enciende (añaden la custodia de Privy y sus riesgos), pero eso no sustituye a la revisión.

## 8. Encender `FEATURE_HOLDER_REWARDS` (checklist de prueba con 1–2 €)

Lo enciendes tú. Es la única función en la que **PANDA retiene fondos** (la wallet del Rewards Pool con su clave en el servidor). Antes de ponerla a `true`:

**Requisitos (todos)**
- [ ] `NEXT_PUBLIC_PANDA_REWARDS_POOL` (pública) y `PANDA_REWARDS_POOL_SECRET_KEY` (Sensitive) puestas; la wallet del pool con ~0,01 SOL para las comisiones de sus pagos. Está en Vercel; comprueba que la dirección es la que crees.
- [ ] Tesorería multisig y `TREASURY_IS_MULTISIG=true` (sin ello no se puede crear la moneda de prueba en mainnet).
- [ ] Sesión admin y `/api/health/trading` en verde (`ok: true`, `database` y `ratelimit` en verde).
- [ ] Respuesta legal sobre la custodia del Rewards Pool (paso 7) o decisión asumida por ti; los `[COMPLETAR]` rellenados.
- [ ] `REWARDS_MAX_CLAIM_SOL` y `REWARDS_DAILY_CAP_SOL` con valores pequeños para la prueba (topes por reclamo y por día).

**Al ponerla a `true` (y redesplegar) cambia sola la web**: aparece la página Rewards (enlaces, pestaña en la moneda, bloque en Portfolio, tarjetas en Analytics), Create muestra la banda «Holders» y los textos legales añaden la custodia del Rewards Pool.

**Prueba con 1–2 € (en este orden)**
1. Crea una moneda de prueba con reparto **Holders** (p. ej. Creator 45 % / Holders 50 % + PANDA 5 %). `npm run check-sharing -- <mint>` debe mostrar el 5 % de PANDA y el Rewards Pool. Una sola firma si `singleTx` es true.
2. Con otra wallet, compra ~0,5 € de esa moneda (`npm run verify-tx -- <firma>` → `MATCH`, 0,5 %) y otra pequeña compra y venta para generar comisiones de creador.
3. Espera al cron diario de las 12:00 UTC (o haz la distribución manual sin permisos) y mira `/rewards` con la wallet holder: debe salir «Disponible para reclamar» > 0 y el ledger en Postgres (`compare` sin diferencias).
4. Reclama (una firma de mensaje gratis, no una transacción): debe llegar SOL a la wallet, con enlace a la transacción; comprueba en Solscan que sale del Rewards Pool y que el ledger (`reward_balances`) cuadra (`claimed + reserved ≤ credited`).
5. Comprueba la auditoría: `/admin` → «Verify the chain» en verde y el evento del reclamo; ancla la cabeza en Solana una vez.
6. Cierra sesión y prueba que un reclamo con la cookie copiada falla (sesión revocada).
7. Si algo falla: pausa `claims` y `fee_processing` en `/admin` (deja de pagar al instante), apaga el flag y avísame.

---

## Antes de abrir al público

- [ ] Pasos 1–3 hechos; `/api/health/trading` en verde (`ok: true`).
- [ ] Paso 4.1 hecho (tesorería definitiva en multisig) y `TREASURY_IS_MULTISIG=true` **antes** de crear la primera moneda real (sin eso el servidor no deja).
- [ ] Paso 4.2 hecho (`PANDA_LOOKUP_TABLE` puesta y `check-lookup-table` en `CHECK OK`); si no, sabes que se usa el respaldo de dos transacciones.
- [ ] `docs/MAINNET_TEST_PLAN.md` ejecutado entero con 0,01–0,05 SOL.
- [ ] Pasos 5 y 6 hechos.
- [ ] Respuesta legal recibida (paso 7) y los `[COMPLETAR]` de los textos legales rellenados.
- [ ] Upstash configurado (§4.4) y el check `ratelimit` de `/api/health/trading` en verde: sin él las rutas de dinero dan 503.
- [x] Fase 6 cerrada (2026-09-26): los siete dominios en `postgres`, Upstash real verificado, auditoría con hash-chain, sesiones revocables, CSP en `report-only`. Pendiente tuyo: `CSP_MODE=enforce` tras los informes limpios y borrar las copias de Blob pasados 30 días.
- [ ] Fase 6 (infraestructura para dinero de terceros: base de datos, rate limiting compartido, auditoría con hash-chain,
      sesiones revocables, CSP con nonces) decidida: hoy la persistencia es Vercel Blob y el rate limiting es en memoria
      por instancia; ninguno es apto para dinero de terceros a escala.
