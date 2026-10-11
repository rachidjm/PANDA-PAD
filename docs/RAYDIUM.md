# PANDA en Raydium LaunchLab — investigación

Fecha: 11 de octubre de 2026. Solo lectura: no se ha escrito código de producto, no se ha firmado ni enviado ninguna transacción.

## Veredicto: SÍ, CON LIMITACIONES

PANDA puede lanzar monedas en Raydium LaunchLab con su propia comisión de plataforma, igual que bonk.fun. Registrar la plataforma es libre (no hace falta permiso de Raydium) y la simulación en mainnet pasa. La limitación importante es el **reparto creador / holders / socios**: en Pump.fun ese reparto vive en la cadena; en LaunchLab no existe nada equivalente y tendría que hacerlo PANDA con su propio sistema.

## 1. Cómo funciona LaunchLab hoy

Datos leídos de la documentación oficial y de la API pública de Raydium (valores en vivo el 11-10-2026).

| Tema | Valor |
| --- | --- |
| Programa (mainnet) | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` |
| Curva por defecto | Producto constante (también hay precio fijo y lineal) |
| Suministro por defecto | 1.000 millones, 6 decimales |
| Se vende en la curva | 79,31 % del suministro |
| Para graduarse | 85 SOL recaudados (mínimo permitido por Raydium: 24 SOL) |
| Comisión de Raydium en la curva | 0,25 % por operación |
| Comisión de migración | 0 |
| Dónde migra | Siempre a un pool CPMM de Raydium (el AMM v4 antiguo ya no se admite) |
| Quién migra | Un robot de Raydium, automático |
| Liquidez al migrar | Se reparte entre "quemar" y un NFT (Fee Key) para la plataforma, según lo que configure la plataforma |
| Tras migrar | Comisión del pool CPMM elegido (0,25 % el más usado) + 0,05 % de comisión de creador |
| Token-2022 | Admitido (opcional) |

Tres comisiones en cada compra y venta de la curva, todas en SOL:

1. **Protocolo (Raydium):** 0,25 %.
2. **Plataforma (quien lanza, p. ej. PANDA):** la fija la plataforma. Tope actual: **5 %**.
3. **Creador:** la fija la plataforma. Tope: **0,5 %**.

Además existe una **comisión de referido** opcional ("share fee"), de hasta **1 %**, que se manda a la dirección que indique quien construye la operación.

## 2. ¿Puede PANDA ser plataforma, como bonk.fun?

Sí. Hoy hay 21 plataformas registradas. Ejemplos reales:

| Plataforma | Comisión plataforma | Comisión creador | Liquidez al migrar |
| --- | --- | --- | --- |
| Raydium | 0,75 % | 0,05 % | 90 % quemada |
| letsbonk.fun | 1 % – 1,25 % | 0 % | casi toda quemada |
| Bankr | 1 % | 0,5 % | 40 % plataforma, 10 % quemada |

Qué hace falta:

- **Una transacción** (`createPlatformConfig`) firmada por la wallet que será la administradora. Cada wallet solo puede tener una plataforma. Cuesta solo la renta de la cuenta (céntimos).
- Elegir: comisión de plataforma, comisión de creador, reparto de la liquidez al migrar, wallet que cobra y pool CPMM de destino.
- No hay aprobación ni contrato con Raydium. La comisión se puede cambiar después (`updatePlatformConfig`).
- Opcional: limitar qué curvas pueden usar los lanzamientos de PANDA (reglas de curva, desde agosto de 2026).

## 3. ¿Se mantiene nuestro modelo?

| Pieza de PANDA | ¿Se puede? | Cómo |
| --- | --- | --- |
| Comisión de PANDA a la Vault de Squads | **Sí** | La comisión de plataforma se acumula en una cuenta del programa y la retira la wallet configurada. Si es la Vault, cada retirada necesita las firmas del multisig; alternativa: una wallet de cobro que reenvía a la Vault. Ventaja: se cobra en **todas** las operaciones de la moneda, también las hechas fuera de PANDA. |
| Reparto creador / holders / socios | **Con limitaciones** | LaunchLab solo conoce a UN creador y le da como máximo 0,5 %. No hay lista de socios en la cadena. Opciones: (a) PANDA cobra la comisión de plataforma y reparte con su sistema de recompensas, como ya hace con holders; (b) el "creador" de la moneda es una wallet de reparto de PANDA. En los dos casos el reparto lo ejecuta PANDA, no un contrato. |
| Primera compra obligatoria | **Sí** | Crear y comprar van en la misma transacción (simulado). |
| Una sola firma | **Sí** | Una transacción, firmada por el usuario y por la clave de la moneda, como hoy. |
| Dirección "…panda" | **Sí** | La dirección de la moneda es una clave que aportamos nosotros; vale el mismo stock de direcciones. |
| 30 % del reclutador | **Sí** | Se calcula sobre lo que cobra PANDA, como hoy. Opcional: usar la comisión de referido de LaunchLab (hasta 1 %) para pagar al reclutador en el momento. |
| Mitad de comisión a referidos | **Con limitaciones** | La comisión de plataforma es igual para todos. Para mantener los dos niveles habría que poner una comisión de plataforma baja y cobrar el resto como hoy, con una transferencia en la operación. |

## 4. Qué se reutiliza

| Parte | Reutilizable | Trabajo nuevo |
| --- | --- | --- |
| Formulario de crear, imágenes, metadatos, direcciones "…panda" | Casi todo | Selector "Pump.fun / Raydium" y el constructor de la transacción |
| Trading en la curva | Interfaz, comisiones, avisos, RugCheck | Constructor de compra y venta de LaunchLab |
| Trading tras migrar | Jupiter ya enruta pools de Raydium | Detectar el estado de la moneda |
| Órdenes PANDA (ventas y stops prefirmados) | Vigilante, nonces, cifrado, interfaz | La transacción prefirmada de venta para LaunchLab y para CPMM; hay que rehacerla si la moneda migra con la orden abierta |
| Reparto a holders | Lectura de holders, exclusiones, abono y cobro | El origen del dinero (comisión de plataforma en vez del reparto de Pump) y excluir las cuentas del pool de Raydium |
| Gráficos y datos | GeckoTerminal y DexScreener cubren LaunchLab | Poco |
| Bot de Telegram | Todo | Etiqueta de origen |

## 5. Simulación

Hecha contra mainnet con `simulateTransaction` (sin firmar, sin enviar), usando el SDK oficial `@raydium-io/raydium-sdk-v2` en una carpeta temporal fuera del proyecto.

| Prueba | Resultado | Tamaño | Cómputo |
| --- | --- | --- | --- |
| Registrar una plataforma (1 % plataforma, 0,5 % creador, liquidez quemada) | Pasa | 380 bytes | 31.985 |
| Crear moneda con dirección propia | Pasa | 696 bytes | 107.004 |
| Crear + primera compra de 0,1 SOL + referido 1 % | Pasa | 1.088 bytes | 214.435 |
| Lo mismo + transferencia de comisión a PANDA, en UNA transacción | Pasa | 1.137 bytes | 214.585 |

El límite de Solana es 1.232 bytes: cabe con 95 de margen sin tabla de direcciones; con la tabla de PANDA sobra más.

No simulado: venta en la curva, migración (la hace Raydium) y retirada de comisiones (necesita una plataforma real).

## 6. Riesgos

- **Reparto no garantizado por contrato.** El argumento "el reparto está en la cadena" deja de ser cierto en estas monedas. Hay que decirlo claro en la web.
- **Raydium cambia el programa a menudo.** Solo entre agosto y septiembre de 2026: tope de comisión, liquidez al migrar, reglas de curva, argumentos de migración. Habrá mantenimiento.
- **Dependemos del robot de migración de Raydium.**
- **Peso del SDK.** Ocupa unos 190 MB instalado; conviene construir las instrucciones a mano o aislarlo en una ruta de servidor.
- **Dos mercados.** Duplica pruebas, soporte y textos; divide la atención de los usuarios.
- **Revisión legal.** Cobrar y repartir comisiones desde wallets de PANDA es más "custodia" que el modelo actual.
- **Competencia.** bonk.fun domina LaunchLab; las monedas de PANDA allí no tendrían su visibilidad.

## 7. Plan por pasos

| Paso | Qué | Tiempo |
| --- | --- | --- |
| 1 | Decidir comisiones y cómo se reparte (opción a o b) y revisarlo con el abogado | 2–3 días |
| 2 | Registrar la plataforma PANDA en devnet y mainnet; guion de simulación en el repo | 1 día |
| 3 | Crear moneda en LaunchLab con primera compra, una firma y dirección "…panda", detrás de un flag | 4–5 días |
| 4 | Comprar y vender en la curva y tras migrar; página de moneda | 4–5 días |
| 5 | Cobro de la comisión de plataforma y reparto a creador / holders / socios / reclutador | 5–7 días |
| 6 | Órdenes PANDA en estas monedas | 4–6 días |
| 7 | Pruebas en mainnet con dinero real pequeño, textos legales, ES/EN | 3–4 días |

**Total: 4–5 semanas** para la versión completa. Una primera versión sin órdenes PANDA y sin reparto a socios (solo PANDA + creador): unas 2 semanas.

## Fuentes

- https://docs.raydium.io/products/launchlab/overview
- https://docs.raydium.io/products/launchlab/platforms
- https://docs.raydium.io/products/launchlab/platform-config
- https://docs.raydium.io/products/launchlab/global-config
- https://docs.raydium.io/products/launchlab/creator-fees
- https://docs.raydium.io/products/launchlab/instructions
- https://docs.raydium.io/reference/program-addresses
- API pública: `https://launch-mint-v1.raydium.io/main/configs` y `/main/platforms`
- SDK: https://github.com/raydium-io/raydium-sdk-V2
