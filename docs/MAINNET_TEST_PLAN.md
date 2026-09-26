# PANDA — plan de pruebas en mainnet (importes mínimos)

Objetivo: comprobar con **dinero real y de importe mínimo (0,01–0,05 SOL por prueba)** cada flujo del núcleo que hoy solo se
ha probado por simulación. Las transacciones las firmas **tú**, con tu wallet; ni yo ni el código de pruebas tocamos ninguna
clave. Lo único que se ejecuta desde la línea de comandos es de **solo lectura**.

**Regla de oro: si una prueba falla, PARA.** Guarda la firma de la transacción (o el mensaje exacto de la pantalla) y
pásamela antes de seguir. No repitas a ciegas: una compra repetida son más comisiones.

> Marcado **(sin verificar)** = algo que no puedo garantizar desde el código (comportamiento de Phantom, precios de
> Pump.fun…). Si el resultado real difiere, anótalo: eso es justo lo que se busca.

---

## 0. Preparación (una vez)

1. **Wallet de pruebas.** Una wallet Phantom nueva y aparte (no la personal ni la de la tesorería), con **≈ 0,3 SOL**.
   Reparto orientativo: las pruebas de trading ≈ 0,07 SOL entre compras y ventas; cada primera compra de una moneda abre
   una cuenta de token (≈ 0,002 SOL de renta, recuperable cerrando la cuenta); crear una moneda cuesta más que un trade
   (renta de cuentas + red; el importe exacto de Pump.fun **(sin verificar)**: mide tu saldo antes y después).
2. **Despliegue en verde.** Con sesión de admin, abre `https://<tu-dominio>/api/health/trading` (sin ella da 404) y comprueba: `ok: true`,
   `network.state = "ok"`, `moneyFlows.allowed = true`, ninguna variable obligatoria `absent`/`invalid`, tesorería con
   ≥ 0,002 SOL. Si algo está en rojo, corrígelo antes (`docs/DEPLOY_CHECKLIST.md`).
3. **Herramientas de solo lectura** (en tu máquina, en la carpeta del proyecto). Necesitan `SOLANA_RPC_URL` de mainnet en tu
   entorno o `--rpc <url>`:

   ```bash
   npm run verify-tx -- <firma> --treasury <dirección de la tesorería>
   ```

   ```bash
   npm run check-sharing -- <mint>
   ```

   `verify-tx` lista las cuentas de la transacción, cuánto SOL llegó a la tesorería y si es el 0,5 % esperado.
   `check-sharing` lee la configuración de comisiones on-chain de una moneda. Ninguno usa claves ni envía nada.
4. **Solscan.** Para cada firma: `https://solscan.io/tx/<firma>`.
5. **Cómo se calcula el 0,5 % esperado** (para comprobarlo a mano): *compra* → 0,5 % del SOL que compra (se **suma** a lo
   que pagas); *venta* → 0,5 % del SOL bruto que recibes (se **resta** de lo que recibes). Ej.: compra de 0,02 SOL →
   comisión de 100.000 lamports (0,0001 SOL).
6. Anota la tesorería **antes** de empezar (saldo en Solscan): `________ SOL`.

Tabla de resultados (rellénala según avances):

| # | Prueba | Firma(s) | verify-tx | Resultado |
|---|---|---|---|---|
| 1 | Bonding curve, PC | | | ☐ |
| 2 | Bonding curve, móvil | | | ☐ |
| 3a | Graduado, PumpSwap | | | ☐ |
| 3b | Externo, Jupiter | | | ☐ |
| 4 | Token-2022, curva viva | | | ☐ |
| 5 | Comisión 0,5 % (compra y venta por separado) | | | ☐ |
| 6 | Crear moneda Estándar | | | ☐ |
| 7 | Errores provocados | | | ☐ |
| 8 | /activity, Portfolio, Analytics | | | ☐ |

---

## Prueba 1 — Compra y venta por bonding curve (Phantom, PC)

**Importe:** compra **0,02 SOL**, venta del 100 % de lo comprado. (0,02 y no 0,01 a propósito: el feed de /activity descarta
operaciones de menos de 0,01 SOL de movimiento, y una venta de 0,01 SOL devuelve algo menos de 0,01 — así la prueba 8 puede verlas.)
**Elige la moneda:** en Discover/Home, una moneda cuya tarjeta indique curva de Pump.fun (en su página, el texto bajo el
botón dice "Real on-chain trade via Pump.fun"). Evita las que tengan el aviso rojo "PANDA ha marcado los datos… poco fiables".

**Pasos**
1. Conecta Phantom (red mainnet) en la web. Comprueba que el saldo mostrado en el panel es el de tu wallet.
2. Abre la moneda → pestaña **Buy**. Escribe `0.02` (SOL). Comprueba el resumen: *Importe 0.0200 SOL · Comisión PANDA (0.5%)
   0.0001 SOL · Pagas 0.0201 SOL* (el 0,5 % de 0,02 son 0,0001 SOL = 100.000 lamports).
3. Pulsa **Buy $TICKER**. Phantom abre la firma: revisa que muestra un **envío de ≈ 0,0001 SOL a la dirección de tu
   tesorería** además de la operación de Pump.fun. Confirma.
4. Espera a que el botón diga "Bought!" y aparezca el enlace "View transaction". Guarda la firma: `________`.
5. Pestaña **Sell** → botón **100%** → **Sell**. Phantom debe mostrar de nuevo el envío a la tesorería. Confirma. Guarda la
   firma: `________`.

**Esperado:** ambas transacciones `Success`; la compra suma tokens a tu wallet y la venta los deja a 0; recibes SOL menos
la comisión.
**En Solscan (cada firma):** instrucciones en este orden aproximado: Compute Budget (límite y precio de prioridad) → *System
Program: Transfer* a la tesorería → (en la primera compra) creación de la cuenta de token → instrucción del programa de
Pump.fun. `Fee` de red ≈ 0,000005 SOL + prioridad (máx. ≈ 0,00003 SOL). En *Token Balance Changes*: tu cuenta +N / −N.
**Verificación:** `npm run verify-tx -- <firma> --treasury <tesorería>` → `VERDICT: MATCH` en compra y en venta.

## Prueba 2 — Lo mismo en Phantom móvil (incluye el flujo de sesión)

**Importe:** compra 0,02 SOL + venta 100 %, otra moneda de curva.
1. Abre la web **dentro del navegador de la app Phantom** (la vía habitual en móvil; WalletConnect no está implementado).
   **(sin verificar: que Phantom móvil inyecte el proveedor en su navegador integrado tal como espera el adaptador)**.
2. Repite la prueba 1 completa. Fíjate en: que el panel de compra cabe en pantalla, que "Pagar con" y "Ver" se usan con el
   dedo, y que el aviso de Phantom aparece sin cortar la interfaz.
3. **Flujo de sesión** (firma de mensaje): en el núcleo, el inicio de sesión con la wallet solo se pide al **reclamar
   recompensas** (página Rewards) y en funciones apagadas. Si tu wallet de pruebas no tiene nada que reclamar, esta parte no
   se puede ejercitar desde la interfaz: márcala **N/A** y no fuerces nada. Si sí aparece el botón de iniciar sesión, pulsa
   y comprueba que Phantom pide **una firma de mensaje (gratuita, sin transacción)** y que la web te reconoce después.

**Esperado / Solscan / verificación:** igual que la prueba 1 (`MATCH` en ambas).

## Prueba 3 — Token graduado: PumpSwap y ruta Jupiter

**3a. PumpSwap.** Una moneda con fuente PumpSwap (página: "Graduated to PumpSwap — real on-chain trade via Pump.fun's AMM").
Compra 0,02 SOL y venta 100 %. Pasos como la prueba 1.
- Solscan: programa **PumpSwap (AMM)** (`pAMMBay6…`), no el de la curva. Un pool puede tener SOL o la moneda como "base": no
  debe importar al usuario; anota cuál viste.
- `verify-tx` → `MATCH`.

**3b. Ruta Jupiter.** Una moneda que **no** es de Pump.fun (búscala por nombre en el buscador; su página dice "Not a Pump.fun
coin — routed via Jupiter…"). Compra 0,02 SOL y venta 100 %.
- Solscan: instrucciones de **Jupiter v6** con la transferencia a la tesorería incluida en la misma transacción.
- `verify-tx` → `MATCH` (la comisión va como transferencia de nivel superior en la transacción versionada).
- Si Jupiter no encuentra ruta: el mensaje debe ser el traducido "no route" — anótalo y prueba otra moneda.
- **Opcional (0,01–0,02 SOL):** compra pagando con **USDC** desde el desplegable "Pagar con" (solo monedas graduadas/externas).
  Esperado: la comisión sale en **SOL** aparte y `verify-tx` no la reconoce como "trade contra SOL" (`NOT_A_TRADE`): es
  correcto porque el pago es en USDC; comprueba en Solscan la transferencia de comisión a la tesorería.

## Prueba 4 — Token-2022 con la curva todavía viva

**Importe:** compra 0,01 SOL (y venta 100 % si sale bien).
**Encontrar la moneda:** las monedas nuevas de Pump.fun son Token-2022 y muchas de las que la web lista como "de curva" ya
están graduadas. Busca una **reciente, aún en curva**, abre su mint en Solscan y comprueba que *Token Program* es
**Token-2022** (`TokenzQd…`). **Si en ese momento no hay ninguna, márcala N/A y repítela otro día**: esta ruta está
corregida en el código pero **nunca se ha simulado ni firmado con una curva viva de Token-2022**.
**Esperado:** compra `Success`. En Solscan las cuentas de token usan el programa Token-2022. `verify-tx` → `MATCH`.
Si falla con "incorrect program id" o similar, es exactamente el bug que se corrigió: pásame la firma.

## Prueba 5 — Comisión del 0,5 % en la tesorería, compra y venta por separado

Usa las firmas de las pruebas 1–3 (o haz una compra y una venta de 0,02 SOL solo para esto).

| Operación | Base (SOL) | 0,5 % esperado (lamports) | Enviado a tesorería (verify-tx) | Δ saldo tesorería (Solscan) | ¿Coincide? |
|---|---|---|---|---|---|
| Compra | | | | | ☐ |
| Venta | | | | | ☐ |

**Pasos:** para cada firma ejecuta `verify-tx`; anota `paid to treasury` y `treasury balance … change`. Luego compara con el
saldo de la tesorería en Solscan **antes/después** de cada operación.
**Esperado:** `paid to treasury` = 0,5 % de la base dentro de la tolerancia que imprime el script (la base se **estima** desde
los saldos; en ventas con cuentas cerradas es aproximada) y el cambio real de saldo de la tesorería **es igual** al
transferido. Compra y venta se comprueban por separado: en la compra la comisión se suma a lo que pagas; en la venta se
resta de lo que recibes.
**Caso especial a provocar una vez:** con la tesorería recién fondeada a 0,002 SOL, una compra de 0,01 SOL debe cobrar su
comisión. (Con la tesorería en 0 SOL el trade se ejecuta **sin** comisión: `verify-tx` lo etiqueta `SKIPPED_BY_DESIGN`.)

## Prueba 6 — Crear moneda Estándar con primera compra mínima

**Requisito previo:** en mainnet la creación está bloqueada hasta que `TREASURY_IS_MULTISIG=true` (tesorería en Squads,
`docs/DEPLOY_CHECKLIST.md` §4.1). Si no, `/create` muestra el aviso "Crear monedas está en pausa" y el botón Launch no se activa:
eso ya es una comprobación (anótala); para el resto de la prueba, cumple el requisito.
**Importe:** primera compra 0,01 SOL (+ coste de crear, ver preparación).
**Cómo es un lanzamiento (importante):** crear la moneda y fijar el reparto **no cabe** en una transacción normal (1.238–1.347
bytes frente al límite de 1.232). Hay dos caminos, según `PANDA_LOOKUP_TABLE` (`docs/DEPLOY_CHECKLIST.md` §4.2):
- **Con la lookup table (recomendado): una sola firma** (v0, atómica) para la moneda + su reparto, y otra para la primera compra.
- **Sin ella (respaldo): tres firmas** — crear, fijar el reparto y la primera compra — y la moneda se oculta de las listas hasta fijarlo.
Comprueba cuál usa tu despliegue: `GET /api/protocol/status` → `creation.singleTx` (`true` = una firma).

**Pasos**
1. `/create` → modo Estándar (con los flags por defecto no hay selector Rewards).
2. Sube una imagen, pon nombre, ticker y descripción. En **Fee distribution** el reparto es **PANDA 5 % bloqueado + Creator +
   partner opcional** (no hay banda Holders: `FEATURE_HOLDER_REWARDS` está apagado). Déjalo en Creator 95 %.
3. En "Tu primera compra" escribe `0.01`. **Launch** → revisa el modal (dice si se aprueba una transacción o dos) → confirma.
4. Phantom pide, en orden: la creación (con el reparto, si hay tabla), el reparto aparte (solo sin tabla) y la primera compra.
5. Guarda: mint `________`, firma de creación `________`, firma del reparto `________` (la misma que la de creación con tabla), firma de compra `________`.
6. **Caso a provocar una vez, solo sin tabla:** en otra creación, **rechaza la segunda firma**. Esperado: la pantalla final dice "Tu moneda ya
   existe, pero su reparto de comisiones aún no está fijado" con el botón **Fijar el reparto de comisiones**. Además: la moneda **no aparece**
   en inicio, Discover, búsqueda ni Activity; al abrir su página con la wallet creadora sale el aviso persistente con el botón; en
   `/admin` (auditoría) hay un evento `token.created_without_fee_split`. Púlsalo y aprueba: la moneda vuelve a las listas y aparece
   `token.fee_split_locked`. (Con tabla este caso no existe: o hay moneda y reparto, o ninguno.)
7. **Con tabla:** rechaza la única firma → no existe nada on-chain. Y `npm run check-lookup-table` → `CHECK OK` antes de empezar.

**Esperado:** pantalla "…is live"; la moneda aparece en Pump.fun; la primera compra se ve en tu wallet.
**En Solscan:** la firma de creación tiene la instrucción `create_v2` de Pump.fun; la del reparto tiene las instrucciones que
crean y actualizan el `SharingConfig` (create fee sharing config / update fee shares).
**Verificación del `SharingConfig` on-chain:**

```bash
npm run check-sharing -- <mint>
```

Esperado: `CHECK OK` — reparto total 100 %, tu wallet con 95 % y la **tesorería con el 5 %**. Comprueba también:
- `adminRevoked`: si es **FALSE**, el `admin` que imprime todavía tiene derechos sobre la configuración. **Lo que puede
  cambiar exactamente el admin lo define el programa de Pump.fun, no PANDA (sin verificar)**: consulta su documentación
  antes de decirle a nadie que el reparto es permanente. La web hoy dice "escrito on-chain", no "permanente".
- Que el `admin` sea tu wallet (creador) y no una dirección de PANDA.
- `GET https://<tu-dominio>/api/pump/fee-shares?mint=<mint>` devuelve el mismo reparto.

Además: `verify-tx` sobre la firma de la **primera compra** → `MATCH`.

## Prueba 7 — Errores provocados

Todos con importes mínimos; ninguno debe dejar la app en un estado raro.

| Caso | Cómo provocarlo | Esperado |
|---|---|---|
| **Saldo insuficiente** | En Buy, escribe más SOL del que tienes (o pulsa Buy con 0,001 SOL en la wallet). | Antes de firmar: mensaje rojo con lo que hace falta y lo que hay ("Not enough SOL…"), botón desactivado, enlace "usar el máximo". **No se abre Phantom.** |
| **Rechazo en la wallet** | Pulsa Buy y **Reject** en Phantom. | Mensaje traducido de rechazo; el botón vuelve a estar disponible; nada enviado. |
| **Transacción expirada** | Pulsa Buy y **no** confirmes en Phantom durante ≈ 2 minutos; luego confirma. | Phantom o la red la rechazan; la web muestra el mensaje de "expiró / vuelve a intentarlo" (no "desconocido"). Sin cobro salvo, como mucho, comisión de red. |
| **Slippage** | **No se puede provocar desde la interfaz** (la tolerancia del 5 % no es editable). Solo ocurre si el precio se mueve más del 5 % entre construir y confirmar: prueba con una moneda muy volátil y el importe mínimo, **oportunista**. | Si ocurre: mensaje traducido de slippage y motivo real en Solscan. La clasificación está cubierta por tests con logs reales; aquí solo se confirma en vivo. |
| **RPC caído** (solo si puedes) | Pon un `SOLANA_RPC_URL` inválido en un despliegue **de Preview** y prueba a operar. | `/api/health/trading` en rojo, trades bloqueados o error claro; nunca una transacción a medias. |

## Prueba 8 — El trade aparece en /activity, Portfolio y Analytics

Requiere que **Blob** esté configurado (los tres leen de él). Hazla justo después de las pruebas 1–3, con la **misma wallet**.

1. **Portfolio** (`/portfolio`, wallet conectada): la moneda comprada/vendida sale en posiciones **cerradas** (si vendiste
   el 100 %) o abiertas, con cantidad y P&L. El P&L está marcado **estimado** o **registrado**: en operaciones hechas desde la
   web debería ser *registrado*. Un buy pagado con otro token (opcional 3b) **no** se registra (limitación conocida).
2. **/activity:** en menos de ≈ 1 minuto (caché de 30 s) aparecen tus compras/ventas con el ✓ de "verificado por PANDA" y
   enlace a Solscan. El feed descarta las operaciones de menos de 0,01 SOL de movimiento (umbral de `src/lib/activity/config.ts`): por eso las pruebas 1–3 usan 0,02 SOL.
3. **/analytics → PANDA economy:** *Volume through PANDA* = suma de la base de tus operaciones; *PANDA fees* = suma de las
   comisiones de `verify-tx`. Los totales **cuentan desde el primer evento registrado**, así que deben ser ≈ los de tus
   pruebas si es el primer uso.

Anota cualquier diferencia entre estas cifras y las de `verify-tx`: es una señal de que el registro (`record-trade`) no
guardó algo.

---

## Al terminar

- [ ] Todas las pruebas ✔ o N/A justificadas (Token-2022 y sesión móvil son las más probables).
- [ ] Saldo final de la tesorería = saldo inicial + suma de las comisiones de la prueba 5 (± las de otras pruebas).
- [ ] Cierra las cuentas de token vacías de la wallet de pruebas para recuperar la renta.
- [ ] Guarda las firmas y las salidas de `verify-tx`: son la evidencia de que el núcleo se probó con dinero real.
- [ ] Solo entonces plantéate abrir al público (`docs/DEPLOY_CHECKLIST.md`, "Antes de abrir al público").
