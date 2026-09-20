import { NextResponse } from "next/server";
import { clearSessionCookie, sameOrigin } from "@/lib/auth/session";

/** Auth: none needed (clears the caller's own cookie). */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
