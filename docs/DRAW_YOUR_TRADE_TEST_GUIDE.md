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

## Lote de porcentajes

Para una moneda que ya tienes. Pulsa "+ Añadir estrategia" (no actives "Compra": así el borrador queda como
venta/stop por porcentaje) y verás dos filas, "Venta" y "Stop", cada una con 25/50/75/100 y "Más ▾" (5/10/15/Otro).

1. Pulsa 25% en "Venta": aparece "Ahora toca el gráfico" junto a esa fila. Toca el gráfico al precio que
   quieras: se dibuja la línea "↑/↓ Venta $X · 25%" y debajo, en la lista, "Venta · 25% · $X" con su "x" y el
   precio editable a mano.
2. Repite con 50% en otro precio: "Disponible" baja a 25%. Si pides más de lo que queda, el botón de ese % se
   desactiva.
3. Pulsa 25% en "Venta" y 25% en "Stop" (el mismo porcentaje en los dos): se emparejan en UNA sola línea de
   tramo con venta Y stop — es una orden "oco", no dos.
4. Arrastra la etiqueta de una línea ya dibujada: la sigue mientras arrastras y fija el nuevo precio al soltar,
   sin crear una línea nueva ni cambiar su %. Funciona igual con el dedo en móvil.
5. Una línea que valga menos de 10 $ (según el % y tu saldo) se marca en rojo con el motivo y no deja confirmar.
6. Pulsa "Confirmar estrategia": UNA sola aprobación en Phantom firma el depósito (y la comisión) de TODAS las
   líneas del lote. Si Jupiter rechaza una orden del lote después de firmar, las que ya se crearon se cancelan
   solas (con una aprobación extra) y aparece el aviso "Una de las órdenes del lote ha fallado…" — no debería
   quedar ninguna orden del lote activa.
7. Tras confirmar, las líneas del lote aparecen agrupadas en una sola tarjeta en "Estrategias guardadas", cada
   tramo con su propio estado y botón de cancelar.

## Campana de avisos

1. Con la wallet conectada, el icono de campana aparece en el encabezado (si no ves ninguno, es que
   `FEATURE_STRATEGIES` no está activo para esa wallet).
2. Tras una compra o venta que se haya ejecutado de verdad (puedes forzarlo pulsando "Sincronizar" en
   "Estrategias guardadas" si acabas de confirmar una), recarga la página o espera hasta 60 s: la campana
   muestra un punto rojo.
3. Ábrela: aparece "Tu compra de $MONEDA se ha ejecutado a $X" o "Tu venta de…", con la hora relativa; al
   pulsar una línea te lleva a la página de esa moneda. Al abrir la campana el punto rojo desaparece.
4. Cierra sesión del navegador (o borra `panda.notif.seen.<wallet>` de `localStorage`) y vuelve a entrar: las
   ejecuciones ya ocurridas deben volver a marcarse como no leídas.
