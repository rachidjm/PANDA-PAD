# Previews de Vercel: separados de producción

Un *preview* es la copia de la web que Vercel monta para cada rama que no es `main`. Sirve para mirar un cambio antes de
publicarlo. **Nunca debe leer ni escribir datos reales.** Esto es lo que lo garantiza.

## 1. En Vercel: las variables de datos son solo de Production

Las variables de la base de datos (`DATABASE_*`), de Redis (`KV_*`) y de archivos (`BLOB_*`) existen **solo para
Production**. Un preview no las recibe: no tiene base de datos, ni Redis, ni almacén de archivos, salvo que se le den
unos propios (punto 4).

Tampoco recibe ninguna clave de wallet (Rewards Pool, quema, órdenes), ni el token del bot de Telegram, ni las claves de
X, ni `CRON_SECRET`, ni ningún `FEATURE_*`: todas son solo de Production.

Para comprobarlo (solo nombres, nunca valores):

```bash
npx vercel env ls preview
```

Debe salir, como mucho, `PANDA_PRODUCTION_FINGERPRINTS` y las variables propias de preview del punto 4.

## 2. En el código: un preview solo usa un servicio si puede demostrar que NO es el de producción

`src/lib/config/preview-guard.ts`. Por si alguien vuelve a compartir una variable con Preview por error:

- Producción se reconoce por una **huella**: un código corto sacado del nombre del servidor de la base de datos, del de
  Redis y del identificador del almacén de archivos. No contiene contraseñas ni tokens. Está en
  `PANDA_PRODUCTION_FINGERPRINTS` (Preview).
- En un preview, un servicio con la misma huella que producción se trata como **no configurado**.
- Si la huella no se conoce, tampoco se usa nada: no se puede distinguir de producción.
- Solo se usa un servicio que sea claramente otro (una rama de Neon, otro Redis, otro almacén).

Cada build de producción escribe sus huellas en el log (`=== production service fingerprints ===`). Si algún día se
cambia de base de datos, de Redis o de almacén, hay que copiar la línea nueva a `PANDA_PRODUCTION_FINGERPRINTS`.

## 3. Lo que un preview no hace nunca

- **Migraciones:** `scripts/vercel-build.ts` solo migra en producción. En un preview migra únicamente una base de datos
  propia (demostrada con la huella); si no, se salta el paso. `scripts/db-migrate.ts` se niega por su cuenta.
- **Tareas de build** (`PANDA_BUILD_TASKS`): no se ejecutan en un preview.
- **Crons y bot:** Vercel solo programa crons en producción. Además, `/api/cron/*` y el webhook del bot responden 404 en
  un preview antes de hacer nada.
- **Funciones que mueven dinero o hablan en nombre de PANDA:** repartos a holders, quemas, órdenes PANDA, bot de
  Telegram, changelog, mini app y X están apagadas en un preview aunque su variable diga `true`
  (`NEVER_IN_PREVIEW` en `src/lib/config/flags.ts`).

## 4. Opcional: dar a los previews servicios propios

Sin esto un preview funciona, pero lo que necesita base de datos responde "no disponible".

- **Base de datos:** en Neon, crear una rama (por ejemplo `preview`) a partir de `main`. Copiar sus dos direcciones de
  conexión (con *pooling* y sin él) y ponerlas en Vercel **solo para Preview** como `DATABASE_URL` y
  `DATABASE_URL_UNPOOLED`. Cada build de preview aplicará las migraciones en esa rama.
- **Redis:** otra base de Upstash; sus dos valores como `KV_REST_API_URL` y `KV_REST_API_TOKEN`, solo para Preview.
- **Archivos:** otro almacén de Blob; su token como `BLOB_READ_WRITE_TOKEN`, solo para Preview.

Nunca marcar "Preview" en las variables de producción. Si se hace por error, el código las ignora (punto 2).
