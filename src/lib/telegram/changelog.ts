import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { tgDecideChangelog, tgEnqueue, tgGetChangelog, tgInsertChangelog } from "@/lib/db/telegram";
import type { TelegramConfig } from "./config";
import { esc, tt } from "./text";
import { buildChangelogText, checkChangelog } from "./changelog-format";

/**
 * The public changelog (docs/TELEGRAM.md §9): a draft arrives on a secret-protected endpoint, is stored, and goes to the
 * admins' PRIVATE chat with two buttons. Nothing reaches the channel until an admin presses "Publicar" — and only an
 * admin's press counts (the id in the callback is checked against TELEGRAM_ADMIN_IDS).
 *
 * The format is fixed and in English; the content rules are enforced here as well as by whoever writes the draft: no
 * security detail, no wallet address, no variable / secret / file / infrastructure name, nothing only admins or the
 * access list can see, no promise about the future.
 */

export * from "./changelog-format";

export const CB_PUBLISH = "clp_";
export const CB_DISCARD = "cld_";

/** Constant-time comparison with CHANGELOG_PUBLISH_SECRET. No secret configured → never. */
export function changelogSecretMatches(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

export type DraftResult = { ok: true; id: string; text: string; sentTo: number } | { ok: false; status: number; error: string; problems?: string[] };

/** Stores the draft and sends it to every admin in private, with the two buttons. Nothing is published here. */
export async function receiveDraft(d: { db: Db; now: () => number; cfg: TelegramConfig }, input: unknown): Promise<DraftResult> {
  if (!d.cfg.changelogEnabled) return { ok: false, status: 404, error: "Not found." };
  if (!d.cfg.enabled || !d.cfg.hasToken) return { ok: false, status: 503, error: "The Telegram bot isn't switched on." };
  if (d.cfg.adminIds.size === 0) return { ok: false, status: 503, error: "No Telegram admin is configured to approve it." };
  if (!d.cfg.channelId) return { ok: false, status: 503, error: "The channel isn't configured." };
  const checked = checkChangelog(input);
  if (!checked.ok) return { ok: false, status: 422, error: "This draft can't be published as written.", problems: checked.problems };
  const now = d.now();
  const text = buildChangelogText(checked.sections, now);
  const id = randomBytes(8).toString("hex");
  await tgInsertChangelog(d.db, { id, text, now });
  for (const admin of d.cfg.adminIds) {
    await tgEnqueue(
      d.db,
      {
        chatId: String(admin),
        method: "sendMessage",
        payload: {
          parse_mode: "HTML",
          text: `<b>📝 Changelog draft</b> — not published yet.\n\n${esc(text)}`,
          reply_markup: { inline_keyboard: [[{ text: "✅ Publicar", callback_data: `${CB_PUBLISH}${id}` }, { text: "❌ Descartar", callback_data: `${CB_DISCARD}${id}` }]] },
        },
        dedupeKey: `changelog-draft:${id}:${admin}`,
      },
      now
    );
  }
  return { ok: true, id, text, sentTo: d.cfg.adminIds.size };
}

export const isChangelogCallback = (data: string) => data.startsWith(CB_PUBLISH) || data.startsWith(CB_DISCARD);

export type CallbackOutcome = "not_admin" | "off" | "unknown" | "already" | "published" | "discarded";

/**
 * A press of "✅ Publicar" / "❌ Descartar". Only a configured admin's press does anything; a draft is decided ONCE
 * (the status change is atomic), so two admins — or two taps — can never publish it twice.
 */
export async function handleChangelogCallback(
  d: { db: Db; now: () => number; cfg: TelegramConfig; audit: (action: string, object: string, data?: Record<string, unknown>) => Promise<void> },
  p: { data: string; fromId: number; chatId: number }
): Promise<{ outcome: CallbackOutcome; toast: string }> {
  if (!d.cfg.adminIds.has(p.fromId)) return { outcome: "not_admin", toast: "Only a PANDA admin can do this." };
  if (!d.cfg.changelogEnabled) return { outcome: "off", toast: "The changelog is switched off." };
  const publish = p.data.startsWith(CB_PUBLISH);
  const id = p.data.slice(publish ? CB_PUBLISH.length : CB_DISCARD.length);
  if (!/^[a-f0-9]{16}$/.test(id)) return { outcome: "unknown", toast: "Unknown draft." };
  const now = d.now();
  const reply = (text: string) => tgEnqueue(d.db, { chatId: String(p.chatId), method: "sendMessage", payload: { text } }, now);
  if (publish && !d.cfg.channelId) {
    await reply("The channel isn't configured, so nothing was published.");
    return { outcome: "off", toast: "The channel isn't configured." };
  }
  const row = await tgDecideChangelog(d.db, id, publish ? "published" : "discarded", p.fromId, now);
  if (!row) {
    const existing = await tgGetChangelog(d.db, id);
    const toast = !existing ? "Unknown draft." : existing.status === "published" ? "Already published." : "Already discarded.";
    return { outcome: existing ? "already" : "unknown", toast };
  }
  if (publish) {
    const markup = d.cfg.groupUrl ? { reply_markup: { inline_keyboard: [[{ text: tt("en", "btnDiscuss"), url: d.cfg.groupUrl }]] } } : {};
    await tgEnqueue(d.db, { chatId: d.cfg.channelId!, method: "sendMessage", payload: { text: esc(row.text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }, dedupeKey: `changelog:${id}` }, now);
    await reply("✅ Published to the channel.");
  } else {
    await reply("❌ Discarded. Nothing was published.");
  }
  await d.audit(publish ? "telegram.changelog.publish" : "telegram.changelog.discard", id, { by: p.fromId });
  return { outcome: publish ? "published" : "discarded", toast: publish ? "Published ✅" : "Discarded" };
}
