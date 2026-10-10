# Órdenes PANDA (ventas y stops pre-firmados)

Ventas, stops y venta+stop (OCO) sobre una moneda que el usuario **ya tiene**, con cualquier porcentaje y **sin mínimo de 10 USD**. Solo monedas de Pump.fun (curva) y PumpSwap cotizadas en SOL. El trade completo con compra (compra + venta + stop) sigue en Jupiter Trigger, y el resto de monedas también.

## Cómo funciona

1. El usuario dibuja sus líneas en Draw Your Trade (5/10/15/25/50/75/100 % u Otro).
2. La primera vez, una aprobación crea sus **cuentas nonce** (una por tramo, a nombre de su wallet; depósito ≈ 0,00106 SOL cada una, recuperable).
3. Una segunda aprobación firma **todas** las órdenes a la vez. Cada orden es una transacción con *durable nonce*: "vende X tokens y recibe al menos Y lamports". La venta y el stop de un mismo tramo comparten nonce: la primera que se ejecuta invalida la otra (OCO).
4. El servidor comprueba byte a byte que lo firmado es lo que preparó (si la wallet modifica la transacción, se rechaza) y la guarda **cifrada** (`PANDA_ORDERS_KEY`).
5. El vigilante (`/api/cron/panda-orders`, cada minuto, ~50 s de bucle, comprobación cada ~1,5 s) lee la cotización exacta de la curva o del pool. Cuando se alcanza el nivel, **simula** la transacción del usuario y, solo si pasa, la envía tal cual.
6. Venta: mínimo firmado = precio marcado − 1 %. Stop: − 3 %. Si el mercado no paga ese mínimo, **no se vende** (el usuario acepta este riesgo con "Sí" antes de firmar un stop).

El servidor **no puede** cambiar nada de lo firmado (cantidad, mínimo, comisiones, destino). Solo puede enviarlo o no.

## Avisos (campana)

- Ejecutada (venta o stop).
- Hay que volver a firmar: la moneda pasó a PumpSwap, Pump cambió su programa, ya no hay saldo, o falló en la red.
- Stop alcanzado que no se pudo vender por deslizamiento (sigue activo).
- Falta SOL para la comisión de red.

## Comisiones

La comisión de trading de PANDA (1 % por defecto, 0,5 % referido/veterano) sobre el **mínimo garantizado**, dentro de la misma transacción, con el 30 % del reclutador pagado directo a él, igual que en el trading normal. Solo se cobra si la orden se ejecuta.

## Encenderlo (pasos del propietario)

1. **Crear la tabla de direcciones** (una vez; deja la tabla congelada para siempre). Sin ella, las órdenes de PumpSwap con reclutador no caben en una transacción y se rechazan:
   ```bash
   npm run create-orders-lookup-table -- --rpc <url> --curve <mint1>,<mint2> --amm <mint3>,<mint4>
   ```
   Eso es una prueba en seco. Para crearla de verdad, añade `--keypair <archivo> --yes` (wallet con ~0,02 SOL). Necesita dos monedas en curva cotizadas en SOL y dos ya migradas a PumpSwap, solo como muestra.
2. En Vercel (Production):
   - `PANDA_ORDERS_KEY` = 32 bytes aleatorios en base64 (marcar como **Sensitive**).
   - `PANDA_ORDERS_LOOKUP_TABLE` = la dirección que imprime el paso 1.
   - `FEATURE_PANDA_ORDERS=true`.
3. Redesplegar.
4. Probar con importes pequeños (abajo).

**Quién lo ve (lanzamiento por fases):** solo las wallets de `ADMIN_WALLETS` y las de `PANDA_ORDERS_ALLOWLIST` (separadas por comas). Si la variable no existe, solo los admins. Para abrirlo a todo el mundo: `PANDA_ORDERS_ALLOWLIST=*` y redesplegar. El resto de usuarios sigue viendo Draw Your Trade con Jupiter, como antes.

**Tabla de direcciones de producción:** `33SheDtp2V21FVNwiLj3FiozzFDv9PbgPCAZvEjZq8Xk` (creada y congelada el 2026-10-09).

**Pausa de emergencia:** en `/admin`, el interruptor `panda_orders` detiene el vigilante y los endpoints al momento. Las órdenes firmadas siguen guardadas y el usuario puede cancelarlas desde su wallet.

**No cambies `PANDA_ORDERS_KEY`** con órdenes activas: dejarían de poder leerse (el vigilante avisa por alerta y no envía nada).

## Prueba con dinero real pequeño

1. Compra ~1–2 USD de una moneda de Pump.fun en curva.
2. Draw Your Trade: Venta 25 % por encima del precio y Stop 50 % por debajo. Acepta "Sí" y firma: 2 aprobaciones la primera vez.
3. En "Órdenes PANDA" aparece "Esperando". Cancela y comprueba que vuelve el depósito y que el estado es "Cancelada".
4. Repite con una venta muy cerca del precio (2–3 % por encima) y espera a que se ejecute: aviso en la campana de que se ha ejecutado, enlace a Solscan, el stop pasa a "Cancelada" (OCO).
5. "Recuperar depósitos" devuelve el depósito de la cuenta ya usada.
6. Repite en una moneda de PumpSwap.

## Límites conocidos

- Si Pump cambia su programa o la moneda migra, las órdenes dejan de valer y hay que volver a firmar (aviso en la campana).
- En caídas muy rápidas un stop puede no venderse (margen del 3 %).
- El vigilante depende del cron de Vercel: hay un hueco de unos segundos entre ejecuciones.
- Phantom puede mostrar un aviso propio al firmar transacciones con durable nonce.
- Curvas cotizadas en USDC y pools invertidos (SOL/token) no se admiten.

## Antes de firmar, cambiar una orden y cancelar una sola línea (octubre 2026)

- **Antes de abrir la wallet** el servidor comprueba que hay SOL suficiente (depósitos de las cuentas nuevas + comisión
  del depósito + una comisión de ejecución por tramo + margen: `requiredLamports`) y **simula cada transacción**
  (`sigVerify: false`). Si algo fallaría, la wallet no se abre y se dice el motivo. Una VENTA por encima del mercado
  «falla» en su propio mínimo hasta que el precio llega: eso es la orden funcionando, y pasa la comprobación. La wallet
  del usuario hace su propia simulación y puede mostrar un aviso por ese mismo motivo.
- **Una cuenta de órdenes nunca se pide dos veces.** El navegador manda la firma del depósito confirmado
  (`setupSignature`); si la lectura del servidor aún no ve la cuenta, responde «espera» en vez de otro depósito.
- **Cuenta de reserva.** Cada wallet con órdenes tiene una cuenta de órdenes libre de más (se crea en el mismo depósito
  que las de los tramos: N líneas → N + 1 cuentas). Mientras haya órdenes vivas no se ofrece en «Recuperar depósitos»;
  se devuelve al cancelar las últimas órdenes («Cancelar todo» la cierra en la misma transacción) o al recuperar
  depósitos cuando ya no queda ninguna orden.
- **Cambiar una orden / cancelar UNA línea de un tramo con dos** (`modify.ts`, `/api/panda-orders/modify` y
  `/modify/submit`): la orden vieja se anula DE VERDAD en la cadena. En UNA aprobación (lote) el usuario firma
  (1) una transacción que solo AVANZA el nonce de la cuenta vieja — es ella misma «durable» (su blockhash es ese nonce),
  así que no caduca mientras se lee la wallet — y (2) las órdenes del tramo tal como deben quedar (la línea cambiada y la
  pareja que sigue; al cancelar una línea, solo la que sigue) sobre la cuenta de reserva. PANDA envía (1) y SOLO cuando
  la cadena la confirma cambia las órdenes en su base de datos; la cuenta vieja pasa a ser la reserva. Si no se confirma
  (`advance_pending`), no se da nada por cambiado ni cancelado y el navegador vuelve a preguntar con la misma petición
  (es idempotente). Lo preparado viaja como un «ticket» sellado con la clave de órdenes; no se guarda nada intermedio.
  Una wallet con órdenes anteriores a la reserva la crea (un depósito) la primera vez que cambia una orden.
- La última línea de un tramo se cancela cerrando su cuenta (devuelve el depósito).
- **Órdenes ejecutadas en el gráfico** (`executions.ts`): al ejecutarse, la venta se añade al registro de operaciones de
  la wallet con los datos de su propia transacción (SOL recibido, monedas vendidas, hora del bloque) — lo hace el cron
  justo después, y también el listado de órdenes si faltara alguna. El gráfico la marca en esa hora y a ese precio real:
  «V» verde (venta) o «S» roja (stop), con «Ver transacción».
