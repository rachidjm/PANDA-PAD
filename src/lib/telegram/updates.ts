import type { Incoming } from "./commands";
import { langOf } from "./text";

/**
 * Turns what Telegram POSTs into what the bot handles — or null. Nothing is trusted: every field is type-checked and sized.
 * Only `message` and `callback_query` updates are handled (the bot is registered for those alone — see admin "register webhook").
 */

export const MAX_BODY_BYTES = 64 * 1024;
const CHAT_TYPES = new Set(["private", "group", "supergroup", "channel"]);

const int = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === "number" && Number.isSafeInteger(v) && Math.abs(v) <= max;

export type ParsedUpdate =
  | { kind: "message"; updateId: number; message: Incoming }
  /** An admin forwarded a channel's post to the bot in private: answer with that channel's id (/chatid can't be typed in a channel). */
  | { kind: "forwarded_channel"; updateId: number; message: Incoming; channelId: number; channelTitle?: string }
  /** A press of one of the bot's own inline buttons (callback_data is ours: short, fixed strings). */
  | { kind: "callback"; updateId: number; callbackId: string; data: string; message: Incoming }
  | { kind: "ignored"; updateId: number }
  | { kind: "invalid" };

export function parseUpdate(raw: unknown): ParsedUpdate {
  if (!raw || typeof raw !== "object") return { kind: "invalid" };
  const u = raw as Record<string, unknown>;
  if (!int(u.update_id) || u.update_id < 0) return { kind: "invalid" };
  const updateId = u.update_id;
  const cb = u.callback_query as Record<string, unknown> | undefined;
  if (cb && typeof cb === "object") {
    const from = cb.from as Record<string, unknown> | undefined;
    const chat = (cb.message as Record<string, unknown> | undefined)?.chat as Record<string, unknown> | undefined;
    const cmsg = cb.message as Record<string, unknown> | undefined;
    if (typeof cb.id !== "string" || cb.id.length > 64 || typeof cb.data !== "string" || !/^[a-z0-9_]{1,40}$/.test(cb.data)) return { kind: "ignored", updateId };
    if (!from || !int(from.id) || from.id <= 0 || from.is_bot === true) return { kind: "ignored", updateId };
    if (!chat || !int(chat.id) || typeof chat.type !== "string" || !CHAT_TYPES.has(chat.type)) return { kind: "ignored", updateId };
    const threadId = cmsg && int(cmsg.message_thread_id) && cmsg.message_thread_id > 0 && cmsg.is_topic_message === true ? cmsg.message_thread_id : undefined;
    return { kind: "callback", updateId, callbackId: cb.id, data: cb.data, message: { chatId: chat.id, chatType: chat.type as Incoming["chatType"], threadId, fromId: from.id, lang: langOf(from.language_code), text: "", messageId: cmsg && int(cmsg.message_id) ? cmsg.message_id : undefined } };
  }
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
    messageId: int(msg.message_id) ? msg.message_id : undefined,
    replyToMessageId: msg.reply_to_message && typeof msg.reply_to_message === "object" && int((msg.reply_to_message as Record<string, unknown>).message_id) ? ((msg.reply_to_message as Record<string, unknown>).message_id as number) : undefined,
  };

  const origin = msg.forward_origin as Record<string, unknown> | undefined;
  const fchat = origin?.chat as Record<string, unknown> | undefined;
  if (chat.type === "private" && origin?.type === "channel" && fchat && int(fchat.id)) {
    return { kind: "forwarded_channel", updateId, message: base, channelId: fchat.id, channelTitle: typeof fchat.title === "string" ? fchat.title.slice(0, 128) : undefined };
  }

  if (typeof msg.text !== "string" || msg.text.length === 0 || msg.text.length > 4096) return { kind: "ignored", updateId };
  return { kind: "message", updateId, message: { ...base, text: msg.text } };
}
