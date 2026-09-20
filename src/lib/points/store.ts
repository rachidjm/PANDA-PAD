import { docListPaths, docPutOnce, docRead, docUpdate } from "@/lib/storage/store";
import {
  acceptsEvents,
  canTransition,
  Epoch,
  EpochStatus,
  epochForTime,
  NewEpochInput,
  newEpoch,
  validateNewEpoch,
  withStatus,
} from "@/lib/epochs/epoch";
import { buildTotals, EpochTotals, totalsAreIntact } from "@/lib/epochs/totals";
import { applyAward, AwardInput, AwardOutcome, emptyWalletDoc, WalletEpochDoc } from "./events";
import { walletMayEarn, walletsExcludedFromTotals } from "@/lib/abuse/store";

/**
 * Storage for epochs and the points ledger (server only). One epochs index
 * document, one document per wallet per epoch (so awards for different
 * wallets never contend), and one immutable totals document per finalized epoch.
 */

const EPOCHS_PATH = "epochs/index.json";
const walletPath = (epoch: number, wallet: string) => `points/wallets/${epoch}/${wallet}.json`;
const totalsPath = (epoch: number) => `points/totals/${epoch}.json`;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

type EpochsDoc = { version: 1; epochs: Epoch[] };
const EMPTY: EpochsDoc = { version: 1, epochs: [] };

export async function getEpochs(): Promise<Epoch[]> {
  return (await docRead<EpochsDoc>(EPOCHS_PATH, EMPTY)).epochs;
}

export async function createEpoch(input: NewEpochInput, now: number): Promise<{ ok: true; epoch: Epoch } | { ok: false; error: string }> {
  return docUpdate<EpochsDoc, { ok: true; epoch: Epoch } | { ok: false; error: string }>(EPOCHS_PATH, EMPTY, (doc) => {
    const error = validateNewEpoch(input, doc.epochs, now);
    if (error) return { next: doc, result: { ok: false, error } };
    const epoch = newEpoch(input, doc.epochs, now);
    return { next: { ...doc, epochs: [...doc.epochs, epoch] }, result: { ok: true, epoch } };
  });
}

export type TransitionResult = { ok: true; before: Epoch; after: Epoch } | { ok: false; error: string };

/** Moves an epoch to a new status if the rules allow it, atomically against the epoch's current status. */
export async function transitionEpoch(id: number, to: EpochStatus, now: number, patch: Partial<Epoch> = {}): Promise<TransitionResult> {
  return docUpdate<EpochsDoc, TransitionResult>(EPOCHS_PATH, EMPTY, (doc) => {
    const before = doc.epochs.find((e) => e.id === id);
    if (!before) return { next: doc, result: { ok: false, error: "No such epoch." } };
    const check = canTransition(before, to, now);
    if (!check.ok) return { next: doc, result: { ok: false, error: check.reason } };
    const after = { ...withStatus(before, to), ...patch };
    return { next: { ...doc, epochs: doc.epochs.map((e) => (e.id === id ? after : e)) }, result: { ok: true, before, after } };
  });
}

export type AwardResult = {
  outcome: "recorded" | "duplicate" | "capped" | "rejected";
  awarded: number;
  reason?: string;
  epoch?: number;
};

/**
 * Records points for a wallet. The epoch is decided by the EVENT's own time
 * (never "now"), and must be ACTIVE — an event that belongs to a closed or
 * finalized epoch is refused, not slipped into a later one. Idempotent by eventId.
 */
export async function awardPoints(input: Omit<AwardInput, "epoch">): Promise<AwardResult> {
  if (!SOLANA_ADDRESS.test(input.wallet)) return { outcome: "rejected", awarded: 0, reason: "bad_wallet" };
  const epoch = epochForTime(await getEpochs(), input.ts);
  if (!epoch) return { outcome: "rejected", awarded: 0, reason: "no_epoch_for_time" };
  if (!acceptsEvents(epoch)) return { outcome: "rejected", awarded: 0, reason: `epoch_${epoch.status.toLowerCase()}` };
  // A wallet under RESTRICTED / DISQUALIFIED earns nothing new. Admin corrections stay possible (they can only fix the ledger).
  if (input.type !== "correction" && !(await walletMayEarn(input.wallet))) return { outcome: "rejected", awarded: 0, reason: "wallet_restricted" };

  const result = await docUpdate<WalletEpochDoc, AwardOutcome>(walletPath(epoch.id, input.wallet), emptyWalletDoc(input.wallet, epoch.id), (doc) => {
    const r = applyAward(doc, { ...input, epoch: epoch.id }, Date.now());
    return { next: r.next, result: r };
  });
  return {
    outcome: result.outcome,
    awarded: result.awarded,
    epoch: epoch.id,
    ...(result.outcome === "rejected" ? { reason: result.reason } : {}),
  };
}

export async function getWalletDoc(epoch: number, wallet: string): Promise<WalletEpochDoc> {
  if (!SOLANA_ADDRESS.test(wallet)) return emptyWalletDoc(wallet, epoch);
  return docRead<WalletEpochDoc>(walletPath(epoch, wallet), emptyWalletDoc(wallet, epoch));
}

export async function listWalletDocs(epoch: number): Promise<WalletEpochDoc[]> {
  const paths = await docListPaths(`points/wallets/${epoch}/`);
  const docs: WalletEpochDoc[] = [];
  for (let i = 0; i < paths.length; i += 20) {
    const chunk = await Promise.all(paths.slice(i, i + 20).map((p) => docRead<WalletEpochDoc | null>(p, null)));
    for (const d of chunk) if (d) docs.push(d);
  }
  return docs;
}

/** The pinned results of a finalized epoch, or null if there are none or they fail the integrity check. */
export async function getTotals(epoch: number): Promise<EpochTotals | null> {
  const t = await docRead<EpochTotals | null>(totalsPath(epoch), null);
  return t && totalsAreIntact(t) ? t : null;
}

/**
 * CALCULATING -> FINALIZED. Totals are computed from every wallet document,
 * written ONCE (never overwritten) and their hash pinned on the epoch. If a
 * totals file already exists it must be identical, otherwise this refuses:
 * results are never silently replaced.
 */
export async function finalizeEpoch(id: number, now: number): Promise<{ ok: true; totals: EpochTotals; epoch: Epoch } | { ok: false; error: string }> {
  const epoch = (await getEpochs()).find((e) => e.id === id);
  if (!epoch) return { ok: false, error: "No such epoch." };
  if (epoch.status !== "CALCULATING") return { ok: false, error: `Epoch is ${epoch.status}, not CALCULATING.` };

  const totals = buildTotals(id, epoch.formulaVersion, await listWalletDocs(id), await walletsExcludedFromTotals());
  if (!(await docPutOnce(totalsPath(id), totals))) {
    const existing = await docRead<EpochTotals | null>(totalsPath(id), null);
    if (!existing || !totalsAreIntact(existing) || existing.hash !== totals.hash) {
      return { ok: false, error: "Totals already exist and differ from a fresh calculation — refusing to overwrite. Investigate." };
    }
  }

  const moved = await transitionEpoch(id, "FINALIZED", now, { totalsHash: totals.hash, finalizedAt: now });
  if (!moved.ok) return moved;
  return { ok: true, totals, epoch: moved.after };
}
