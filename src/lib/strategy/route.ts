import { NextResponse } from "next/server";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { moneyRateGate } from "@/lib/rate-limit";
import type { Failure } from "./service";

/** What every strategy route that changes something checks first: same site, a signed-in wallet, not too many calls. */
export async function guardWrite(req: Request, name: string, limit: number): Promise<{ wallet: string; token: string } | NextResponse> {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused." }, { status: 403 });
  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in required.", code: "AUTH_REQUIRED" }, { status: 401 });
  // Strategies move funds into Jupiter's vault: fail closed if the limiter can't answer (src/lib/rate-limit.ts).
  const limited = await moneyRateGate(`strategy-${name}:${wallet}`, limit, 60_000, () => NextResponse.json({ error: "Too many requests." }, { status: 429 }));
  if (limited) return limited;
  // The Jupiter session token: proves to Jupiter (not to PANDA) that the wallet signed in there. It is forwarded, never stored.
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Missing Jupiter session.", code: "JUPITER_AUTH_REQUIRED" }, { status: 401 });
  return { wallet, token };
}

export const failureResponse = (f: Failure) => NextResponse.json({ error: f.message, code: f.code, issues: f.issues }, { status: f.status });

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
