# Prueba real de Draw Your Trade y Stop Loss / Take Profit (la ejecutas tú)

**Antes de nada, dos cosas que cambian el plan que esperabas:**
1. **Mínimo de Jupiter: 10 USD por estrategia** (`MIN_ORDER_USD`, `src/lib/strategy/plan.ts:31`). Con 1–2 € no se puede: usa **~10–12 USD (≈ 9–11 €)**. La comisión de PANDA de esa prueba es 1 % = **~0,10 USD**.
2. **La prueba necesita el flag encendido**: con `FEATURE_STRATEGIES` sin definir todas las rutas dan 403 y la UI no existe. Así que la ventana de prueba es: pones `FEATURE_STRATEGIES=true` en Production, redespliegas, pruebas, y si algo falla lo quitas y redespliegas. Mientras dure, **cualquier visitante verá la función** (con su aviso de custodia y el mínimo de 10 USD). Si prefieres no exponerla ni unos minutos, dímelo y añado una lista de wallets permitidas para la prueba (`STRATEGIES_ALLOWED_WALLETS`) antes de encender nada.

**Quién puede mover los fondos de la bóveda** (para que lo tengas claro antes de depositar): la bóveda es una cuenta custodial de Privy en el servicio de Jupiter Trigger. PANDA no tiene claves ni acceso (ni una línea de código de `src/lib/strategy`, `src/lib/jupiter` o sus rutas guarda una clave o firma; un test lo vigila). Jupiter ejecuta las órdenes cuando se activan; solo tú retiras, firmando la cancelación.

## Requisitos
- `JUPITER_API_KEY` en Vercel (ya está). Wallet con ≥ 12 USD en SOL (o USDC) + ~0,01 SOL para redes.
- Una moneda con **liquidez ≥ 5.000 USD** y precio en vivo (GeckoTerminal), y volátil si quieres ver una ejecución (una buena candidata: cualquiera de la lista "Tendencia"). La orden no puede pasar del 5 % de su liquidez (no es problema con 10 USD).
- Sesión iniciada con la wallet (una firma de mensaje gratis) y, en la primera acción, **otra firma de mensaje para Jupiter**.

## A. Draw Your Trade (crear → ejecución → cancelación)
1. En la moneda: **Set Buy** a ≥ 0,2 % por debajo del precio actual (menos "se dispararía al instante"), **Set Sell** por encima del buy y **Set Stop** por debajo. Importe 10–12 USD (selector USD/€/SOL). Comprueba que la tarjeta muestra el aviso de custodia (de quién es la bóveda) y la comisión: **1 % = 0,5 % compra + 0,5 % venta**.
2. **Confirm Strategy**: firmas (a) inicio de sesión de Jupiter, (b) el depósito a la bóveda y (c) la comisión de PANDA. La estrategia pasa a **Waiting** ("sigue funcionando en Jupiter aunque cierres la página").
3. **Comisión (verify-tx).** Busca en tu wallet la transferencia pequeña a `DCZaeTXLDwkwE4a8xayS3o9hCiPwgH1deotvyS5VEE6n` y ejecuta:
   ```bash
   npm run verify-tx -- <firma de la comisión> --treasury DCZaeTXLDwkwE4a8xayS3o9hCiPwgH1deotvyS5VEE6n
   ```
   Saldrá `NOT_A_TRADE` (no es un swap: es solo la comisión) pero la línea `paid to treasury` debe ser **el 1 % del importe en SOL**: `importe_USD × 0,01 ÷ precio_SOL` (p. ej. 10 USD con SOL a 120 USD → ≈ 833.000 lamports, ±2 % por el precio del momento). El importe esperado también lo guarda la estrategia (`feeLamports`).
4. **Ejecución** (depende del mercado): con el buy a −0,3 % en una moneda volátil suele saltar en minutos; si no salta en ~1 h, pasa a C y repite luego. Cuando salte: estado **Buy triggered → Position open**, y luego **Sell triggered → Completed** (o cerrada por el stop). Cada transacción de Jupiter aparece con su enlace. Solo cuenta como comprado/vendido cuando está confirmado on-chain.
5. **Sin PANDA en medio:** la compra y la venta las ejecuta Jupiter desde la bóveda; PANDA no firma nada. La comisión de PANDA ya se pagó en el paso 2 y **no se devuelve** si cancelas antes de que compre.

## B. Cancelación
1. Con otra estrategia igual (o la misma si aún está en **Waiting**), pulsa **Cancel strategy**: firmas la retirada; los fondos vuelven **a tu wallet**. Comprueba el saldo y que el estado pasa a **Cancelled**.
2. Comprueba que **la comisión no se devolvió** (lo dice la propia tarjeta).

## C. Stop Loss / Take Profit sobre una posición (sin comisión de PANDA)
1. Con ≥ 10 USD de esa moneda en la wallet, abre **Stop Loss / Take Profit → Set up**, pon SL y TP, firma inicio de Jupiter + depósito. Aparece en **Active orders**.
2. Comprueba que **no hay ninguna transferencia a la tesorería** (PANDA no cobra en SL/TP).
3. **Cancel** → firma la retirada → los tokens vuelven a tu wallet.

## Qué me pasas (o me dices "todo OK")
- La firma de la comisión y el resultado de `verify-tx`.
- Los estados por los que pasó y las firmas de Jupiter si hubo ejecución.
- Cualquier error que salga en pantalla (te pediré el texto exacto).

## Si todo sale bien
Dejas `FEATURE_STRATEGIES=true` en Production (ya está encendido). Los textos legales de custodia (aviso legal, términos, privacidad, riesgos, aviso general, cookies) aparecen solos con el flag, y el pie de página cambia a "algunas funciones opcionales son la excepción".

## Si algo falla (marcha atrás)
1. **Cancela primero cualquier orden abierta** (los fondos están en la bóveda de Jupiter: solo tú puedes retirarlos).
2. Quita `FEATURE_STRATEGIES` en Vercel y redespliega: la UI y las rutas desaparecen.
