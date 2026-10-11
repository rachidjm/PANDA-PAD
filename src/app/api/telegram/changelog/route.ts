import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { recordAudit } from "@/lib/audit/log";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { telegramConfig } from "@/lib/telegram/config";
import { changelogSecretMatches, receiveDraft, receiveHistory, receiveImages } from "@/lib/telegram/changelog";
import { realQueueDeps } from "@/lib/telegram/deps";
import { processOutbox } from "@/lib/telegram/queue";
import { xConfig } from "@/lib/x/client";

export const maxDuration = 30;
const MAX_BODY = 120_000; // a history of the whole project, with its two languages, is one request

/**
 * Receives a changelog DRAFT (docs/TELEGRAM.md §9). Auth: `Authorization: Bearer <CHANGELOG_PUBLISH_SECRET>` — its own
 * secret, compared in constant time. Off (flag or secret missing) → 404, as if it didn't exist. A valid draft is stored and
 * sent to the admins' PRIVATE chat (three versions to choose from, each with its translation); this endpoint can never
 * publish anything by itself.
 */
export async function POST(req: Request) {
  const cfg = telegramConfig();
  if (!cfg.changelogEnabled || !cfg.changelogSecret) return new NextResponse(null, { status: 404 });
  if (await rateLimited(`changelog:${clientIp(req)}`, 10, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (!changelogSecretMatches(req.headers.get("authorization"), cfg.changelogSecret)) return new NextResponse(null, { status: 401 });
  const body = await req.text();
  if (body.length > MAX_BODY) return NextResponse.json({ error: "Too large." }, { status: 413 });
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }
  // The project's history for the Updates page comes through the same door, as its own kind of draft.
  if (json && typeof json === "object" && "history" in json) {
    const h = await receiveHistory({ db: getDb(), now: Date.now, cfg }, json);
    if (!h.ok) return NextResponse.json({ error: h.error, problems: h.problems }, { status: h.status });
    await recordAudit({ actor: "system:changelog", action: "updates.history.draft", object: h.id });
    await processOutbox(realQueueDeps(), 4_000).catch(() => undefined);
    return NextResponse.json({ ok: true, id: h.id, history: h.entries, sentTo: h.sentTo });
  }
  // Screenshots for entries already on the page: the same door, the same approval.
  if (json && typeof json === "object" && "images" in json) {
    const i = await receiveImages({ db: getDb(), now: Date.now, cfg }, json);
    if (!i.ok) return NextResponse.json({ error: i.error, problems: i.problems }, { status: i.status });
    await recordAudit({ actor: "system:changelog", action: "updates.images.draft", object: i.id });
    await processOutbox(realQueueDeps(), 6_000).catch(() => undefined);
    return NextResponse.json({ ok: true, id: i.id, images: i.images, sentTo: i.sentTo });
  }
  const r = await receiveDraft({ db: getDb(), now: Date.now, cfg, x: { config: xConfig() } }, json);
  if (!r.ok) return NextResponse.json({ error: r.error, problems: r.problems }, { status: r.status });
  await recordAudit({ actor: "system:changelog", action: "telegram.changelog.draft", object: r.id });
  // Straight to the admins' chat (the cron would deliver it within a minute anyway).
  await processOutbox(realQueueDeps(), 4_000).catch(() => undefined);
  return NextResponse.json({ ok: true, id: r.id, xId: r.xId, deferred: r.deferred, sentTo: r.sentTo, versions: r.versions.length, xVersions: r.xVersions.length });
}
