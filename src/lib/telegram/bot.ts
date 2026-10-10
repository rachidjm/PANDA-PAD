import { timingSafeEqual } from "node:crypto";
import { tgClaimUpdate, tgEnqueue } from "@/lib/db/telegram";
import { CALLBACK_HELP, handleMessage, showHelp, type BotDeps } from "./commands";
import { parseUpdate } from "./updates";
import { handleChangelogCallback, handleDraftEditReply, isChangelogCallback } from "./changelog";
import { esc, tt } from "./text";

/** True only if the header carries exactly the configured secret (constant-time). No secret configured → never. */
export function secretMatches(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type UpdateOutcome = "invalid" | "duplicate" | "ignored" | "handled";

/** One webhook update: validated, handled at most once (by update_id), replies queued. */
export async function handleUpdate(d: BotDeps, raw: unknown): Promise<UpdateOutcome> {
  const u = parseUpdate(raw);
  if (u.kind === "invalid") return "invalid";
  if (!(await tgClaimUpdate(d.db, u.updateId, d.now()))) return "duplicate";
  if (u.kind === "ignored") return "ignored";
  if (u.kind === "forwarded_channel") {
    // How an admin learns the CHANNEL's id: forward one of its posts to the bot in private.
    if (!d.cfg.adminIds.has(u.message.fromId)) return "ignored";
    await tgEnqueue(
      d.db,
      { chatId: String(u.message.chatId), method: "sendMessage", payload: { parse_mode: "HTML", text: tt(u.message.lang, "chatId", { chatId: u.channelId, type: "channel", title: u.channelTitle ? `\n${esc(u.channelTitle)}` : "", thread: "" }) } },
      d.now()
    );
    return "handled";
  }
  if (u.kind === "callback") {
    if (isChangelogCallback(u.data)) {
      // "✅ Publicar" / "❌ Descartar" on a changelog draft: only an admin's press does anything (changelog.ts).
      const r = await handleChangelogCallback(d, { data: u.data, fromId: u.message.fromId, chatId: u.message.chatId, messageId: u.message.messageId });
      await d.answerCallback?.(u.callbackId, r.toast).catch(() => undefined);
      return r.outcome === "not_admin" || r.outcome === "unknown" || r.outcome === "already" ? "ignored" : "handled";
    }
    // Always acknowledged (Telegram shows a spinner on the button until it is), whatever the button was.
    await d.answerCallback?.(u.callbackId).catch(() => undefined);
    if (u.data !== CALLBACK_HELP) return "ignored";
    await showHelp(d, u.message);
    return "handled";
  }
  // An admin answering "✏️ Editar" with their own text for a draft (changelog.ts) — never treated as a command.
  if (await handleDraftEditReply(d, u.message)) return "handled";
  await handleMessage(d, u.message);
  return "handled";
}
