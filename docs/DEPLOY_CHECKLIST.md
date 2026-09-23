# PANDA — checklist de despliegue (lo que haces tú, en orden)

Alcance de este lanzamiento: **Discover, comprar/vender, crear moneda Estándar y Portfolio.** Todo lo demás
(`FEATURE_STRATEGIES`, `FEATURE_OTC_REWARDS`, puntos, airdrops, NFT) está **apagado por defecto** y se queda así hasta que
esté probado con dinero real. Ningún paso de este documento requiere que me pases una clave: las claves solo las pones tú
en Vercel.

Cómo saber en cualquier momento qué falta: abre `https://<tu-dominio>/api/health/trading`. Dice, variable por variable,
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
| `SOLANA_RPC_URL` | URL del RPC dedicado (paso 1) | Producción no mueve dinero. |
| `NEXT_PUBLIC_PANDA_TREASURY` | Dirección pública de la tesorería (paso 3/4) | Producción no mueve dinero (si no, la comisión iría a una dirección por defecto). |
| `AUTH_SESSION_SECRET` | ≥ 32 caracteres aleatorios | Nadie inicia sesión ni reclama recompensas. |
| `ADMIN_WALLETS` | Direcciones públicas separadas por comas | Nadie es admin. |
| `CRON_SECRET` | Cadena aleatoria larga | El cron diario se niega a ejecutarse. |
| `BLOB_READ_WRITE_TOKEN` | Lo pone Vercel al conectar un Blob store | No se puede crear moneda (metadatos) ni guardar ledgers. |

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

**Decisión pendiente tuya — reparto a "Holders" al crear una moneda:** si `NEXT_PUBLIC_PANDA_REWARDS_POOL` está definido,
Create ofrece asignar comisiones a Holders y esas comisiones caen en una wallet cuya clave custodian los servidores de
PANDA (`PANDA_REWARDS_POOL_SECRET_KEY`). Nada de ese flujo se ha firmado en mainnet. Si no quieres que forme parte del
lanzamiento, **no definas esa variable**: Create muestra el reparto a Holders como "no configurado" y la página Rewards
muestra que el pool no está configurado. Si lo defines, pon `REWARDS_MAX_CLAIM_SOL` y `REWARDS_DAILY_CAP_SOL` a lo que estés dispuesto a perder en el peor caso.

Después de desplegar: abre `/api/health/trading` y comprueba `network.state = "ok"`, `moneyFlows.allowed = true` y que
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

Los textos legales del repo son un **borrador escrito por el equipo, no por un abogado**, y tienen huecos deliberados
(entidad, domicilio, jurisdicción, contacto). Antes de abrir al público y, sobre todo, **antes de activar
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
5. **Datos personales.** El registro de operaciones y los ledgers guardan direcciones de wallet en archivos legibles por
   URL, y hay una cookie de sesión: ¿qué exige el RGPD y qué debe decir la política de privacidad?
6. **Entidad, domicilio y jurisdicción** para rellenar los campos `[pendiente]`, y términos de servicio revisados.
7. **Publicidad y consumidores.** Textos de riesgo y "no es asesoramiento" en ES/EN: ¿suficientes?

Mientras esa respuesta no exista, `FEATURE_STRATEGIES` se queda apagado. Los textos legales ya cambian solos cuando se
enciende (añaden la custodia de Privy y sus riesgos), pero eso no sustituye a la revisión.

---

## Antes de abrir al público

- [ ] Pasos 1–3 hechos; `/api/health/trading` en verde (`ok: true`).
- [ ] Paso 4.1 hecho (tesorería definitiva en multisig) **antes** de crear la primera moneda real.
- [ ] `docs/MAINNET_TEST_PLAN.md` ejecutado entero con 0,01–0,05 SOL.
- [ ] Pasos 5 y 6 hechos.
- [ ] Respuesta legal recibida (paso 7) y `[pendiente]` de los textos legales rellenados.
- [ ] Fase 6 (infraestructura para dinero de terceros: base de datos, rate limiting compartido, auditoría con hash-chain,
      sesiones revocables, CSP con nonces) decidida: hoy la persistencia es Vercel Blob y el rate limiting es en memoria
      por instancia; ninguno es apto para dinero de terceros a escala.
