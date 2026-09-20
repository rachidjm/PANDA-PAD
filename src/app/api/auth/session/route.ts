import { NextResponse } from "next/server";
import { getSessionWallet } from "@/lib/auth/session";

/** Auth: reads the caller's own session cookie. Returns the signed-in wallet or null. */
export async function GET(req: Request) {
  const res = NextResponse.json({ wallet: getSessionWallet(req) });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
