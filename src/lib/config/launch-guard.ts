import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { decideMoneyFlow, getNetworkStatus, type MoneyFlowBlock } from "./network";
import { COIN_CREATION_BLOCKED_MESSAGE, decideCoinCreation } from "./creation";

/** The current answer to "may money move right now?" — used by the guard below, the public protocol status and the health page. */
export async function moneyFlowStatus(): Promise<MoneyFlowBlock> {
  return decideMoneyFlow(await getNetworkStatus(serverRpcUrl()));
}

const MESSAGES = {
  network_mismatch: "Trading is paused: this deployment's Solana RPC is on a different network than the one PANDA is configured for. Nothing was built.",
  network_unverified: "Trading is paused: the network of this deployment's Solana RPC could not be verified right now. Try again in a moment.",
  network_not_configured: "Trading is paused: this deployment has no NETWORK configured, so the network cannot be checked.",
  env_missing: "Trading is paused: this deployment's configuration is incomplete (see /api/health/trading).",
} as const;

/**
 * Call at the top of every route that builds or sends a transaction, or pays anyone. Returns the 503 to send when the
 * network guard blocks money flows, otherwise null. Never throws: a guard that crashed the route would be a bug of its own.
 */
export async function moneyFlowGuardResponse(): Promise<NextResponse | null> {
  let block: MoneyFlowBlock;
  try {
    block = await moneyFlowStatus();
  } catch {
    block = { blocking: true, reason: "network_unverified", expected: null, detected: null };
  }
  if (!block.blocking) return null;
  return NextResponse.json(
    { error: MESSAGES[block.reason], code: "MONEY_FLOWS_BLOCKED", reason: block.reason, expected: block.expected, detected: block.detected },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Call in routes that START a coin creation (Pump.fun create, and the OTC launch's first two steps), after the money-flow
 * guard. On mainnet it refuses until the treasury is declared a multisig (TREASURY_IS_MULTISIG=true); buying and selling
 * never call this.
 */
export function coinCreationGuardResponse(): NextResponse | null {
  const d = decideCoinCreation();
  if (d.allowed) return null;
  return NextResponse.json({ error: COIN_CREATION_BLOCKED_MESSAGE, code: "COIN_CREATION_BLOCKED", reason: d.reason }, { status: 503, headers: { "Cache-Control": "no-store" } });
}
