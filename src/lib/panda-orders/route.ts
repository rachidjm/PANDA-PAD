import { NextResponse } from "next/server";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { featureDisabledResponse } from "@/lib/config/guard";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { pausedResponse } from "@/lib/protocol/guard";
import { moneyRateGate } from "@/lib/rate-limit";
import type { Failure } from "./service";
import { ordersAllowed } from "./access";

/** What every PANDA orders route checks first: the flag, the money-flow guard (network/RPC/treasury configured), the
 *  emergency pause, same site, a signed-in wallet, and a per-wallet rate limit (fails closed). */
export async function guardOrders(req: Request, name: string, limit: number, opts: { read?: boolean } = {}): Promise<{ wallet: string } | NextResponse> {
  const disabled = featureDisabledResponse("PANDA_ORDERS");
  if (disabled) return disabled;
  if (!opts.read) {
    const moneyBlocked = await moneyFlowGuardResponse();
    if (moneyBlocked) return moneyBlocked;
    const paused = await pausedResponse("panda_orders");
    if (paused) return paused;
    if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  }
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  // Rollout: only the admins and PANDA_ORDERS_ALLOWLIST until it's opened to everyone (access.ts).
  if (!ordersAllowed(wallet)) return NextResponse.json({ error: "PANDA orders aren't available for this wallet yet.", code: "NOT_ALLOWED" }, { status: 403 });
  const limited = await moneyRateGate(`panda-orders-${name}:${wallet}`, limit, 60_000, () => NextResponse.json({ error: "Too many requests." }, { status: 429 }));
  if (limited) return limited;
  return { wallet };
}

export const failure = (f: Failure) => NextResponse.json({ error: f.message, code: f.code, issues: f.issues }, { status: f.status });

export async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
