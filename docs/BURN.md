# 🔥 Burn — una parte de las comisiones que compra la moneda y la quema

`FEATURE_BURN` (apagado por defecto). Código: `src/lib/burn/`, `src/lib/db/burn.ts`, `src/app/api/cron/burn`,
`src/app/api/burn/summary`.

## Qué es

Al crear una moneda, en el reparto de comisiones, el creador puede dar un % a **🔥 Burn** (junto a Creador, Holders y
Socios; el 5 % de PANDA sigue fijo). Esa parte se paga, en la cadena, a la **wallet de quema** de PANDA. Cada 5 minutos un
cron mira qué monedas han reunido al menos `BURN_MIN_SOL` (0,05 SOL por defecto) y, para cada una:

1. **compra** esa misma moneda con ese SOL (la compra normal de Pump.fun / PumpSwap; si el pool no está emparejado con
   SOL, la misma compra por la ruta de Jupiter). Sin comisión de PANDA;
2. **quema** todo lo comprado con la instrucción de quema del programa de tokens (`BurnChecked`) y cierra la cuenta
   vacía. Los tokens dejan de existir; no se envían a ninguna dirección.

## Garantías

- **Wallet aparte.** La wallet de quema no es la del reparto a holders: el dinero de los holders nunca se mezcla.
- **Cada moneda, lo suyo.** Un libro de apuntes dice cuánto ha recibido la wallet por cada moneda (leído de la propia
  transacción de reparto, una vez por transacción) y cuánto ha gastado. Una moneda nunca gasta lo de otra.
- **Se simula antes de enviar.** Una transacción que fallaría no se envía.
- **Se apunta antes de enviar** (con el máximo que puede costar) y se cierra después con lo que dice la cadena. Si un
  envío se queda sin respuesta, la siguiente pasada lo resuelve mirando la cadena.
- **Lo comprado siempre se quema.** Si una pasada se corta entre la compra y la quema, la siguiente encuentra la moneda
  en la wallet y la quema antes de nada.
- **Red de seguridad.** Un reparto que pagó a la wallet sin quedar apuntado (lo lanzó el creador a mano, o falló el
  apunte) se apunta después, leyendo las transacciones de la wallet.
- **Pausa de emergencia** `burns` en /admin: no se compra ni se quema nada (solo se cierran apuntes de lo ya ocurrido).
- **Auditoría**: cada pasada deja `cron.burn` en el registro; los fallos avisan a operaciones (una vez por hora).

## Qué se ve

- En la página de la moneda (web y mini app): **🔥 Quemados: X tokens**, con enlace a la última quema.
- En Telegram, tema **🔥 Burns**: un resumen por hora, cada moneda una vez: tokens quemados, SOL usado y la transacción.
- Solo hechos. Nunca se habla de precio ni se prometen quemas futuras.

## Cómo encenderlo (lo haces tú; nadie más ve la clave)

1. Crea una wallet NUEVA solo para esto (Phantom → añadir cuenta → nueva). No uses la del reparto ni la tuya.
2. En Vercel → Settings → Environment Variables (Production):
   - `NEXT_PUBLIC_PANDA_BURN_WALLET` = la dirección pública de esa wallet.
   - `PANDA_BURN_WALLET_SECRET_KEY` = su clave privada exportada (base58). Nunca una frase semilla. Pégala solo en Vercel.
   - `FEATURE_BURN` = `true`.
   - Opcional: `BURN_MIN_SOL` (por defecto 0.05) y `TELEGRAM_TOPIC_BURNS`.
3. Redeploy (las variables `NEXT_PUBLIC_` se leen al compilar).
4. Envía a esa wallet ~0,02 SOL para las primeras comisiones de red.
5. Prueba sin enviar nada: `npm run burn:simulate -- <dirección de una moneda> 0.05`.

## Tema de Telegram

En el grupo: ⋯ → Crear tema → nombre `🔥 Burns`. Escribe `/chatid` dentro de ese tema: el bot responde con el id del
tema. Ponlo en Vercel como `TELEGRAM_TOPIC_BURNS`. Sin esa variable, el resumen sale en el tema general.

## $PANDA

El reparto de $PANDA en la cadena (5 % PANDA, 30 % creador, 65 % holders) tiene la autoridad **revocada**
(`adminRevoked: true` en su configuración de reparto de Pump.fun): nadie puede cambiarlo ya, tampoco para añadir Burn.
Lo único posible sin tocar el reparto es voluntario y fuera de él (por ejemplo, que el creador compre y queme por su
cuenta con su 30 %); eso no pasa por este sistema.
