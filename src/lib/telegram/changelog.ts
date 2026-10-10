import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db/client";
import { tgDecideChangelog, tgDeleteState, tgEnqueue, tgGetChangelog, tgGetState, tgInsertChangelog, tgSetChangelogVersions, tgSetState, type ChangelogRow, type DraftVersion } from "@/lib/db/telegram";
import type { TelegramConfig } from "./config";
import { esc, tt } from "./text";
import { buildChangelogText, buildExplanationText, checkChangelog, checkDraft, parseChangelogMarkdown } from "./changelog-format";

/**
 * Drafts that need an admin's approval before they are published (docs/TELEGRAM.md §9). Today: the public changelog, to
 * the channel. The flow is the same for any kind of draft (`kind`): it arrives on a secret-protected endpoint with THREE
 * versions, each with an explanation in plain Spanish (not a translation), and goes to the admins' PRIVATE chat as one message they can flip through:
 *
 *   Versión 2/3 · the English text · (in italics) "🇪🇸 Qué dice (no se publica)" + a plain-Spanish explanation
 *   [1] [• 2 •] [3] [🔄]   [✏️ Editar]   [✅ Publicar] [❌ Descartar]
 *
 * Only an admin's press counts (the id in the callback is checked against TELEGRAM_ADMIN_IDS). "Publicar" publishes the
 * version THAT message is showing — its English text only; the Spanish explanation never leaves the private chat. A draft is
 * decided once. The format is fixed and the content rules (changelog-format.ts) apply to every version, including the
 * admin's own ("✏️ Editar").
 */

export * from "./changelog-format";

export const CB_PUBLISH = "clp_";
export const CB_DISCARD = "cld_";
export const CB_VERSION = "clv_";
export const CB_EDIT = "cle_";
const PREFIXES = [CB_PUBLISH, CB_DISCARD, CB_VERSION, CB_EDIT];
/** How long "✏️ Editar" waits for the admin's text. */
export const EDIT_TTL_MS = 30 * 60_000;
const editKey = (adminId: number) => `draft-edit:${adminId}`;
type EditState = { id: string; chatId: number; messageId: number | null; at: number };

/** Constant-time comparison with CHANGELOG_PUBLISH_SECRET. No secret configured → never. */
export function changelogSecretMatches(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const versionName = (versions: DraftVersion[], k: number) => (versions[k]?.mine ? `${k + 1} · mía` : String(k + 1));

/** The approval message for version `k`: what would be published, then — apart and in italics — what it says, in Spanish. */
export function approvalMessage(row: Pick<ChangelogRow, "id" | "versions">, k: number): Record<string, unknown> {
  const versions = row.versions;
  const shown = versions[k] ? k : 0;
  const v = versions[shown];
  const head = v.mine ? `Versión ${shown + 1} · mía` : `Versión ${shown + 1}/${versions.filter((x) => !x.mine).length}`;
  const translation = v.es ? `\n\n———\n<i>🇪🇸 Qué dice (no se publica)</i>\n\n<i>${esc(v.es)}</i>` : "";
  const pick = versions.map((_, n) => ({ text: n === shown ? `• ${versionName(versions, n)} •` : versionName(versions, n), callback_data: `${CB_VERSION}${row.id}_${n}` }));
  return {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    text: `<b>📝 Borrador</b> · ${head}\n\n${esc(v.en)}${translation}`,
    reply_markup: {
      inline_keyboard: [
        [...pick, { text: "🔄", callback_data: `${CB_VERSION}${row.id}_${(shown + 1) % versions.length}` }],
        [{ text: "✏️ Editar", callback_data: `${CB_EDIT}${row.id}` }],
        [{ text: "✅ Publicar", callback_data: `${CB_PUBLISH}${row.id}_${shown}` }, { text: "❌ Descartar", callback_data: `${CB_DISCARD}${row.id}` }],
      ],
    },
  };
}

export type DraftResult = { ok: true; id: string; versions: DraftVersion[]; sentTo: number } | { ok: false; status: number; error: string; problems?: string[] };

/** Stores the draft (its three versions) and sends it to every admin in private. Nothing is published here. */
export async function receiveDraft(d: { db: Db; now: () => number; cfg: TelegramConfig }, input: unknown, kind = "changelog"): Promise<DraftResult> {
  if (!d.cfg.changelogEnabled) return { ok: false, status: 404, error: "Not found." };
  if (!d.cfg.enabled || !d.cfg.hasToken) return { ok: false, status: 503, error: "The Telegram bot isn't switched on." };
  if (d.cfg.adminIds.size === 0) return { ok: false, status: 503, error: "No Telegram admin is configured to approve it." };
  if (!d.cfg.channelId) return { ok: false, status: 503, error: "The channel isn't configured." };
  const checked = checkDraft(input);
  if (!checked.ok) return { ok: false, status: 422, error: "This draft can't be published as written.", problems: checked.problems };
  const now = d.now();
  const versions: DraftVersion[] = checked.versions.map((v) => ({ en: buildChangelogText(v.sections, now), es: buildExplanationText(v.es, v.tone) }));
  const id = randomBytes(8).toString("hex");
  await tgInsertChangelog(d.db, { id, kind, versions, now });
  for (const admin of d.cfg.adminIds) {
    await tgEnqueue(d.db, { chatId: String(admin), method: "sendMessage", payload: approvalMessage({ id, versions }, 0), dedupeKey: `changelog-draft:${id}:${admin}` }, now);
  }
  return { ok: true, id, versions, sentTo: d.cfg.adminIds.size };
}

export const isChangelogCallback = (data: string) => PREFIXES.some((p) => data.startsWith(p));

export type CallbackOutcome = "not_admin" | "off" | "unknown" | "already" | "published" | "discarded" | "switched" | "edit_asked";
type ApprovalDeps = {
  db: Db;
  now: () => number;
  cfg: TelegramConfig;
  audit: (action: string, object: string, data?: Record<string, unknown>) => Promise<void>;
  editMessage?: (chatId: number, messageId: number, payload: Record<string, unknown>) => Promise<void>;
};

/** Where a published draft goes, by kind. A kind with no publisher yet can be reviewed but not published. */
function publishMessage(cfg: TelegramConfig, row: ChangelogRow, text: string, id: string) {
  if (row.kind !== "changelog" || !cfg.channelId) return null;
  const markup = cfg.groupUrl ? { reply_markup: { inline_keyboard: [[{ text: tt("en", "btnDiscuss"), url: cfg.groupUrl }]] } } : {};
  return { chatId: cfg.channelId, method: "sendMessage" as const, payload: { text: esc(text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }, dedupeKey: `changelog:${id}` };
}

/**
 * A press of one of the draft's buttons. Only a configured admin's press does anything. Switching version rewrites the
 * same message; "Publicar" publishes the version that message shows, once (the status change is atomic).
 */
export async function handleChangelogCallback(d: ApprovalDeps, p: { data: string; fromId: number; chatId: number; messageId?: number }): Promise<{ outcome: CallbackOutcome; toast: string }> {
  if (!d.cfg.adminIds.has(p.fromId)) return { outcome: "not_admin", toast: "Solo un admin de PANDA puede hacer esto." };
  if (!d.cfg.changelogEnabled) return { outcome: "off", toast: "El changelog está apagado." };
  const prefix = PREFIXES.find((x) => p.data.startsWith(x))!;
  const m = /^([a-f0-9]{16})(?:_(\d))?$/.exec(p.data.slice(prefix.length));
  if (!m) return { outcome: "unknown", toast: "Borrador desconocido." };
  const id = m[1];
  const now = d.now();
  const reply = (text: string, extra: Record<string, unknown> = {}) => tgEnqueue(d.db, { chatId: String(p.chatId), method: "sendMessage", payload: { text, ...extra } }, now);
  const edit = async (payload: Record<string, unknown>) => {
    if (d.editMessage && p.messageId !== undefined) await d.editMessage(p.chatId, p.messageId, payload).catch(() => undefined); // "message is not modified" and the like
  };
  const row = await tgGetChangelog(d.db, id);
  if (!row) return { outcome: "unknown", toast: "Borrador desconocido." };
  const decided = (status: string) => ({ outcome: "already" as const, toast: status === "published" ? "Ya está publicado." : "Ya está descartado." });
  if (row.status !== "pending") return decided(row.status);
  if (row.versions.length === 0) row.versions = [{ en: row.text, es: null }]; // a draft from before versions existed
  const k = m[2] === undefined ? 0 : Number(m[2]);

  if (prefix === CB_VERSION) {
    if (!row.versions[k]) return { outcome: "unknown", toast: "Esa versión no existe." };
    await edit(approvalMessage(row, k));
    return { outcome: "switched", toast: `Versión ${versionName(row.versions, k)}` };
  }

  if (prefix === CB_EDIT) {
    await tgSetState(d.db, editKey(p.fromId), { id, chatId: p.chatId, messageId: p.messageId ?? null, at: now } satisfies EditState, now);
    await reply("✏️ Responde a este mensaje con tu texto. Mismo formato: las secciones «✨ New», «🔧 Improved» y «🐛 Fixed» (solo las que uses) y debajo sus líneas empezando por «- ». Se añadirá como versión «mía».", { reply_markup: { force_reply: true, input_field_placeholder: "✨ New …" } });
    return { outcome: "edit_asked", toast: "Responde con tu texto" };
  }

  if (prefix === CB_DISCARD) {
    if (!(await tgDecideChangelog(d.db, id, "discarded", p.fromId, now))) return decided((await tgGetChangelog(d.db, id))?.status ?? "discarded");
    await edit({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, text: `<b>❌ Descartado</b> — no se ha publicado nada.\n\n${esc(row.versions[0]?.en ?? row.text)}` });
    await reply("❌ Descartado. No se ha publicado nada.");
    await d.audit("telegram.changelog.discard", id, { by: p.fromId });
    return { outcome: "discarded", toast: "Descartado" };
  }

  // Publish: the version this message is showing — its English text, nothing else.
  const version = row.versions[k];
  if (!version) return { outcome: "unknown", toast: "Esa versión no existe." };
  const out = publishMessage(d.cfg, row, version.en, id);
  if (!out) {
    await reply("No hay dónde publicarlo (el canal no está configurado), así que no se ha publicado nada.");
    return { outcome: "off", toast: "No hay dónde publicarlo." };
  }
  if (!(await tgDecideChangelog(d.db, id, "published", p.fromId, now, { version: k, text: version.en }))) return decided((await tgGetChangelog(d.db, id))?.status ?? "published");
  await tgEnqueue(d.db, out, now);
  await edit({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, text: `<b>✅ Publicado</b> · versión ${versionName(row.versions, k)}\n\n${esc(version.en)}` });
  await reply(`✅ Publicada la versión ${versionName(row.versions, k)} en el canal.`);
  await d.audit("telegram.changelog.publish", id, { by: p.fromId, version: k + 1 });
  return { outcome: "published", toast: "Publicado ✅" };
}

/**
 * The admin's answer to "✏️ Editar": their own text, checked with the same rules as every version. If it passes it becomes
 * the version "mía" (replacing an earlier one of theirs) and the approval message switches to it; if not, the bot says
 * what is wrong and keeps waiting. Returns false when this message isn't such an answer (it is then handled as usual).
 */
export async function handleDraftEditReply(d: ApprovalDeps, msg: { chatId: number; chatType: string; fromId: number; text: string; replyToMessageId?: number }): Promise<boolean> {
  if (msg.chatType !== "private" || msg.replyToMessageId === undefined || !d.cfg.adminIds.has(msg.fromId) || !d.cfg.changelogEnabled || msg.text.startsWith("/")) return false;
  const now = d.now();
  const state = await tgGetState<EditState>(d.db, editKey(msg.fromId));
  if (!state || now - state.at > EDIT_TTL_MS) return false;
  const say = (text: string) => tgEnqueue(d.db, { chatId: String(msg.chatId), method: "sendMessage", payload: { text } }, now);
  const row = await tgGetChangelog(d.db, state.id);
  if (!row || row.status !== "pending") {
    await tgDeleteState(d.db, editKey(msg.fromId));
    await say("Ese borrador ya está decidido, así que no se puede editar.");
    return true;
  }
  if (row.versions.length === 0) row.versions = [{ en: row.text, es: null }];
  const checked = checkChangelog(parseChangelogMarkdown(msg.text));
  if (!checked.ok) {
    const none = checked.problems.length === 1 && /Nothing to publish/.test(checked.problems[0]);
    await say(
      none
        ? "No he encontrado ninguna sección. Escribe «✨ New», «🔧 Improved» o «🐛 Fixed» y debajo sus líneas empezando por «- ». Responde otra vez al mensaje anterior."
        : `No se puede usar ese texto:\n${checked.problems.map((x) => `• ${x}`).join("\n")}\n\nCorrígelo y responde otra vez al mensaje anterior.`
    );
    return true;
  }
  const versions: DraftVersion[] = [...row.versions.filter((v) => !v.mine), { en: buildChangelogText(checked.sections, row.createdAt), es: null, mine: true }];
  if (!(await tgSetChangelogVersions(d.db, row.id, versions))) {
    await say("Ese borrador ya está decidido, así que no se puede editar.");
    return true;
  }
  await tgDeleteState(d.db, editKey(msg.fromId));
  const k = versions.length - 1;
  const message = approvalMessage({ id: row.id, versions }, k);
  if (d.editMessage && state.messageId !== null) await d.editMessage(state.chatId, state.messageId, message).catch(() => undefined);
  else await tgEnqueue(d.db, { chatId: String(msg.chatId), method: "sendMessage", payload: message }, now);
  await say(`Añadida como versión «${k + 1} · mía». Ya se ve en el mensaje del borrador: pulsa «✅ Publicar» ahí si es la que quieres.`);
  await d.audit("telegram.changelog.edit", row.id, { by: msg.fromId });
  return true;
}
