/**
 * A Vercel PREVIEW deployment must never touch production's database, Redis or file store.
 *
 * The first line of defence is in Vercel itself: those variables exist for Production only (docs/PREVIEWS.md). This is
 * the second, in the code, for the day somebody shares one with Preview again by mistake: a preview uses a service only
 * when it can PROVE it isn't production's. Production's services are known by a fingerprint — a short hash of the
 * database host, the Redis host and the Blob store id; no password, no token — kept in PANDA_PRODUCTION_FINGERPRINTS.
 * In a preview:
 *   - a service whose fingerprint equals production's is treated as not configured;
 *   - so is any service while the fingerprints are unknown (it can't be told apart from production);
 *   - only a service that is demonstrably another one — a Neon branch, a second Redis, another Blob store — is used.
 * Production and local development are never affected: this only ever answers "no" when VERCEL_ENV is "preview".
 */

export type Service = "database" | "redis" | "blob";
type Env = Record<string, string | undefined>;

/** What identifies a service without being a secret: the host it lives on, or the Blob store's id. Null if it can't be read. */
export function serviceId(service: Service, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (service === "blob") {
    // vercel_blob_rw_<store id>_<secret>
    const m = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(v);
    return m ? m[1].toLowerCase() : null;
  }
  try {
    const host = new URL(v).hostname.toLowerCase();
    if (!host) return null;
    // Neon's pooled and direct addresses are the same database: "ep-x-pooler.region…" and "ep-x.region…".
    return service === "database" ? host.replace(/-pooler(?=\.)/, "") : host;
  } catch {
    return null;
  }
}

/** FNV-1a, 64 bits, as 16 hex digits. Not cryptography: it only has to tell two services apart without writing their names down. */
export function fingerprint(id: string): string {
  let h = BigInt("0xcbf29ce484222325");
  const prime = BigInt("0x100000001b3");
  const mask = BigInt("0xffffffffffffffff");
  for (const byte of new TextEncoder().encode(id)) h = ((h ^ BigInt(byte)) * prime) & mask;
  return h.toString(16).padStart(16, "0");
}

export function serviceFingerprint(service: Service, value: string | null | undefined): string | null {
  const id = value ? serviceId(service, value) : null;
  return id ? fingerprint(id) : null;
}

/** PANDA_PRODUCTION_FINGERPRINTS="database:<hash>,redis:<hash>,blob:<hash>" */
export function productionFingerprints(env: Env = process.env): Partial<Record<Service, string>> {
  const out: Partial<Record<Service, string>> = {};
  for (const part of (env.PANDA_PRODUCTION_FINGERPRINTS ?? "").split(",")) {
    const [name, hash] = part.split(":").map((s) => s.trim().toLowerCase());
    if ((name === "database" || name === "redis" || name === "blob") && /^[0-9a-f]{16}$/.test(hash ?? "")) out[name] = hash;
  }
  return out;
}

/** The line a production build prints, so the fingerprints can be copied into the variable without anybody seeing a secret. */
export function fingerprintsLine(values: Partial<Record<Service, string | null | undefined>>): string {
  return (["database", "redis", "blob"] as const)
    .map((s) => [s, serviceFingerprint(s, values[s])] as const)
    .filter(([, f]) => f)
    .map(([s, f]) => `${s}:${f}`)
    .join(",");
}

export const isPreview = (env: Env = process.env): boolean => env.VERCEL_ENV === "preview";

/** May THIS deployment use the service behind `value`? Always yes outside a preview; in a preview only when it is provably not production's. */
export function previewMayUse(service: Service, value: string | null | undefined, env: Env = process.env): boolean {
  if (!isPreview(env)) return true;
  if (!value?.trim()) return true; // nothing to use: the caller already treats it as not configured
  const production = productionFingerprints(env)[service];
  const mine = serviceFingerprint(service, value);
  return !!production && !!mine && mine !== production;
}

/** The Blob token under any of the names Vercel gives it — or null in a preview that would be writing to production's store. */
export function blobToken(env: Env = process.env): string | null {
  const token = (env.BLOB_READ_WRITE_TOKEN || env.BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN || env.PANDA_PAD_BLOB_READ_WRITE_TOKEN)?.trim() || null;
  return token && previewMayUse("blob", token, env) ? token : null;
}
