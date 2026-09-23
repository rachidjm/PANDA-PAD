import { eq, sql } from "drizzle-orm";
import type { Db } from "./client";
import { protocolPause } from "./schema";
import { applyPause, EMPTY_PAUSE_STATE, isSubsystem, type PauseEntry, type PauseState, type Subsystem } from "@/lib/protocol/pause";

/** The pause switches in Postgres: one row per subsystem, changed under a lock so two admins can't interleave. */

export async function pgGetPauseState(db: Db): Promise<PauseState> {
  const rows = await db.select().from(protocolPause);
  const state: PauseState = { version: 1, subsystems: {} };
  for (const r of rows) if (isSubsystem(r.subsystem)) state.subsystems[r.subsystem] = { paused: r.paused, reason: r.reason, since: r.since, by: r.byWallet };
  return rows.length ? state : EMPTY_PAUSE_STATE;
}

export async function pgSetPause(
  db: Db,
  subsystem: Subsystem,
  paused: boolean,
  reason: string,
  by: string,
  now: number
): Promise<{ before: PauseEntry | null; after: PauseEntry | null; changed: boolean }> {
  return db.transaction(async (tx) => {
    // Serialize changes to one subsystem even when its row doesn't exist yet (a row lock can't lock a row that isn't there).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"protocol_pause:" + subsystem}))`);
    const [row] = await tx.select().from(protocolPause).where(eq(protocolPause.subsystem, subsystem));
    const current: PauseState = { version: 1, subsystems: row ? { [subsystem]: { paused: row.paused, reason: row.reason, since: row.since, by: row.byWallet } } : {} };
    const r = applyPause(current, subsystem, paused, reason, by, now);
    const after = r.next.subsystems[subsystem] ?? null;
    if (r.changed && after) {
      await tx
        .insert(protocolPause)
        .values({ subsystem, paused: after.paused, reason: after.reason, since: after.since, byWallet: after.by })
        .onConflictDoUpdate({ target: protocolPause.subsystem, set: { paused: after.paused, reason: after.reason, since: after.since, byWallet: after.by } });
    }
    return { before: r.before, after, changed: r.changed };
  });
}
