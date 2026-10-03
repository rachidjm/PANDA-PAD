# Colección de NFT de PANDA (Fundadores + el resto)

Este documento es para cuando tú (Rachid) prepares el arte y los metadatos de la colección de 5.000 NFT. El script
(`npm run nft:create-collection`) crea la colección Metaplex Core y mintea las plazas de Fundador ya reservadas en
Postgres (`founder_allocations`, puesto 1 a 1.000). Los otros 4.000 NFT de la colección quedan fuera de este
encargo — el formato de carpeta es el mismo, así que puedes añadirlos más adelante sin cambiar el script.

**No se ha creado nada todavía.** El script solo actúa de verdad con `--live`; sin ese flag, simula y te dice
exactamente qué haría, sin tocar la cadena ni gastar SOL.

## Qué necesito que prepares

```
<tu-carpeta>/
  collection.png          ← imagen de portada de la colección entera (1 archivo)
  collection.json          ← metadatos de la colección entera (1 archivo)
  images/
    1.png                  ← NFT de Fundador #1
    2.png                  ← NFT de Fundador #2
    ...
    1000.png                ← NFT de Fundador #1000
    (1001.png … 5000.png — los 4.000 restantes, para más adelante, fuera de este encargo)
  metadata/
    1.json
    2.json
    ...
    1000.json
    (1001.json … 5000.json — igual, para más adelante)
```

- **Imágenes**: PNG o JPG. Recomendado 1000×1000 px, cuadradas — no es un requisito técnico de Metaplex, pero es
  el estándar que usan los marketplaces y evita que tu NFT se vea recortado o pixelado en unos sitios sí y en
  otros no.
- **Nombres de archivo**: el número tiene que coincidir exactamente con el puesto (`rank`) del Fundador — el
  NFT del Fundador #47 se mintea con `images/47.png` y `metadata/47.json`. El script falla (sin mintear nada) si
  falta el archivo de un puesto ya reservado, en vez de saltárselo en silencio.
- **`metadata/<n>.json`** — mismo formato que usan OpenSea/la mayoría de wallets y marketplaces de Solana:
  ```json
  {
    "name": "PANDA Founder #47",
    "description": "...",
    "image": "<se rellena solo — no hace falta que pongas una URL aquí>",
    "attributes": [
      { "trait_type": "Rank", "value": "47" },
      { "trait_type": "...", "value": "..." }
    ]
  }
  ```
  El script sube `images/<n>.png` y sustituye `image` por la URL real antes de subir el JSON final — el valor
  que pongas en `image` en tu archivo de entrada no se usa, solo `name`, `description` y `attributes`.
- **`collection.json`** — mismo formato, sin `attributes` obligatorios; es la portada que ven los marketplaces al
  mostrar "PANDA Founders" como colección.

## Qué hace el script

1. Valida la carpeta (archivos presentes, tamaños razonables, JSON bien formado) y te da un resumen — número de
   Fundadores pendientes de mintear en Postgres, coste total estimado, nada más. **Esto es lo que hace por
   defecto, sin `--live`.**
2. Con `--live`: sube `collection.png`/`collection.json` (mismo almacén que ya usa `/api/upload-metadata`), crea
   la colección Core (una sola transacción, pagada por `PANDA_NFT_MINTER_SECRET_KEY`), y guarda su dirección.
3. Para cada fila de `founder_allocations` con `minted_at` vacío (reservada pero sin NFT todavía): sube su imagen
   y metadatos, mintea un asset Core dentro de la colección, a nombre de la wallet del Fundador (PANDA paga, el
   Fundador no firma nada ni necesita hacer nada), lo verifica leyéndolo de vuelta de la cadena exactamente como
   ya hace `src/lib/nft/mint.ts` para los NFT de Theme/Branch, y solo entonces marca `minted_at`/`asset_id` en
   Postgres. Si algo falla a mitad, esa fila se queda "reservada, sin mintear" para el siguiente pase — nunca se
   marca como minteada sin confirmación real on-chain.
4. Vuelve a ejecutarse sin problema: las plazas ya minteadas se saltan, así que si llegan 200 Fundadores nuevos
   mañana, simplemente lo corres otra vez.

## Soulbound (intransferible)

Cada NFT se mintea con el plugin `PermanentFreezeDelegate` de Metaplex Core (`frozen: true`), añadido en el mismo
momento del mint y nunca después — es un plugin "permanente": una vez puesto, nadie (ni tú, ni el propio
Fundador) puede quitarlo ni transferir el NFT. Confirmado contra el propio paquete `@metaplex-foundation/mpl-core`
ya instalado en este proyecto (no es una suposición). Se combina con los mismos plugins que ya usan los NFT de
Theme/Branch (`ImmutableMetadata`, `AddBlocker`, `Royalties` con autoridad "None", `Attributes`) para que tampoco
se puedan cambiar los metadatos ni añadir plugins nuevos más adelante.

## Coste estimado

Según la documentación pública de Metaplex (developers.metaplex.com/protocol-fees, consultada 2026-10-03):

- **~0,003 SOL por asset base** (0,0015 SOL de comisión del protocolo de Metaplex + ~0,0015 SOL de renta de la
  cuenta) — frente a ~0,022 SOL de un NFT "clásico" (Token Metadata), ~80% más barato.
- Nuestros NFT llevan 5 plugins (`ImmutableMetadata`, `AddBlocker`, `Royalties`, `Attributes`,
  `PermanentFreezeDelegate`), cada uno añade algo de renta extra por los bytes que ocupa — Metaplex no publica
  una cifra exacta por plugin. El script, en modo simulación, calcula y muestra el coste REAL midiéndolo en
  devnet antes de dar una cifra definitiva para los 1.000 Fundadores — no voy a inventar un número exacto sin
  medirlo primero.
- La colección en sí (1 cuenta) tiene un coste parecido, de nuevo sin cifra exacta publicada — se mide igual.
- Con el ~0,003 SOL/NFT documentado como referencia: 1.000 Fundadores ≈ 3 SOL, orden de magnitud a confirmar con
  la medición real en devnet antes de mintear en mainnet.

## Variables de entorno

- `PANDA_NFT_MINTER_SECRET_KEY` (Sensitive, servidor) — la wallet que paga el minteo. Necesita SOL suficiente
  para la colección + los Fundadores pendientes (el script te dice cuánto hace falta antes de pedir confirmación).
- `FEATURE_FOUNDER_NFT=true` — ya tiene que estar activo para que haya plazas reservadas que mintear.

## Verificación antes de confirmarte una cifra exacta

Antes de dar un número final de coste (y antes de ejecutar nada en mainnet), lo correcto es: `npm run
nft:create-collection -- --live --network devnet` contra devnet, con una carpeta de prueba pequeña (2-3
imágenes), y leer el coste real gastado de la wallet antes/después — eso reemplaza la estimación de arriba por
una cifra medida, no una suposición de la documentación.
