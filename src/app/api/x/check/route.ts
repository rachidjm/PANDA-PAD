import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { telegramConfig } from "@/lib/telegram/config";
import { changelogSecretMatches } from "@/lib/telegram/changelog";
import { realXClient, xConfig } from "@/lib/x/client";

export const maxDuration = 30;

/**
 * A READ-ONLY check of PANDA's credentials on X: asks X who the signed-in account is (GET /2/users/me) and answers with
 * its username — or with the reason X gave. It never posts anything and never returns a credential (only the NAMES of
 * the ones that are missing). Auth: the changelog secret, compared in constant time; without it → 404. Limited to a few
 * calls a minute: each one is a billed request to X.
 */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.changelogSecret || !changelogSecretMatches(req.headers.get("authorization"), cfg.changelogSecret)) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`x-check:${clientIp(req)}`, 3, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const x = xConfig();
  const settings = { postingEnabled: x.enabled, missing: x.missing, maxPerDay: x.maxPerDay, hasDefaultImage: !!x.defaultImageUrl };
  if (!x.creds) return NextResponse.json({ ok: false, reason: "credentials missing", ...settings });
  const r = await realXClient(x.creds).verify();
  await recordAudit({ actor: "system:changelog", action: "x.credentials.check", object: "x", newState: { ok: r.ok } });
  return NextResponse.json(r.ok ? { ok: true, username: r.value.username, ...settings } : { ok: false, reason: r.reason, status: r.status, ...settings });
}
