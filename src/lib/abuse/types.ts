/**
 * Anti-abuse data model. Everything here is integer: risk points 0–1000 and
 * confidence 0–100 (percent). Nothing is a float, so scores are reproducible.
 */

export type AbuseStatus = "NORMAL" | "REVIEW" | "RESTRICTED" | "DISQUALIFIED";
export const ABUSE_STATUSES: readonly AbuseStatus[] = ["NORMAL", "REVIEW", "RESTRICTED", "DISQUALIFIED"];

/** Independent kinds of evidence. Several distinct families are required before anything beyond REVIEW is even proposed. */
export type SignalFamily = "wash_market" | "wash_trade" | "sybil" | "velocity";

export type Signal = {
  /** Stable reason code, shown to admins and (for restricted wallets) to the wallet itself. */
  code: string;
  family: SignalFamily;
  /** How much this signal would add to the risk score if certain (0–1000). */
  points: number;
  /** How sure we are that it is abuse rather than a legitimate pattern (0–100). */
  confidence: number;
  /** Small, non-sensitive facts that explain the signal. */
  evidence: Record<string, string | number | boolean>;
};

export type Finding = {
  wallet: string;
  /** 0–1000. */
  score: number;
  /** 0–100, weighted by how much each signal contributed. */
  confidence: number;
  families: SignalFamily[];
  reasonCodes: string[];
  signals: Signal[];
  /** What the engine PROPOSES. Only REVIEW is ever applied automatically. */
  recommended: AbuseStatus;
};

// ---- inputs --------------------------------------------------------------------

export type TradeRec = { wallet: string; mint: string; side: "buy" | "sell"; lamports: number; ts: number };
export type SaleRec = { asset: string; buyer: string; seller: string; priceLamports: number; ts: number };

/** Facts about a wallet's history that never change once known (so they can be cached). */
export type WalletProfile = {
  wallet: string;
  /** Time of its oldest transaction we could see, or null if it has none / unknown. */
  firstSeenTs: number | null;
  /** True when we reached the very beginning of its history (so firstSeenTs is its real birth), false when older history exists. */
  reachedOrigin: boolean;
  /** Who sent it its first SOL, if that could be determined. */
  funder: string | null;
};

export type EpochWallet = { wallet: string; events: number; points: number };

export type AnalysisInput = {
  epochStart: number;
  epochEnd: number;
  wallets: EpochWallet[];
  trades: TradeRec[];
  sales: SaleRec[];
  profiles: Map<string, WalletProfile>;
  /** Wallets that are never analysed: PANDA's own wallets, admins, known infrastructure. */
  exempt: Set<string>;
};
