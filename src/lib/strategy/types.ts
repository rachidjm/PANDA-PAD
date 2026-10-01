import type { FundingAsset } from "./plan";

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
  buyUsd: number;
  sellUsd: number;
  stopUsd: number;
  /**
   * Legacy fields from "staggered selling" (removed — Draw Your Trade is one buy, one sell, one stop again).
   * A strategy created while it existed could split into up to 10 sell tranches sharing one drawn position,
   * shown as ONE strategy — but each was its own real Jupiter order (its own deposit, its own OCO pair on its
   * own slice of the tokens), so each was its own StrategyRecord. `groupId` (= the first leg's `id`) ties them
   * back together; `legIndex` is 0-based, `legCount` how many siblings it has, `legPct` its share of the
   * position (all legs' `legPct` summed to 100). Still read (DrawTradePanel.tsx groups and shows them, and
   * each leg can still be cancelled) so an old multi-tranche strategy keeps working — nothing new is ever
   * created with more than one leg, so these are undefined on every strategy going forward.
   */
  groupId?: string;
  legIndex?: number;
  legCount?: number;
  legPct?: number;
  triggerCondition: "above" | "below";
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
