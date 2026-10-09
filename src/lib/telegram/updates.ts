import type { Incoming } from "./commands";
import { langOf } from "./text";

/**
 * Turns what Telegram POSTs into what the bot handles — or null. Nothing is trusted: every field is type-checked and sized.
 * Only `message` updates are handled (the bot is registered for those alone — see admin "register webhook").
 */

export const MAX_BODY_BYTES = 64 * 1024;
const CHAT_TYPES = new Set(["private", "group", "supergroup", "channel"]);

const int = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= max;

export type ParsedUpdate =
  | { kind: "message"; updateId: number; message: Incoming }
  /** An admin forwarded a channel's post to the bot in private: answer with that channel's id (/chatid can't be typed in a channel). */
  | { kind: "forwarded_channel"; updateId: number; message: Incoming; channelId: number; channelTitle?: string }
  | { kind: "ignored"; updateId: number }
  | { kind: "invalid" };

export function parseUpdate(raw: unknown): ParsedUpdate {
  if (!raw || typeof raw !== "object") return { kind: "invalid" };
  const u = raw as Record<string, unknown>;
  if (!int(u.update_id) || u.update_id < 0) return { kind: "invalid" };
  const updateId = u.update_id;
  const msg = u.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== "object") return { kind: "ignored", updateId };

  const chat = msg.chat as Record<string, unknown> | undefined;
  const from = msg.from as Record<string, unknown> | undefined;
  if (!chat || !int(chat.id) || typeof chat.type !== "string" || !CHAT_TYPES.has(chat.type)) return { kind: "ignored", updateId };
  if (!from || !int(from.id) || from.id <= 0 || from.is_bot === true) return { kind: "ignored", updateId };
  const threadId = int(msg.message_thread_id) && msg.message_thread_id > 0 && msg.is_topic_message === true ? msg.message_thread_id : undefined;
  const base: Incoming = {
    chatId: chat.id,
    chatType: chat.type as Incoming["chatType"],
    chatTitle: typeof chat.title === "string" ? chat.title.slice(0, 128) : undefined,
    threadId,
    fromId: from.id,
    lang: langOf(from.language_code),
    text: "",
  };

  const origin = msg.forward_origin as Record<string, unknown> | undefined;
  const fchat = origin?.chat as Record<string, unknown> | undefined;
  if (chat.type === "private" && origin?.type === "channel" && fchat && int(fchat.id)) {
    return { kind: "forwarded_channel", updateId, message: base, channelId: fchat.id, channelTitle: typeof fchat.title === "string" ? fchat.title.slice(0, 128) : undefined };
  }

  if (typeof msg.text !== "string" || msg.text.length === 0 || msg.text.length > 4096) return { kind: "ignored", updateId };
  return { kind: "message", updateId, message: { ...base, text: msg.text } };
}
