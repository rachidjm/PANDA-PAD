# Holder Rewards automático — guía de prueba con 1–2 €

Requisitos: `FEATURE_HOLDER_REWARDS` activo, `NEXT_PUBLIC_PANDA_REWARDS_POOL` apuntando a tu wallet del pool,
`PANDA_REWARDS_POOL_SECRET_KEY` con su clave, `CRON_SECRET` puesto, y esa wallet con SOL (ver más abajo cuánto).

## 1. Crea o usa una moneda con banda "Holders"

En `/create`, en Fee Distribution, pon un % a "Holders" (por ejemplo 20%) al lanzar la moneda, o usa una que ya
tengas con esa banda activa. Apunta su `mint`.

## 2. Genera comisiones reales

Haz una compra y una venta pequeñas de esa moneda (1-2 € es de sobra) desde una PRIMERA wallet tuya. Cada
operación genera comisión de creador on-chain; esa comisión se queda esperando en el programa de Pump.fun
hasta que alguien dispare `distributeCreatorFees` (el cron lo hace solo).

## 3. Ten una SEGUNDA wallet con saldo de esa moneda

Esa segunda wallet necesita tener la moneda (compra una cantidad pequeña con ella también) — es la que va a
recibir el pago automático, para comprobar que llega a una wallet distinta de la primera.

## 4. Ejecuta el cron a mano

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" "https://TU-DOMINIO/api/cron/collect-fees"
```

La respuesta trae, por moneda, `distributedLamports` (lo recolectado en esta pasada) y `payout` (`ran`,
`reason` si no corrió, `holdersPaid`, `lamportsPaid`). Si tu moneda aparece con `payout.ran: false` y
`reason: "below_threshold"`, el Holders pool de esa moneda aún no llega a `HOLDER_PAYOUT_MIN_SOL` (0,1 SOL por
defecto) — repite la compra/venta unas veces, o baja `HOLDER_PAYOUT_MIN_SOL` solo para esta prueba.

## 5. Comprueba el pago

- En la wallet del Explorer de Solana (o Phantom) de tu SEGUNDA wallet: debe haber recibido SOL directamente,
  sin que firmaras nada desde ella.
- En `/coin/<mint>` → pestaña "Rewards": "Repartido a holders hasta ahora" y "Último reparto" con su enlace a
  Solscan.
- En `/rewards` (conectado con la segunda wallet): "Recibido" debe reflejar el pago.
- En Postgres: `reward_claims` tiene una fila `status = 'confirmed'` para esa wallet, con `run_id` apuntando a
  una fila de `holder_payout_runs`.

## 6. Prueba el "no se paga dos veces"

Ejecuta el cron otra vez inmediatamente. La segunda wallet no debe recibir un segundo pago por la MISMA
comisión — su saldo en `reward_balances` ya tiene `claimedLamports` cubriendo lo que se le debía; solo una
NUEVA operación (que genere una NUEVA comisión) produce un pago nuevo.

## 7. Umbral y mínimo por wallet

- Una moneda cuyo Holders pool no llega a `HOLDER_PAYOUT_MIN_SOL` no se reparte ese turno — se queda en la
  wallet del pool para la siguiente recolección.
- Una wallet cuya parte, aun así, no llega al mínimo de una cuenta normal (~0,00089 SOL) no se envía esa
  ronda tampoco — simplemente espera a acumular más.

## Variables de Vercel para encender `FEATURE_HOLDER_REWARDS`

| Variable | Valor | Notas |
|---|---|---|
| `FEATURE_HOLDER_REWARDS` | `true` | El interruptor general |
| `NEXT_PUBLIC_PANDA_REWARDS_POOL` | la dirección pública de tu wallet del pool | Ya la tienes puesta |
| `PANDA_REWARDS_POOL_SECRET_KEY` | la clave privada de esa misma wallet | Sensible — Vercel la marca como secreta |
| `CRON_SECRET` | una cadena aleatoria de 16+ caracteres | Ya la tienes puesta para el cron diario anterior |
| `HOLDER_PAYOUT_MIN_SOL` | opcional, por defecto `0.1` | Mínimo acumulado por moneda antes de repartir |
| `REWARDS_DAILY_CAP_SOL` | opcional, por defecto `20` | Tope de SOL repartido al día, todas las monedas juntas |
| `REWARDS_MAX_CLAIM_SOL` | opcional, por defecto `2` | Tope por pago a una sola wallet en una ronda (una wallet enorme se paga en varias rondas) |

El cron pasó de diario a cada 5 minutos (`vercel.json`) — ya no hace falta tocar nada más para que corra solo.

## Cuánto SOL necesita PANDA REWARDS para el gas

Cada ejecución del cron que encuentra algo que hacer paga: una transacción de `distributeCreatorFees` por
moneda con comisión real que recolectar, más un lote de transferencias por cada moneda cuyo Holders pool cruza
el mínimo (agrupadas de 10 en 10, ~5.000 lamports de red por transacción, agrupar no las encarece). La
mayoría de las ejecuciones (cada 5 min) no encontrarán nada nuevo y no gastan nada. Con un puñado de monedas
activas, el gasto de red realista ronda 0,01–0,05 SOL al día — pero deja un margen cómodo:

- **Recomendado para empezar:** al menos **0,5 SOL** en la wallet PANDA REWARDS — cubre de sobra el gas de
  varias semanas y dejó margen para la prueba de este apartado (los pagos reales a holders salen de las
  comisiones que la propia wallet recolecta, no de este margen).
- El código nunca deja que un pago baje el saldo del pool por debajo de ~0,01 SOL (`POOL_RESERVE_LAMPORTS`) —
  si se acerca, verás una alerta ("Rewards Pool is nearly empty") en vez de una wallet que se queda a cero.
