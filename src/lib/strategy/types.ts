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
  triggerCondition: "above" | "below";
  fundingAsset: FundingAsset;
  fundingMint: string;
  inputAmountRaw: string;
  /** What the user asked to invest, in USD at the server's price when it was prepared. */
  amountUsd: number;
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
