import { randomBytes } from "node:crypto";
import { docListPaths, docPutOnce, docRead, docUpdate } from "@/lib/storage/store";
import { applyStatusChange, Change, closeAppeal, emptyStatusDoc, openAppeal, StatusDoc, countsInTotals, canEarnPoints } from "./policy";
import type { AbuseStatus, Finding, WalletProfile } from "./types";

/**
 * Storage for the anti-abuse system (server only): one status document per
 * wallet (current status, recent history, appeals), one immutable report per
 * analysis run, and a cache of wallet profiles.
 */

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const statusPath = (w: string) => `abuse/status/${w}.json`;
const reportPath = (epoch: number, runId: string) => `abuse/reports/${epoch}/${runId}.json`;
const profilePath = (w: string) => `abuse/profiles/${w}.json`;

export async function getStanding(wallet: string): Promise<StatusDoc> {
  if (!ADDRESS.test(wallet)) return emptyStatusDoc(wallet);
  return docRead<StatusDoc>(statusPath(wallet), emptyStatusDoc(wallet));
}

export type ChangeResult = { ok: true; before: AbuseStatus; after: AbuseStatus } | { ok: false; error: string };

/** Atomically applies a status change under the policy's rules. */
export async function changeStatus(wallet: string, change: Change, now: number): Promise<ChangeResult> {
  if (!ADDRESS.test(wallet)) return { ok: false, error: "Invalid wallet." };
  return docUpdate<StatusDoc, ChangeResult>(statusPath(wallet), emptyStatusDoc(wallet), (doc) => {
    const r = applyStatusChange(doc, change, now);
    return r.ok ? { next: r.next, result: { ok: true, before: doc.status, after: r.next.status } } : { next: doc, result: r };
  });
}

export async function fileAppeal(wallet: string, message: string, now: number): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const id = randomBytes(8).toString("hex");
  return docUpdate<StatusDoc, { ok: true; id: string } | { ok: false; error: string }>(statusPath(wallet), emptyStatusDoc(wallet), (doc) => {
    const r = openAppeal(doc, message, id, now);
    return r.ok ? { next: r.next, result: { ok: true, id } } : { next: doc, result: r };
  });
}

export async function resolveAppeal(wallet: string, id: string, decision: "accepted" | "rejected", admin: string, note: string, now: number): Promise<{ ok: true } | { ok: false; error: string }> {
  return docUpdate<StatusDoc, { ok: true } | { ok: false; error: string }>(statusPath(wallet), emptyStatusDoc(wallet), (doc) => {
    const r = closeAppeal(doc, id, decision, admin, note, now);
    return r.ok ? { next: r.next, result: { ok: true } } : { next: doc, result: r };
  });
}

/** May this wallet earn points right now? Fails CLOSED for the stricter statuses only; an unreadable store throws (the caller must not award). */
export async function walletMayEarn(wallet: string): Promise<boolean> {
  return canEarnPoints((await getStanding(wallet)).status);
}

export async function listStandings(max = 5000): Promise<StatusDoc[]> {
  const paths = await docListPaths("abuse/status/", max);
  const docs: StatusDoc[] = [];
  for (let i = 0; i < paths.length; i += 20) {
    const chunk = await Promise.all(paths.slice(i, i + 20).map((p) => docRead<StatusDoc | null>(p, null)));
    for (const d of chunk) if (d) docs.push(d);
  }
  return docs;
}

/** Wallets whose points must be held out of totals right now. Sorted, so the recorded set is canonical. */
export async function walletsExcludedFromTotals(): Promise<string[]> {
  return (await listStandings()).filter((d) => !countsInTotals(d.status)).map((d) => d.wallet).sort();
}

// ---- reports -------------------------------------------------------------------------------

export type Coverage = {
  walletsInEpoch: number;
  /** Wallets actually analysed (the highest-points ones, up to the per-run cap). */
  wallets: number;
  trades: number;
  sales: number;
  profilesUsed: number;
  profilesMissing: number;
  /** True when the lookup cap or time budget stopped some wallets from being profiled. */
  profileBudgetReached: boolean;
};

export type AbuseReport = {
  version: 1;
  runId: string;
  epoch: number;
  ranAt: number;
  actor: string;
  configVersion: string;
  coverage: Coverage;
  findings: Finding[];
  /** Wallets the engine itself moved to REVIEW in this run. */
  reviewOpened: string[];
};

export async function saveReport(report: AbuseReport): Promise<boolean> {
  return docPutOnce(reportPath(report.epoch, report.runId), report);
}

export async function listReports(epoch: number): Promise<AbuseReport[]> {
  const paths = await docListPaths(`abuse/reports/${epoch}/`, 200);
  const reports = await Promise.all(paths.map((p) => docRead<AbuseReport | null>(p, null)));
  return reports.filter((r): r is AbuseReport => r !== null).sort((a, b) => a.ranAt - b.ranAt);
}

export const newRunId = (ts: number) => `${String(ts).padStart(13, "0")}-${randomBytes(4).toString("hex")}`;

// ---- profile cache ----------------------------------------------------------------------------

/** Only profiles whose true beginning we reached are cached: those facts never change. */
export async function getCachedProfile(wallet: string): Promise<WalletProfile | null> {
  if (!ADDRESS.test(wallet)) return null;
  const p = await docRead<WalletProfile | null>(profilePath(wallet), null);
  return p && p.wallet === wallet && p.reachedOrigin ? p : null;
}

export async function cacheProfile(p: WalletProfile): Promise<void> {
  if (!ADDRESS.test(p.wallet) || !p.reachedOrigin) return;
  await docPutOnce(profilePath(p.wallet), p);
}
