import { docRead, docUpdate } from "@/lib/storage/store";
import type { OtcLaunchRecord, OtcLaunchStatus } from "./types";

/**
 * One document per mint (`otc/launches/<mint>.json`) — the durable, server-side record of a PANDA
 * Rewards launch attempt. This is what "before starting a new launch, check if one already exists
 * for this mint" and "don't re-launch after TX2 already landed" (spec rules #13/#21) check against:
 * the client also keeps a lightweight pointer in localStorage (see useOtcLaunch.ts) so a reload can
 * find its way back here, but this record is the source of truth.
 */

const path = (mint: string) => `otc/launches/${mint}.json`;

export async function getOtcLaunch(mint: string): Promise<OtcLaunchRecord | null> {
  return docRead<OtcLaunchRecord | null>(path(mint), null);
}

/** Creates the record for a brand-new mint. Refuses (returns null) if one already exists — a real
 * mint is only ever the start of one launch attempt. */
export async function createOtcLaunch(
  input: Pick<OtcLaunchRecord, "mint" | "creator" | "name" | "symbol" | "uri" | "quoteMint" | "mode" | "buy">,
  status: OtcLaunchStatus,
  now: number
): Promise<OtcLaunchRecord | null> {
  return docUpdate<OtcLaunchRecord | null, OtcLaunchRecord | null>(path(input.mint), null, (existing) => {
    if (existing) return { next: existing, result: null };
    const record: OtcLaunchRecord = { ...input, status, registered: false, createdAt: now, updatedAt: now };
    return { next: record, result: record };
  });
}

/** Applies `patch` only if the record is currently in one of the `from` statuses — the same guard
 * strategy/store.ts uses, so two racing requests for the same mint can't both advance it. */
export async function transitionOtcLaunch(
  mint: string,
  from: readonly OtcLaunchStatus[],
  patch: Partial<Omit<OtcLaunchRecord, "mint" | "creator" | "createdAt">>,
  now: number
): Promise<OtcLaunchRecord | null> {
  return docUpdate<OtcLaunchRecord | null, OtcLaunchRecord | null>(path(mint), null, (existing) => {
    if (!existing || !from.includes(existing.status)) return { next: existing, result: null };
    const updated: OtcLaunchRecord = { ...existing, ...patch, updatedAt: now };
    return { next: updated, result: updated };
  });
}

/** Records-only field updates (e.g. `registered`) that don't move `status` and are safe from any state. */
export async function patchOtcLaunch(
  mint: string,
  patch: Partial<Omit<OtcLaunchRecord, "mint" | "creator" | "createdAt" | "status">>,
  now: number
): Promise<OtcLaunchRecord | null> {
  return docUpdate<OtcLaunchRecord | null, OtcLaunchRecord | null>(path(mint), null, (existing) => {
    if (!existing) return { next: existing, result: null };
    const updated: OtcLaunchRecord = { ...existing, ...patch, updatedAt: now };
    return { next: updated, result: updated };
  });
}
