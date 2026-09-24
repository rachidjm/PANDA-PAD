/**
 * Where each domain reads and writes, during the Blob → Postgres migration (docs/PHASE6_PLAN.md §1.4). One switch per domain, set with
 * PANDA_STORAGE_MODES="rewards=dual,trades=dual,activity=blob,pause=blob" (anything not listed is "blob", i.e. exactly today's behaviour):
 *
 *   blob      Vercel Blob only.
 *   dual      Blob stays the source of truth (reads and decisions); every write is ALSO mirrored into Postgres, best-effort:
 *             a mirror failure is logged and alerted, never fails the user's action. `npm run db:compare` shows any difference.
 *   postgres  Postgres only. Blob is no longer touched (kept read-only for 30 days as the way back).
 *
 * Order per domain: run `db:backfill` with the domain paused → switch to "dual" → compare for two days → switch to "postgres".
 */
export const DOMAINS = ["rewards", "trades", "activity", "pause", "audit", "sessions", "launch"] as const;
export type Domain = (typeof DOMAINS)[number];
export const MODES = ["blob", "dual", "postgres"] as const;
export type StorageMode = (typeof MODES)[number];

export type ParsedModes = { modes: Record<Domain, StorageMode>; problems: string[] };

/** Never throws: an entry it can't understand is reported in `problems` and that domain stays on Blob. */
export function parseStorageModes(raw: string | undefined): ParsedModes {
  const modes = Object.fromEntries(DOMAINS.map((d) => [d, "blob"])) as Record<Domain, StorageMode>;
  const problems: string[] = [];
  for (const part of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [domain, mode, ...extra] = part.split("=").map((s) => s.trim());
    if (extra.length || !(DOMAINS as readonly string[]).includes(domain) || !(MODES as readonly string[]).includes(mode)) {
      problems.push(`"${part}" is not <domain>=<mode> (domains: ${DOMAINS.join(", ")}; modes: ${MODES.join(", ")})`);
      continue;
    }
    modes[domain as Domain] = mode as StorageMode;
  }
  return { modes, problems };
}

export function storageMode(domain: Domain, env: Record<string, string | undefined> = process.env): StorageMode {
  return parseStorageModes(env.PANDA_STORAGE_MODES).modes[domain];
}

/** True when any domain needs Postgres (dual or postgres). */
export function needsDatabase(env: Record<string, string | undefined> = process.env): boolean {
  return Object.values(parseStorageModes(env.PANDA_STORAGE_MODES).modes).some((m) => m !== "blob");
}

/** Best-effort mirror of a write into Postgres while a domain is in "dual" mode. Never throws. */
export async function mirror(domain: Domain, what: string, write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch (err) {
    console.error(`[PANDA db] dual-write mirror failed (${domain}: ${what}) — Postgres now differs from Blob until db:compare/db:backfill is run`, err instanceof Error ? err.message : err);
  }
}
