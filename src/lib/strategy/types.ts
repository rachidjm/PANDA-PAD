import type { FundingAsset } from "./plan";
import type { OrderKind } from "./kinds";

/** What the user sees. Only ever advanced by facts: Jupiter's order state plus a transaction confirmed on-chain. */
export type StrategyStatus = "waiting" | "buy_triggered" | "position_open" | "sell_triggered" | "completed" | "failed" | "cancelled";

/** Before a strategy is live it is only a prepared deposit; `creating` is the moment the order is being submitted. */
export type RecordState = "prepared" | "creating" | StrategyStatus;

export const TERMINAL: readonly RecordState[] = ["completed", "failed", "cancelled"];

export type StrategyRecord = {
  /** Client-generated idempotency key: the same id can only ever become one order. */
  id: string;
  n: number;
  wallet: string;
  mint: string;
  ticker: string;
  /** Which order shape this is (kinds.ts). Absent on strategies created before shapes existed: those are buy_sell_stop. */
  kind?: OrderKind;
  /** For the shapes that SELL a held token: the share of the balance this order sells (1–100). */
  sellPct?: number;
  /** Each leg's USD price, present only when the shape has that leg. */
  buyUsd?: number;
  sellUsd?: number;
  stopUsd?: number;
  /**
   * Grouping for a drawn position made of several real orders sharing one deposit-able balance: a legacy
   * "staggered selling" strategy (removed), or a held-coin draft's percentage tranches (allocation.ts) — one
   * sell/stop/oco PER tranche, each its own StrategyRecord with its own deposit, shown as ONE card in the UI.
   * `groupId` (= the first leg's `id`) ties them back together; `legIndex` is 0-based, `legCount` how many
   * siblings it has, `legPct` its share of the position (every leg's `legPct` sums to at most 100). A
   * single-order strategy never sets these.
   */
  groupId?: string;
  legIndex?: number;
  legCount?: number;
  legPct?: number;
  /** The buy's trigger direction (buy shapes only). */
  triggerCondition?: "above" | "below";
  fundingAsset: FundingAsset;
  fundingMint: string;
  inputAmountRaw: string;
  /** What the user asked to invest, in USD at the server's price when it was prepared. */
  amountUsd: number;
  /** PANDA's fee for setting the strategy up (0.5% buy + 0.5% sell of the amount), paid in SOL when it is confirmed. */
  feeLamports: number;
  feeState: "none" | "prepared" | "paid" | "failed";
  feeSignature?: string;
  feeError?: string;
  state: RecordState;
  depositRequestId: string;
  jupiterOrderId?: string;
  buySignature?: string;
  sellSignature?: string;
  /** How the position closed: at the SELL target or at the stop. */
  sellKind?: "take_profit" | "stop_loss";
  /** Set when the position was bought but the exit orders ended without selling (the tokens are in the user's hands). */
  holdsTokens?: boolean;
  error?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  lastSyncAt?: number;
};

export type StrategyDoc = { strategies: StrategyRecord[] };
