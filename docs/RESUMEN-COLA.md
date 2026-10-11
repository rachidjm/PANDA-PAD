# Resumen de la cola de tareas — 11 de octubre de 2026

Las tres tareas están hechas, subidas a `main` y desplegadas. La mini app de Telegram queda con su flag apagado.

## 1. Por cada tarea

### Tarea 1 — Raydium LaunchLab: HECHA
- Investigación guardada en `docs/RAYDIUM.md`. Sin código de producto y sin transacciones reales.
- Simulación en mainnet (sin firmar ni enviar): registrar una plataforma y crear una moneda con primera compra en una sola transacción pasan.

### Tarea 2 — Arreglos pequeños: HECHA
- **Botón "? Cómo funciona":** ahora está justo encima del título "Dibuja tu operación", a la izquierda, debajo de la línea Mínimo/Máximo. Revisado en escritorio y en móvil (375 px), en inglés y español.
- **/watchlist del bot:** muestra el ticker ($PANDA), como /token. La dirección acortada solo aparece si ninguna fuente conoce la moneda.
- **Imagen por defecto de X:** es el logo de PANDA, `https://launchonpanda.app/logo.png`. Va en el código, así que no hace falta tocar Vercel; si pones `X_DEFAULT_IMAGE_URL`, manda esa.
- **Compra de Draw Your Trade con cualquier moneda:** quitado el bloqueo "solo SOL o USDC". Si eliges otra moneda, se cambia a SOL con Jupiter en el mismo lote de firmas, antes de la orden. Si el cambio falla, no se crea la orden. Misma comisión que pagando con SOL.
  - No lo he probado con una wallet real: el cambio a SOL es código nuevo y solo está cubierto por pruebas automáticas.

### Tarea 3 — Mini app de Telegram: HECHA, con el flag APAGADO
- **Bloque 1:** la app vive en `/tg`, se abre desde el bot ("🐼 Open PANDA app"). Pantallas de explorar, moneda con gráfico y datos, watchlist y alertas (las mismas del bot). Usa los colores de Telegram. La identidad se valida en el servidor con la firma de Telegram (HMAC) y caducidad de 1 hora, y se une a la wallet vinculada con /link.
- **Bloque 2:** operar sin custodia. El usuario firma en su propia app de Phantom o Solflare, con sus enlaces oficiales. Se usa el mismo panel de compra y venta de la web (comisiones, reclutadores, avisos, RugCheck). Hay botón "Abrir en el navegador" siempre.
- **Revisado en pantalla** en local, simulando Telegram con datos de ejemplo: móvil 375 px y escritorio, español e inglés, tema oscuro y claro.
- **No probado:** la firma con Phantom y Solflare en un teléfono real. Está probada contra una wallet simulada que sigue el protocolo oficial.
- **En producción, con el flag apagado:** `/tg`, `/telegram/wallet` y `/api/tg/*` responden 404 (comprobado).
- Pasos de BotFather: `docs/TELEGRAM.md`, sección 12.

## 2. Veredicto de Raydium

1. **SÍ, CON LIMITACIONES.** PANDA puede lanzar en LaunchLab como plataforma propia, igual que bonk.fun, sin permiso de Raydium.
2. Comisión de plataforma hasta el 5 % por operación (bonk.fun cobra 1–1,25 %); se cobra también en operaciones hechas fuera de PANDA.
3. Se mantienen: comisión a la Vault de Squads, primera compra obligatoria, una sola firma, dirección "…panda" y el 30 % del reclutador.
4. La limitación: el reparto creador / holders / socios no existe en la cadena en LaunchLab; tendría que repartirlo PANDA con su propio sistema.
5. Tiempo: unas 2 semanas para una primera versión, 4–5 semanas para la completa con órdenes PANDA y reparto.

## 3. Qué tienes que hacer tú al volver

1. **Lee `docs/RAYDIUM.md`** y decide si seguimos y con qué reparto (apartados 3 y 7).
2. **Prueba la compra con otra moneda:** en una moneda, Draw Your Trade → Compra → "Pagar con" → elige una moneda que no sea SOL ni USDC → importe pequeño → firma. Es posible que la wallet muestre un aviso en el depósito si no tienes SOL antes del cambio.
3. **El lunes** llegará por Telegram el resumen semanal con el changelog de la Tarea 2. Apruébalo o descártalo.
4. **Para encender la mini app** (cuando quieras):
   1. Vercel: `FEATURE_TELEGRAM_MINIAPP=true` y volver a desplegar.
   2. BotFather: `/mybots` → tu bot → Bot Settings → Configure Mini App → `https://launchonpanda.app/tg`.
   3. BotFather: Bot Settings → Menu Button → misma dirección, título `PANDA`.
   4. Prueba en tu teléfono: `/start` → abrir la app → conectar Phantom → una compra pequeña.
5. **Política de cookies:** he añadido una frase sobre dos datos que la mini app guarda en el navegador. Pásala por tu revisión legal si corresponde.

## 4. Decisiones que he tomado por mi cuenta

- **Imagen de X:** no puedo cambiar variables en Vercel, así que el logo queda como valor por defecto en el código.
- **"Mismas comisiones" en la compra con otra moneda:** lo he entendido como "la comisión de la orden no cambia". PANDA no cobra nada extra por el cambio a SOL; Jupiter aplica su ruta normal.
- **Margen del cambio:** la moneda elegida debe cubrir el importe, la comisión y un 8 % de margen. Lo que sobre se queda en tu wallet como SOL.
- **Changelog:** Tarea 2 como "pequeña" (va al resumen del lunes). Tareas 1 y 3 sin changelog.
- **Mini app, solo la wallet vinculada opera:** si la wallet conectada no es la de /link, no se muestra el panel de compra y venta.
- **Mini app, sesión sin cookies:** viaja en una cabecera, porque Telegram Web muestra la app en un marco donde las cookies suelen bloquearse.
- **Mini app, reclutadores:** la vinculación automática al conectar no se ejecuta dentro de la app, para no pedir una firma por sorpresa.
- **Nueva dependencia:** `tweetnacl`, la librería de cifrado que usa el protocolo de Phantom.
- **Raydium:** el SDK oficial se instaló en una carpeta temporal fuera del proyecto, solo para simular.
- **Vista previa local:** añadí una configuración temporal al archivo de vista previa de la otra carpeta de trabajo y la quité al terminar.

## 5. Estado de git

| Commit | Qué | Subido | Desplegado |
| --- | --- | --- | --- |
| `51b95ca` | Tarea 1: `docs/RAYDIUM.md` | Sí | Sí |
| `8d68975` | Tarea 2: arreglos pequeños | Sí | Sí |
| `44303c6` | Tarea 3: mini app de Telegram (flag apagado) | Sí | Sí |
| `3b4f54d` | Tarea 3: 404 real con el flag apagado | Sí | Sí |

Antes de cada subida: 1.308 pruebas en verde, typecheck, lint y build sin errores. Este resumen va en un commit aparte, solo de documentación.
