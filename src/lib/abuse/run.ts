import type { Epoch } from "@/lib/epochs/epoch";
import { walletTotal, WalletEpochDoc } from "@/lib/points/events";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import type { Sale } from "@/lib/market/store";
import { ABUSE_CONFIG as C } from "./config";
import { analyze } from "./score";
import { AbuseReport, cacheProfile, changeStatus, getCachedProfile, newRunId, saveReport } from "./store";
import type { AnalysisInput, Finding, SaleRec, TradeRec, WalletProfile } from "./types";

/**
 * One analysis run over an epoch: gathers what the platform really recorded
 * (points ledger, trade logs, completed NFT sales, on-chain wallet history),
 * scores every wallet, stores an immutable report, and opens a REVIEW on
 * flagged wallets. It never applies anything stronger than REVIEW — RESTRICTED
 * and DISQUALIFIED are proposals in the report for a person to decide.
 *
 * The outside world comes in through `AbuseDeps`, so the whole flow is testable.
 */

export type AbuseDeps = {
  now: () => number;
  getEpoch: (id: number) => Promise<Epoch | null>;
  walletDocs: (epoch: number) => Promise<WalletEpochDoc[]>;
  trades: (wallet: string) => Promise<LoggedTrade[]>;
  completedSales: () => Promise<Sale[]>;
  /** A wallet's on-chain beginnings; null when it can't be determined. Costs RPC calls. */
  lookupProfile: (wallet: string) => Promise<WalletProfile | null>;
  /** PANDA's own wallets and admins — never analysed. */
  exempt: () => Set<string>;
  /** Per-wallet event cap of the points ledger (for the frequency signal). */
  eventCap: number;
};

async function inChunks<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export type RunResult = { ok: true; report: AbuseReport } | { ok: false; error: string };

export async function runAnalysis(args: { epochId: number; actor: string }, deps: AbuseDeps): Promise<RunResult> {
  const started = deps.now();
  const epoch = await deps.getEpoch(args.epochId);
  if (!epoch) return { ok: false, error: "No such epoch." };
  if (epoch.status === "UPCOMING") return { ok: false, error: "That epoch hasn't started." };

  const exempt = deps.exempt();
  const docs = await deps.walletDocs(epoch.id);
  const inEpoch = docs
    .filter((d) => !exempt.has(d.wallet))
    .map((d) => ({ wallet: d.wallet, events: d.events.length, points: walletTotal(d) }));
  // Highest points first: those are the wallets that gain most if they cheat.
  const analysed = [...inEpoch].sort((a, b) => b.points - a.points || (a.wallet < b.wallet ? -1 : 1)).slice(0, C.maxWalletsPerRun);
  const subjects = new Set(analysed.map((w) => w.wallet));

  const tradeLogs = await inChunks(analysed, 10, async (w) => ({ wallet: w.wallet, log: await deps.trades(w.wallet) }));
  const trades: TradeRec[] = [];
  for (const { wallet, log } of tradeLogs) {
    for (const t of log) {
      if (t.ts < epoch.startTime || t.ts >= epoch.snapshotTime) continue;
      const lamports = Math.round(t.solAmount * 1e9);
      if (Number.isSafeInteger(lamports) && lamports > 0) trades.push({ wallet, mint: t.mint, side: t.side, lamports, ts: t.ts });
    }
  }

  const sales: SaleRec[] = [];
  for (const s of await deps.completedSales()) {
    const ts = s.completedAt ?? s.createdAt;
    if (s.status === "COMPLETED" && ts >= epoch.startTime && ts < epoch.snapshotTime) {
      sales.push({ asset: s.assetAddress, buyer: s.buyer, seller: s.seller, priceLamports: s.priceLamports, ts });
    }
  }

  // Profiles: cached ones are free; the rest are bounded by count and time. Epoch wallets first, then sale counterparties.
  const wanted = [...new Set([...analysed.map((w) => w.wallet), ...sales.flatMap((s) => [s.buyer, s.seller])])].filter((w) => !exempt.has(w));
  const profiles = new Map<string, WalletProfile>();
  let lookups = 0;
  let budgetReached = false;
  let missing = 0;
  for (const w of wanted) {
    const cached = await getCachedProfile(w);
    if (cached) {
      profiles.set(w, cached);
      continue;
    }
    if (lookups >= C.maxProfileLookups || deps.now() - started > C.maxLookupMs) {
      budgetReached = true;
      missing++;
      continue;
    }
    lookups++;
    try {
      const p = await deps.lookupProfile(w);
      if (p) {
        profiles.set(w, p);
        await cacheProfile(p);
      } else missing++;
    } catch {
      missing++; // a failed lookup proves nothing: no profile, no claim
    }
  }

  const input: AnalysisInput = { epochStart: epoch.startTime, epochEnd: epoch.snapshotTime, wallets: analysed, trades, sales, profiles, exempt };
  const findings: Finding[] = analyze(input, deps.eventCap).filter((f) => subjects.has(f.wallet));

  const now = deps.now();
  const runId = newRunId(now);
  const reviewOpened: string[] = [];
  for (const f of findings) {
    if (f.recommended === "NORMAL") continue;
    const r = await changeStatus(
      f.wallet,
      {
        to: "REVIEW",
        actor: { kind: "engine" },
        reason: `Automatic review: ${f.reasonCodes.join(", ")}`,
        reasonCodes: f.reasonCodes,
        score: f.score,
        confidence: f.confidence,
        reportId: runId,
        configVersion: C.version,
      },
      now
    );
    if (r.ok) reviewOpened.push(f.wallet);
  }

  const report: AbuseReport = {
    version: 1,
    runId,
    epoch: epoch.id,
    ranAt: now,
    actor: args.actor,
    configVersion: C.version,
    coverage: {
      walletsInEpoch: inEpoch.length,
      wallets: analysed.length,
      trades: trades.length,
      sales: sales.length,
      profilesUsed: profiles.size,
      profilesMissing: missing,
      profileBudgetReached: budgetReached,
    },
    findings,
    reviewOpened,
  };
  if (!(await saveReport(report))) return { ok: false, error: "A report with this id already exists." };
  return { ok: true, report };
}
