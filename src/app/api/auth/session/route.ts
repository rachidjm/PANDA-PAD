import { NextResponse } from "next/server";
import { getSession, sessionsRevocable } from "@/lib/auth/session";

/**
 * Auth: reads the caller's own session cookie. Returns the signed-in wallet (null if none), when it signed in, and — only to a signed-in
 * caller — whether its sessions can be revoked ("close all my sessions" is offered only where that is true).
 */
export async function GET(req: Request) {
  const session = await getSession(req);
  const res = NextResponse.json(session ? { wallet: session.wallet, issuedAt: session.issuedAt, revocable: sessionsRevocable() } : { wallet: null });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
