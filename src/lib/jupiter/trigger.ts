/**
 * Server-side wrapper for Jupiter's Trigger API v2 — real Stop Loss / Take
 * Profit orders (developers.jup.ag/docs/api-reference/trigger/*, field names
 * verified directly against the live docs at implementation time). Every
 * order lives in a Privy-managed custodial vault (Jupiter's term, not a
 * PANDA concept) from the moment a deposit is confirmed until the order
 * fills or is cancelled — PANDA never holds the funds or the wallet's JWT
 * beyond forwarding a single request. `JUPITER_API_KEY` is server-only and
 * never sent to the browser.
 */

const TRIGGER_BASE = "https://api.jup.ag/trigger/v2";

function apiKeyHeader(): Record<string, string> {
  const key = process.env.JUPITER_API_KEY;
  return key ? { "x-api-key": key } : {};
}

async function triggerFetch<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const res = await fetch(`${TRIGGER_BASE}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...apiKeyHeader(),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.headers || {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Jupiter Trigger API ${path} failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return res.json();
}

export type AuthChallenge = { type: "message"; challenge: string } | { type: "transaction"; transaction: string };

/** Step 1 — request a message for the wallet to sign, proving ownership before any vault action. */
export function getAuthChallenge(walletPubkey: string): Promise<AuthChallenge> {
  return triggerFetch<AuthChallenge>("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ walletPubkey, type: "message" }),
  });
}

/** Step 2 — exchange the signed message for a JWT (24h validity, no refresh — re-challenge after that). */
export function verifyAuthChallenge(walletPubkey: string, signature: string): Promise<{ token: string }> {
  return triggerFetch<{ token: string }>("/auth/verify", {
    method: "POST",
    body: JSON.stringify({ type: "message", walletPubkey, signature }),
  });
}

export type DepositCraft = {
  transaction: string;
  requestId: string;
  receiverAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
};

/** Step 3 — build the unsigned transaction that moves funds from the wallet into its Trigger vault. */
export function craftDeposit(params: {
  inputMint: string;
  outputMint: string;
  userAddress: string;
  amount: string;
  orderType: "price" | "dca";
  orderSubType?: "single" | "oco" | "otoco";
}, token?: string): Promise<DepositCraft> {
  // The docs say `userAddress` must match the JWT, so the JWT goes with the request.
  return triggerFetch<DepositCraft>("/deposit/craft", { method: "POST", body: JSON.stringify(params), token });
}

export type CreateOrderParams = {
  orderType: "single" | "oco" | "otoco";
  depositRequestId: string;
  depositSignedTx: string;
  userPubkey: string;
  inputMint: string;
  inputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition?: "above" | "below";
  triggerPriceUsd?: number;
  slippageBps?: number;
  tpPriceUsd?: number;
  slPriceUsd?: number;
  tpSlippageBps?: number;
  slSlippageBps?: number;
  expiresAt: number;
};

export type CreatedOrder = { id: string; txSignature: string; depositConfirmed: boolean; message?: string };

/** Step 4 — submit the signed deposit plus the real order parameters (an "oco" order pairs SL+TP: whichever fills first cancels the other). */
export function createOrder(params: CreateOrderParams, token: string): Promise<CreatedOrder> {
  return triggerFetch<CreatedOrder>("/orders/price", { method: "POST", body: JSON.stringify(params), token });
}

/** One entry of an order's history; `orderContext` names what the movement was ("buy_below", "take_profit", "stop_loss"…). */
export type TriggerEvent = {
  type?: string;
  timestamp?: number;
  state?: string;
  txSignature?: string;
  mint?: string;
  amount?: string;
  outputMint?: string;
  outputAmount?: string;
  orderContext?: string;
};

export type TriggerOrder = {
  id: string;
  orderType: string;
  orderState: string;
  inputMint: string;
  initialInputAmount: string;
  remainingInputAmount: string;
  outputMint: string;
  triggerMint: string;
  triggerCondition: string;
  triggerPriceUsd: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
  userPubkey?: string;
  triggeredAt?: number;
  outputAmount?: string;
  fillPercent?: number;
  events?: TriggerEvent[];
};

export function listOrders(
  token: string,
  params: { state?: "active" | "past"; mint?: string; limit?: number; offset?: number } = {}
): Promise<{ orders: TriggerOrder[] }> {
  const qs = new URLSearchParams();
  if (params.state) qs.set("state", params.state);
  if (params.mint) qs.set("mint", params.mint);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));
  const query = qs.toString();
  return triggerFetch<{ orders: TriggerOrder[] }>(`/orders/history${query ? `?${query}` : ""}`, {
    method: "GET",
    token,
  });
}

/** Cancel step 1 — builds the unsigned withdrawal transaction that returns the order's vault funds to the user's own wallet. */
export function craftCancel(orderId: string, token: string): Promise<{ id: string; transaction: string; requestId: string }> {
  return triggerFetch<{ id: string; transaction: string; requestId: string }>(`/orders/price/cancel/${orderId}`, {
    method: "POST",
    token,
  });
}

/** Cancel step 2 — submits the user-signed withdrawal transaction to actually settle the cancellation on-chain. */
export function confirmCancel(
  orderId: string,
  params: { signedTransaction: string; cancelRequestId: string },
  token: string
): Promise<{ id: string; txSignature: string }> {
  return triggerFetch<{ id: string; txSignature: string }>(`/orders/price/confirm-cancel/${orderId}`, {
    method: "POST",
    body: JSON.stringify(params),
    token,
  });
}
