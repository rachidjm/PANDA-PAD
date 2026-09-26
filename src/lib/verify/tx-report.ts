import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { deriveTrade, type TxView } from "@/lib/portfolio/derive-trade";
import { MIN_SYSTEM_ACCOUNT_LAMPORTS } from "@/lib/pump/fee-transfer";

/**
 * A read-only report on ONE transaction: which accounts it touched, how much SOL reached the treasury, and whether that
 * matches PANDA's fee of `feeBps` on the trade. Pure (plain data in, plain data out) so it can be tested without a chain;
 * scripts/verify-tx.ts is the thin wrapper that fetches the transaction. No key is ever involved: it only reads.
 */

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  ComputeBudget111111111111111111111111111111: "Compute Budget",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "SPL Token",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "SPL Token-2022",
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: "Associated Token Account",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P": "Pump.fun (bonding curve)",
  pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA: "PumpSwap (AMM)",
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: "Jupiter v6",
  So11111111111111111111111111111111111111112: "Wrapped SOL",
};

export type Verdict = "match" | "mismatch" | "no_fee_found" | "skipped_by_design" | "not_a_trade" | "tx_failed";

export type TxReport = {
  signature: string;
  status: "success" | "failed";
  error: unknown;
  slot: number;
  blockTime: string | null;
  feePayer: string;
  networkFeeLamports: number;
  computeUnits: number | null;
  accounts: { index: number; pubkey: string; label?: string; signer: boolean; writable: boolean; preLamports: number; postLamports: number; deltaLamports: number }[];
  programs: { programId: string; label?: string }[];
  treasury: {
    address: string;
    /** SystemProgram transfers wallet → treasury among the transaction's own (top-level) instructions. */
    feeTransfers: { instructionIndex: number; lamports: number }[];
    transferredLamports: number;
    preLamports: number | null;
    postLamports: number | null;
    /** What the treasury's balance really changed by in this transaction (from the chain's own pre/post balances). */
    balanceDeltaLamports: number | null;
  };
  trade: { side: "buy" | "sell"; mint: string; tokenAmount: number; baseLamports: number } | null;
  fee: { expectedBps: number; expectedLamports: number | null; actualLamports: number; diffLamports: number | null; verdict: Verdict; note: string };
};

/** How far the actual fee may be from `bps` of the base before it is called a mismatch: the base is estimated from balance changes. */
export const TOLERANCE_RELATIVE = 0.05;
export const TOLERANCE_ABSOLUTE_LAMPORTS = 5_000;

export function buildReport(tx: ParsedTransactionWithMeta, signature: string, opts: { treasury: string; feeBps: number; wallet?: string }): TxReport {
  const meta = tx.meta;
  const message = tx.transaction.message;
  const keys = message.accountKeys.map((k) => ({ pubkey: k.pubkey.toBase58(), signer: k.signer, writable: k.writable }));
  const pre = meta?.preBalances ?? [];
  const post = meta?.postBalances ?? [];
  const feePayer = keys[0]?.pubkey ?? "";
  const wallet = opts.wallet ?? feePayer;
  const networkFee = meta?.fee ?? 0;
  const failed = !meta || meta.err !== null;

  const accounts = keys.map((k, i) => ({
    index: i,
    pubkey: k.pubkey,
    label: k.pubkey === opts.treasury ? "PANDA treasury" : k.pubkey === wallet ? "trader wallet" : KNOWN_PROGRAMS[k.pubkey],
    signer: k.signer,
    writable: k.writable,
    preLamports: pre[i] ?? 0,
    postLamports: post[i] ?? 0,
    deltaLamports: (post[i] ?? 0) - (pre[i] ?? 0),
  }));

  const programIds = [...new Set(message.instructions.map((ix) => ix.programId.toBase58()))];
  const programs = programIds.map((programId) => ({ programId, label: KNOWN_PROGRAMS[programId] }));

  // The fee: plain SystemProgram transfers wallet → treasury among the transaction's own instructions (the same rule the
  // points system uses to decide that a trade went through PANDA).
  const feeTransfers: { instructionIndex: number; lamports: number }[] = [];
  message.instructions.forEach((ix, index) => {
    if (!("parsed" in ix) || ix.program !== "system") return;
    const parsed = ix.parsed as { type?: string; info?: { source?: string; destination?: string; lamports?: number } };
    if (parsed.type !== "transfer" || parsed.info?.source !== wallet || parsed.info?.destination !== opts.treasury) return;
    if (Number.isSafeInteger(parsed.info.lamports) && (parsed.info.lamports as number) > 0) feeTransfers.push({ instructionIndex: index, lamports: parsed.info.lamports as number });
  });
  const actual = feeTransfers.reduce((s, t) => s + t.lamports, 0);

  const treasuryIdx = keys.findIndex((k) => k.pubkey === opts.treasury);
  const treasury: TxReport["treasury"] = {
    address: opts.treasury,
    feeTransfers,
    transferredLamports: actual,
    preLamports: treasuryIdx >= 0 ? pre[treasuryIdx] ?? 0 : null,
    postLamports: treasuryIdx >= 0 ? post[treasuryIdx] ?? 0 : null,
    balanceDeltaLamports: treasuryIdx >= 0 ? (post[treasuryIdx] ?? 0) - (pre[treasuryIdx] ?? 0) : null,
  };

  const view: TxView = {
    keys,
    preBalances: pre,
    postBalances: post,
    preTokenBalances: meta?.preTokenBalances as TxView["preTokenBalances"],
    postTokenBalances: meta?.postTokenBalances as TxView["postTokenBalances"],
    fee: networkFee,
  };
  const derived = failed ? null : deriveTrade(view, wallet, 0.00001); // a fee check is often run on a tiny test trade

  let trade: TxReport["trade"] = null;
  if (derived) {
    // deriveTrade's amount is the wallet's net SOL change (network fee removed), so it still contains PANDA's own fee and
    // any account rent. Take those out to get the trade's own SOL:
    //  buy  → the wallet paid  base + PANDA fee + rent of the accounts it opened (accounts that went 0 → funded)
    //  sell → the wallet netted base − PANDA fee + rent refunded by the accounts it closed (funded → 0)
    const solLamports = Math.round(derived.solAmount * 1e9);
    const opened = accounts.filter((a) => a.pubkey !== opts.treasury && a.pubkey !== wallet && a.preLamports === 0 && a.postLamports > 0).reduce((s, a) => s + a.postLamports, 0);
    const closed = accounts.filter((a) => a.pubkey !== opts.treasury && a.pubkey !== wallet && a.preLamports > 0 && a.postLamports === 0).reduce((s, a) => s + a.preLamports, 0);
    const base = derived.side === "buy" ? solLamports - actual - opened : solLamports + actual - closed;
    trade = { side: derived.side, mint: derived.mint, tokenAmount: derived.tokenAmount, baseLamports: Math.max(0, base) };
  }

  const expectedLamports = trade ? Math.floor((trade.baseLamports * opts.feeBps) / 10_000) : null;
  let verdict: Verdict;
  let note: string;
  if (failed) {
    verdict = "tx_failed";
    note = "The transaction failed on-chain, so nothing was traded and no fee was charged.";
  } else if (!trade) {
    verdict = "not_a_trade";
    note = "Not a clean swap of one coin against SOL for this wallet (a transfer, a launch, several tokens, or a stablecoin-priced swap), so there is no fee to check.";
  } else if (actual === 0) {
    const receivable = treasury.preLamports === null || (expectedLamports ?? 0) + treasury.preLamports >= MIN_SYSTEM_ACCOUNT_LAMPORTS;
    if (!receivable) {
      verdict = "skipped_by_design";
      note = `No fee was charged: the treasury held ${treasury.preLamports} lamports and a fee of ~${expectedLamports} would not lift it over the ${MIN_SYSTEM_ACCOUNT_LAMPORTS}-lamport rent minimum, so PANDA skips the fee rather than let the trade fail. Fund the treasury (>= 0.002 SOL).`;
    } else {
      verdict = "no_fee_found";
      note = "No transfer to the treasury in this transaction: it did not go through PANDA, or the fee was not added.";
    }
  } else {
    const diff = actual - (expectedLamports as number);
    const tolerance = Math.max(TOLERANCE_ABSOLUTE_LAMPORTS, Math.ceil((expectedLamports as number) * TOLERANCE_RELATIVE));
    verdict = Math.abs(diff) <= tolerance ? "match" : "mismatch";
    note =
      verdict === "match"
        ? `The fee paid to the treasury is ${opts.feeBps / 100}% of the trade (within ${tolerance} lamports: the base is estimated from balance changes).`
        : `The fee paid (${actual}) differs from ${opts.feeBps / 100}% of the estimated trade (${expectedLamports}) by ${diff} lamports, more than the ${tolerance} tolerated. Check the accounts above (unusual rent, several tokens, or a wrong fee).`;
  }

  return {
    signature,
    status: failed ? "failed" : "success",
    error: meta?.err ?? null,
    slot: tx.slot,
    blockTime: tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null,
    feePayer,
    networkFeeLamports: networkFee,
    computeUnits: meta?.computeUnitsConsumed ?? null,
    accounts,
    programs,
    treasury,
    trade,
    fee: { expectedBps: opts.feeBps, expectedLamports, actualLamports: actual, diffLamports: expectedLamports === null ? null : actual - expectedLamports, verdict, note },
  };
}
