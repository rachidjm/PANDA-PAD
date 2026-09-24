import { Connection, PublicKey } from "@solana/web3.js";
import { docRead, docUpdate } from "@/lib/storage/store";
import { PANDA_TREASURY } from "./constants";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { getFeeSharingConfig } from "./fee-sharing";
import { registerMint } from "@/lib/rewards/registry";
import { recordAudit } from "@/lib/audit/log";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgLoadPending, pgRegisterPending, pgRemovePending, pgStampAudited } from "@/lib/db/launch";

/**
 * The fee-lock registry: PANDA-launched coins whose fee split (PANDA's locked 5% included) is NOT yet on-chain.
 *
 * It only matters on the two-transaction launch path (create, then set the split) — the single-transaction path with PANDA's
 * lookup table is atomic and never registers anything here. While a coin is registered:
 *   - it appears in no PANDA list (home, Discover, search, launches, Activity) — see `withoutPendingFeeLock`;
 *   - its creator sees a persistent "Set the fee split" notice on the coin page;
 *   - the audit log records that it was created without its split.
 * A coin leaves the registry only when its on-chain `SharingConfig` really contains PANDA's share (`resolvePending` re-reads
 * the chain; it never trusts the client). The coin page itself stays reachable by direct link.
 *
 * A mint is registered only if it does NOT exist on-chain yet: the build endpoint is unauthenticated, so anyone could
 * otherwise "register" someone else's popular coin to hide it.
 */

export type PendingFeeLock = {
  creator: string;
  ts: number;
  shareholders: { address: string; shareBps: number }[] | null;
  /** When the "created without its split" audit event was written (once). */
  auditedAt?: number;
};
type Doc = { pending: Record<string, PendingFeeLock> };

const PATH = "launch/pending-fee-lock.json";
const EMPTY: Doc = { pending: {} };
/** A registration whose coin never appeared on-chain (the creator abandoned the launch) is dropped after this. */
export const UNCREATED_TTL_MS = 24 * 60 * 60_000;
const PRUNE_ABOVE = 200;
const HARD_CAP = 2000;
const CACHE_MS = 15_000;

let cache: { at: number; doc: Doc } | null = null;

async function load(): Promise<Doc> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.doc;
  // Where it lives follows PANDA_STORAGE_MODES (launch): Blob document, Blob + Postgres mirror, or Postgres only.
  const doc: Doc = storageMode("launch") === "postgres" ? { pending: await pgLoadPending(getDb()) } : await docRead<Doc>(PATH, EMPTY);
  cache = { at: Date.now(), doc };
  return doc;
}
const invalidate = () => {
  cache = null;
};

export async function getPendingFeeLocks(): Promise<Record<string, PendingFeeLock>> {
  return (await load()).pending;
}

/** Drops the coins that are waiting for their split from a list. Never throws: if the registry can't be read, the list is returned as is. */
export async function withoutPendingFeeLock<T extends { mint: string }>(items: T[]): Promise<T[]> {
  try {
    const pending = await getPendingFeeLocks();
    if (Object.keys(pending).length === 0) return items;
    return items.filter((i) => !(i.mint in pending));
  } catch (err) {
    console.error("[PANDA fee-lock] could not read the registry; lists are not filtered this round", err);
    return items;
  }
}

export type RegisterResult = { ok: true } | { ok: false; reason: "exists" | "full" };

/** Called when a two-transaction launch is built. Refuses a mint that already exists on-chain (see the header). */
export async function registerPendingFeeLock(
  connection: Connection,
  input: { mint: string; creator: string; shareholders: { address: string; shareBps: number }[] | null }
): Promise<RegisterResult> {
  if (await connection.getAccountInfo(new PublicKey(input.mint), "confirmed")) return { ok: false, reason: "exists" };
  if (Object.keys((await load()).pending).length > PRUNE_ABOVE) await pruneUncreated(connection);
  const entry = { creator: input.creator, ts: Date.now(), shareholders: input.shareholders };
  const mode = storageMode("launch");
  let result: RegisterResult;
  if (mode === "postgres") {
    result = (await pgRegisterPending(getDb(), input.mint, entry, HARD_CAP)) ? { ok: true } : { ok: false, reason: "full" };
  } else {
    result = await docUpdate<Doc, RegisterResult>(PATH, EMPTY, (doc) => {
      if (!(input.mint in doc.pending) && Object.keys(doc.pending).length >= HARD_CAP) return { next: doc, result: { ok: false, reason: "full" } };
      doc.pending[input.mint] = entry;
      return { next: doc, result: { ok: true } };
    });
    if (result.ok && mode === "dual") await mirror("launch", `register ${input.mint}`, () => pgRegisterPending(getDb(), input.mint, entry, HARD_CAP));
  }
  invalidate();
  return result;
}

async function removeMints(mints: string[]): Promise<void> {
  if (mints.length === 0) return;
  const mode = storageMode("launch");
  if (mode !== "postgres") {
    await docUpdate<Doc, void>(PATH, EMPTY, (doc) => {
      for (const m of mints) delete doc.pending[m];
      return { next: doc, result: undefined };
    });
  }
  if (mode === "postgres") await pgRemovePending(getDb(), mints);
  else if (mode === "dual") await mirror("launch", "remove", () => pgRemovePending(getDb(), mints));
  invalidate();
}

/** Registrations whose coin never got created, older than the TTL. */
async function pruneUncreated(connection: Connection): Promise<void> {
  const entries = Object.entries((await load()).pending).filter(([, v]) => Date.now() - v.ts > UNCREATED_TTL_MS);
  const drop: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(batch.map(([m]) => new PublicKey(m)), "confirmed");
    batch.forEach(([m], j) => {
      if (!infos[j]) drop.push(m);
    });
  }
  await removeMints(drop);
}

/** True when the shareholders include PANDA's treasury with at least its locked share. */
export function hasPandaShare(shareholders: { address: string; shareBps: number }[] | null | undefined, treasury = PANDA_TREASURY.toBase58()): boolean {
  return !!shareholders?.some((s) => s.address === treasury && s.shareBps >= PANDA_SHARE_BPS);
}

export type FeeLockState =
  | { state: "none" } // not a registered launch (or already resolved)
  | { state: "waiting"; creator: string; shareholders: PendingFeeLock["shareholders"]; created: boolean }
  | { state: "locked" };

/**
 * Looks at the chain for one registered mint and updates the registry:
 *  - the coin exists but has no SharingConfig with PANDA's share → stays registered; the audit event is written once;
 *  - the SharingConfig has PANDA's share → the coin leaves the registry, is registered with the rewards distributor and audited.
 * Re-reads the chain every time; the client's word is never used.
 */
export async function resolvePending(
  connection: Connection,
  mint: string,
  deps: { readSharing: typeof getFeeSharingConfig; register: (mint: string) => Promise<void> } = { readSharing: getFeeSharingConfig, register: registerMint }
): Promise<FeeLockState> {
  const entry = (await getPendingFeeLocks())[mint];
  if (!entry) return { state: "none" };
  const mintKey = new PublicKey(mint);
  const created = !!(await connection.getAccountInfo(mintKey, "confirmed"));
  if (!created) return { state: "waiting", creator: entry.creator, shareholders: entry.shareholders, created: false };

  const onChain = await deps.readSharing(connection, mintKey);
  if (hasPandaShare(onChain)) {
    await removeMints([mint]);
    await deps.register(mint).catch((err) => console.error("[PANDA fee-lock] registerMint failed", err));
    await recordAudit({ actor: "system:fee-lock", action: "token.fee_split_locked", object: mint, oldState: { creator: entry.creator, waitedMs: Date.now() - entry.ts }, newState: { shareholders: onChain } });
    return { state: "locked" };
  }

  if (!entry.auditedAt) {
    const stamp = Date.now();
    let first: boolean;
    if (storageMode("launch") === "postgres") first = await pgStampAudited(getDb(), mint, stamp);
    else {
      first = await docUpdate<Doc, boolean>(PATH, EMPTY, (doc) => {
        const e = doc.pending[mint];
        if (!e || e.auditedAt) return { next: doc, result: false };
        e.auditedAt = stamp;
        return { next: doc, result: true };
      });
      if (first && storageMode("launch") === "dual") await mirror("launch", `audited ${mint}`, () => pgStampAudited(getDb(), mint, stamp));
    }
    invalidate();
    if (first) {
      await recordAudit({
        actor: "system:fee-lock",
        action: "token.created_without_fee_split",
        object: mint,
        newState: { creator: entry.creator, hasSharingConfig: !!onChain, intendedShareholders: entry.shareholders },
        reason: "Coin created without PANDA's fee split; hidden from PANDA lists until the creator sets it",
      });
    }
  }
  return { state: "waiting", creator: entry.creator, shareholders: entry.shareholders, created: true };
}

/** Resolves every registered mint (the daily cron, and a cheap way to keep the registry honest). Returns how many are still waiting. */
export async function resolveAllPending(connection: Connection): Promise<{ waiting: number; locked: number }> {
  await pruneUncreated(connection).catch(() => {});
  let waiting = 0;
  let locked = 0;
  for (const mint of Object.keys((await getPendingFeeLocks()))) {
    try {
      const r = await resolvePending(connection, mint);
      if (r.state === "waiting") waiting++;
      if (r.state === "locked") locked++;
    } catch (err) {
      console.error("[PANDA fee-lock] could not resolve", mint, err);
      waiting++;
    }
  }
  return { waiting, locked };
}
