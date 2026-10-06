# Draw Your Trade — guía de prueba con wallet real

Requisitos: `FEATURE_STRATEGIES` activado para tu wallet, SOL en la wallet, y una moneda con liquidez suficiente.
Cada prueba usa un mínimo de 10 $ por orden. Ninguna prueba debe mover más de lo necesario.

## Combinaciones (ya implementadas)

Para cada una: abre la moneda, dibuja las patas indicadas, confirma y mira la firma en Phantom.

1. **Solo compra** — dibuja solo la compra por debajo del precio actual (≥ 10 $).
   Esperado: una firma de depósito + comisión. En la lista aparece "Compra a $X · sin stop" y el aviso "Sin stop loss…".
2. **Solo venta** (requiere tener la moneda) — dibuja solo la venta por encima del precio, al 100%.
   Esperado: "Venta a $X". Sin saldo: la fila de venta aparece desactivada con "No tienes $MONEDA".
3. **Solo stop** (requiere tener la moneda) — dibuja solo el stop por debajo del precio, al 100%.
   Esperado: "Stop a $X".
4. **Venta + stop** (requiere tener la moneda) — venta por encima y stop por debajo, al mismo porcentaje.
   Esperado: una sola firma, orden tipo oco (un solo depósito de tu moneda).
5. **Compra + venta + stop** — la estrategia completa de siempre (otoco). Sin cambios.
6. **Compra + venta** y **compra + stop** — NO deben ofrecerse: el botón Confirmar no se activa y el servidor rechaza la petición.

Comprobaciones comunes: la "x" quita una pata; el resumen cambia; si la venta no está por encima del precio, aparece el aviso y no se confirma.

## Lote de porcentajes (pendiente de implementar)

Esta parte aún no está construida: el porcentaje sobre el gráfico (25/50/75/100 y "Otro") y el lote firmado
con `signAllTransactions` llegarán en la siguiente entrega. Cuando esté, la prueba será:

1. Pulsa 25% y toca el gráfico a un precio: aparece "Venta · 25% · $X".
2. Repite con 50% en otro precio: la suma no puede pasar de 100%; el botón restante aparece desactivado con
   "Solo te queda un X% por asignar".
3. Confirma una sola vez: una aprobación en Phantom firma todas las órdenes del lote.
4. Si una orden del lote falla al enviarse, las demás del lote se cancelan y se avisa.
5. Mínimo: una línea que valga menos de 10 $ se marca en rojo y no deja confirmar.
