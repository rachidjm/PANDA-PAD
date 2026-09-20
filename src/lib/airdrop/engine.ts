import type { Epoch } from "@/lib/epochs/epoch";
import {
  BeginDecision,
  ChainStatus,
  ClaimRecord,
  decideBegin,
  markFailedBeforeSend,
  markSent,
  reconcileSent,
} from "./claim-machine";

/**
 * The claim orchestrator. All I/O is injected (`ClaimDeps`) so every failure
 * path — crash mid-claim, unknown outcome, concurrent double claim, expired
 * transaction — is tested with a fake chain instead of real money.
 *
 * The rules it enforces:
 *  1. The amount is the one in the verified allocation; the caller only says
 *     "which epoch" and (via its session) "which wallet".
 *  2. Exactly one concurrent caller wins the atomic reservation.
 *  3. The signed transaction's signature is durably recorded BEFORE it is
 *     submitted; from then on only the chain decides whether it was paid.
 *  4. A record is never marked CLAIMED before the transaction is FINALIZED,
 *     and never marked FAILED unless the chain proves it can't land.
 *  5. When anything is uncertain, the reservation stays and nothing is re-sent.
 */

export type PreparedTransfer = {
  signature: string;
  lastValidBlockHeight: number;
  /** Submits the already-signed transaction. May throw; the outcome is then unknown. */
  send: () => Promise<void>;
};

export type ClaimChain = {
  /** Builds and SIGNS the transfer; throws (before anything is sent) if it can't, e.g. the pool is too low. */
  prepare: (wallet: string, amount: bigint) => Promise<PreparedTransfer>;
  status: (signature: string, lastValidBlockHeight: number) => Promise<ChainStatus>;
};

export type ClaimDeps = {
  getEpoch: (id: number) => Promise<Epoch | null>;
  /** The wallet's allocation for the epoch, verified against the published root; "integrity" if the stored data doesn't verify. */
  getAllocation: (epoch: Epoch, wallet: string) => Promise<{ amount: bigint } | null | "integrity">;
  updateClaim: <R>(epoch: number, wallet: string, mutate: (rec: ClaimRecord | null) => { next: ClaimRecord | null; result: R }) => Promise<R>;
  chain: ClaimChain;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  alert: (event: string, details: Record<string, unknown>) => Promise<void>;
};

export type ClaimCode =
  | "NOT_DISTRIBUTING"
  | "NOT_ELIGIBLE"
  | "INTEGRITY"
  | "IN_PROGRESS"
  | "PREPARE_FAILED"
  | "SEND_UNCERTAIN"
  | "CONFIRMING"
  | "FAILED_ONCHAIN";

export type ClaimResult =
  | { ok: true; status: "CLAIMED"; signature: string; amount: string; alreadyClaimed: boolean }
  | { ok: false; code: ClaimCode; error: string; signature?: string };

const FINALITY_POLL_MS = 1500;

export async function claimAirdrop(
  args: { epochId: number; wallet: string },
  deps: ClaimDeps,
  opts: { maxWaitMs?: number } = {}
): Promise<ClaimResult> {
  const { epochId, wallet } = args;
  const maxWaitMs = opts.maxWaitMs ?? 20_000;

  const epoch = await deps.getEpoch(epochId);
  if (!epoch || epoch.status !== "DISTRIBUTING" || !epoch.merkleRoot) {
    return { ok: false, code: "NOT_DISTRIBUTING", error: "This epoch's airdrop isn't open for claims." };
  }

  const allocation = await deps.getAllocation(epoch, wallet);
  if (allocation === "integrity") {
    await deps.alert("Airdrop allocation failed verification — claims for this epoch refused", { epoch: epochId });
    return { ok: false, code: "INTEGRITY", error: "Airdrop data failed verification. Claims are halted for this epoch." };
  }
  if (!allocation || allocation.amount <= BigInt(0)) return { ok: false, code: "NOT_ELIGIBLE", error: "This wallet has no airdrop in this epoch." };
  const amount = allocation.amount;

  // At most two rounds: the second only after a reconcile proved a previous attempt can't land.
  for (let round = 0; round < 2; round++) {
    const decision = await deps.updateClaim<BeginDecision>(epochId, wallet, (rec) => {
      const d = decideBegin(rec, { epoch: epochId, wallet, amount: amount.toString(), now: deps.now() });
      return { next: d.action === "start" ? d.next : rec, result: d };
    });

    switch (decision.action) {
      case "already_claimed":
        return { ok: true, status: "CLAIMED", signature: decision.record.signature ?? "", amount: amount.toString(), alreadyClaimed: true };

      case "in_progress":
        return { ok: false, code: "IN_PROGRESS", error: "A claim for this wallet is already being processed." };

      case "mismatch":
        await deps.alert("Airdrop claim record doesn't match the verified allocation", { epoch: epochId, wallet });
        return { ok: false, code: "INTEGRITY", error: "Claim data failed verification. Claims are halted for this wallet." };

      case "reconcile": {
        const rec = decision.record;
        const chain = await deps.chain.status(rec.signature as string, rec.lastValidBlockHeight as number);
        const after = await deps.updateClaim<ClaimRecord | null>(epochId, wallet, (cur) => {
          const next = cur ? reconcileSent(cur, chain, deps.now()) : cur;
          return { next, result: next };
        });
        if (after?.status === "CLAIMED") {
          return { ok: true, status: "CLAIMED", signature: after.signature ?? "", amount: amount.toString(), alreadyClaimed: true };
        }
        if (after?.status === "FAILED") continue; // proven unpaid: go around once and start a fresh attempt
        return { ok: false, code: "CONFIRMING", error: "Your previous claim is still confirming on-chain.", signature: rec.signature };
      }

      case "start":
        return proceed(decision.next, amount, deps, maxWaitMs);
    }
  }
  return { ok: false, code: "IN_PROGRESS", error: "A claim for this wallet is being processed — check again shortly." };
}

async function proceed(reservation: ClaimRecord, amount: bigint, deps: ClaimDeps, maxWaitMs: number): Promise<ClaimResult> {
  const { epoch, wallet, attempts } = reservation;

  let prepared: PreparedTransfer;
  try {
    prepared = await deps.chain.prepare(wallet, amount);
  } catch (err) {
    // Nothing was signed or sent: proven not paid.
    await deps.updateClaim(epoch, wallet, (cur) => {
      const next = markFailedBeforeSend(cur, attempts, deps.now(), `prepare failed: ${String(err).slice(0, 120)}`);
      return { next: next ?? cur, result: null };
    });
    await deps.alert("Airdrop claim couldn't be prepared (pool underfunded or RPC down?)", { epoch, wallet, error: String(err).slice(0, 200) });
    return { ok: false, code: "PREPARE_FAILED", error: "Payouts are temporarily unavailable — nothing was paid, please try again later." };
  }

  // Record the signature BEFORE submitting, so a crash from here on can always be reconciled against the chain.
  const persisted = await deps.updateClaim<boolean>(epoch, wallet, (cur) => {
    const next = markSent(cur, attempts, prepared.signature, prepared.lastValidBlockHeight, deps.now());
    return { next: next ?? cur, result: next !== null };
  });
  if (!persisted) return { ok: false, code: "IN_PROGRESS", error: "A claim for this wallet is already being processed." };

  try {
    await prepared.send();
  } catch (err) {
    // The RPC may still have accepted it. Never re-send and never mark failed on a send error:
    // the chain (or expiry) decides, via the next reconcile.
    await deps.alert("Airdrop claim send errored — outcome unknown, will reconcile", { epoch, wallet, signature: prepared.signature, error: String(err).slice(0, 200) });
    return { ok: false, code: "SEND_UNCERTAIN", error: "Your claim was submitted but isn't confirmed yet. Check again shortly — it won't be paid twice.", signature: prepared.signature };
  }

  const deadline = deps.now() + maxWaitMs;
  for (;;) {
    let chain: ChainStatus = "pending";
    try {
      chain = await deps.chain.status(prepared.signature, prepared.lastValidBlockHeight);
    } catch {
      // A flaky read just means "not known yet".
    }
    if (chain !== "pending") {
      const after = await deps.updateClaim<ClaimRecord | null>(epoch, wallet, (cur) => {
        const next = cur ? reconcileSent(cur, chain, deps.now()) : cur;
        return { next, result: next };
      });
      if (after?.status === "CLAIMED") return { ok: true, status: "CLAIMED", signature: prepared.signature, amount: amount.toString(), alreadyClaimed: false };
      await deps.alert("Airdrop claim failed on-chain / expired — safe to retry", { epoch, wallet, signature: prepared.signature, chain });
      return { ok: false, code: "FAILED_ONCHAIN", error: "The payout didn't go through — nothing was paid, you can try again.", signature: prepared.signature };
    }
    if (deps.now() >= deadline) {
      return { ok: false, code: "CONFIRMING", error: "Your claim was sent and is confirming. Check again shortly — it won't be paid twice.", signature: prepared.signature };
    }
    await deps.sleep(FINALITY_POLL_MS);
  }
}
