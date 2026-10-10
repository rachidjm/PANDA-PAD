import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "@/lib/db/client";
import {
  tgDeferredDrafts,
  tgDeleteState,
  tgEnqueue,
  tgGetChangelog,
  tgGetState,
  tgInsertChangelog,
  tgMoveChangelog,
  tgPublishedOnX,
  tgSetChangelogMeta,
  tgSetChangelogVersions,
  tgSetState,
  type ChangelogRow,
  type DraftVersion,
} from "@/lib/db/telegram";
import type { TelegramConfig } from "./config";
import { esc, tt } from "./text";
import { buildChangelogText, buildExplanationText, checkChangelog, checkDraft, checkSummary, ES_LABEL, MAX_ITEMS, parseChangelogMarkdown, SECTIONS, VERSIONS, type DraftInput, type Level } from "./changelog-format";
import { digestProblem, weeklyXVersions, xCostUsd, xFinalLength, xFinalText, xFingerprint, xTextProblem, X_MAX } from "@/lib/x/text";
import { httpsUrl, type XDeps } from "@/lib/x/client";

/**
 * Drafts that need an admin's approval before they are published (docs/TELEGRAM.md §9 and §10): the public changelog, to
 * the Telegram channel, and posts on X (@LaunchOnPanda). An update arrives on a secret-protected endpoint with THREE
 * versions for each place, and each place gets its OWN message in the admins' private chat:
 *
 *   📢 TELEGRAM · Borrador · Versión 2/3          🐦 X · Borrador · Versión 1/3
 *   the changelog (New / Improved / Fixed)        the post (a short note, not a list)
 *   🇪🇸 En resumen: one or two easy sentences     🇪🇸 En resumen: …   ·  143/280 · coste aprox.
 *   [1][• 2 •][3][🔄] [✏️ Editar]                 [1][2][3][🔄] [✏️ Editar] [🖼 Imagen][🔗 Enlace]
 *   [✅ Publicar][❌ Descartar]                    [⏳ Al resumen semanal] [✅ Publicar en X][❌ Descartar]
 *
 * Only an admin's press counts (the id in the callback is checked against TELEGRAM_ADMIN_IDS). "Publicar" publishes the
 * version THAT message is showing — its English text only; the Spanish summary never leaves the private chat. A draft is
 * decided once. A SMALL update gets no draft of its own: it waits for Monday's weekly summary, which is again one draft
 * for each place. The content rules apply to every version, including the admin's own ("✏️ Editar").
 */

export * from "./changelog-format";

export const CB_PUBLISH = "clp_";
export const CB_DISCARD = "cld_";
export const CB_VERSION = "clv_";
export const CB_EDIT = "cle_";
export const CB_IMAGE = "cli_";
export const CB_LINK = "cll_";
export const CB_WEEKLY = "clw_";
const PREFIXES = [CB_PUBLISH, CB_DISCARD, CB_VERSION, CB_EDIT, CB_IMAGE, CB_LINK, CB_WEEKLY];
/** How long "✏️ Editar" waits for the admin's text. */
export const EDIT_TTL_MS = 30 * 60_000;
const editKey = (adminId: number) => `draft-edit:${adminId}`;
type EditState = { id: string; chatId: number; messageId: number | null; at: number };

export const LABEL = { changelog: "📢 TELEGRAM · Borrador", x: "🐦 X · Borrador" } as const;
type Kind = keyof typeof LABEL;
const kindOf = (row: Pick<ChangelogRow, "kind">): Kind => (row.kind === "x" ? "x" : "changelog");

/** What a draft carries besides its versions (telegram_changelogs.meta). */
export type DraftMeta = {
  level?: Level;
  digest?: string;
  /** The other draft of the same update (Telegram ↔ X). */
  pair?: string;
  weekly?: boolean;
  x?: { image: boolean; link: boolean; imageUrl: string | null; postId?: string; url?: string };
};
const metaOf = (row: Pick<ChangelogRow, "meta">): DraftMeta => (row.meta && typeof row.meta === "object" ? (row.meta as DraftMeta) : {});

/** Constant-time comparison with CHANGELOG_PUBLISH_SECRET. No secret configured → never. */
export function changelogSecretMatches(header: string | null, secret: string | null): boolean {
  if (!secret || !header) return false;
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const want = Buffer.from(secret);
  return given.length === want.length && timingSafeEqual(given, want);
}

const versionName = (versions: DraftVersion[], k: number) => (versions[k]?.mine ? `${k + 1} · mía` : String(k + 1));
const usd = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} $`;

/** What the approval message needs to know about the deployment: the site's address (the optional link) and the default image. */
export type ApprovalView = { siteUrl: string; defaultImageUrl: string | null };
const imageFor = (meta: DraftMeta, view: ApprovalView) => httpsUrl(meta.x?.imageUrl) ?? view.defaultImageUrl;

/**
 * The approval message for version `k`: the label of the place it is for, what would be published, then — apart and in
 * italics — the Spanish summary. For X also the length, the image/link choices and the approximate cost.
 */
export function approvalMessage(row: Pick<ChangelogRow, "id" | "versions" | "kind" | "meta">, k: number, view: ApprovalView = { siteUrl: "https://launchonpanda.app", defaultImageUrl: null }): Record<string, unknown> {
  const kind = kindOf(row);
  const meta = metaOf(row);
  const versions = row.versions;
  const shown = versions[k] ? k : 0;
  const v = versions[shown];
  const head = `${v.mine ? `Versión ${shown + 1} · mía` : `Versión ${shown + 1}/${versions.filter((x) => !x.mine).length}`}${meta.weekly ? " · resumen semanal" : ""}`;
  const summary = v.es ? `\n\n———\n<i>${ES_LABEL} ${esc(v.es)}</i>` : "";
  const pick = versions.map((_, n) => ({ text: n === shown ? `• ${versionName(versions, n)} •` : versionName(versions, n), callback_data: `${CB_VERSION}${row.id}_${n}` }));
  const top = [[...pick, { text: "🔄", callback_data: `${CB_VERSION}${row.id}_${(shown + 1) % versions.length}` }], [{ text: "✏️ Editar", callback_data: `${CB_EDIT}${row.id}_${shown}` }]];
  const base = { parse_mode: "HTML", link_preview_options: { is_disabled: true } };
  if (kind === "changelog") {
    return {
      ...base,
      text: `<b>${LABEL.changelog}</b> · ${head}\n\n${esc(v.en)}${summary}`,
      reply_markup: { inline_keyboard: [...top, [{ text: "✅ Publicar", callback_data: `${CB_PUBLISH}${row.id}_${shown}` }, { text: "❌ Descartar", callback_data: `${CB_DISCARD}${row.id}` }]] },
    };
  }
  const x = meta.x ?? { image: false, link: false, imageUrl: null };
  const hasImage = !!imageFor(meta, view);
  const image = x.image && hasImage;
  const length = xFinalLength(v.en, x.link);
  const facts = [`${length}/${X_MAX} caracteres`, `imagen: ${image ? "sí" : "no"}`, `enlace: ${x.link ? "sí" : "no"}`, `coste aprox.: ${usd(xCostUsd(x.link))}${image ? " + subir la imagen" : ""}`].join(" · ");
  return {
    ...base,
    text: `<b>${LABEL.x}</b> · ${head}\n\n${esc(xFinalText(v.en, x.link ? view.siteUrl : null))}${summary}\n\n<i>${facts}</i>`,
    reply_markup: {
      inline_keyboard: [
        ...top,
        [
          { text: `🖼 Imagen: ${image ? "sí" : "no"}`, callback_data: `${CB_IMAGE}${row.id}_${shown}` },
          { text: `🔗 Enlace: ${x.link ? "sí" : "no"}`, callback_data: `${CB_LINK}${row.id}_${shown}` },
        ],
        ...(meta.weekly ? [] : [[{ text: "⏳ Al resumen semanal", callback_data: `${CB_WEEKLY}${row.id}` }]]),
        [{ text: "✅ Publicar en X", callback_data: `${CB_PUBLISH}${row.id}_${shown}` }, { text: "❌ Descartar", callback_data: `${CB_DISCARD}${row.id}` }],
      ],
    },
  };
}

export type DraftResult =
  | { ok: true; id: string; xId: string | null; deferred: boolean; versions: DraftVersion[]; xVersions: DraftVersion[]; sentTo: number }
  | { ok: false; status: number; error: string; problems?: string[] };
type DraftDeps = { db: Db; now: () => number; cfg: TelegramConfig; x?: Pick<XDeps, "config"> };
const viewOf = (d: { cfg: TelegramConfig; x?: Pick<XDeps, "config"> }): ApprovalView => ({ siteUrl: d.cfg.siteUrl, defaultImageUrl: d.x?.config.defaultImageUrl ?? null });
const newId = () => randomBytes(8).toString("hex");

/** The three versions for X: each a post within the rules, with its summary, and really different. */
function checkXVersions(raw: unknown): { ok: true; versions: DraftVersion[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(raw) || raw.length !== VERSIONS) return { ok: false, problems: [`X: a draft needs exactly ${VERSIONS} versions for X (got ${Array.isArray(raw) ? raw.length : 0}).`] };
  const problems: string[] = [];
  const versions: DraftVersion[] = [];
  raw.forEach((v, k) => {
    const text = typeof v?.text === "string" ? v.text.trim() : "";
    const why = xTextProblem(text);
    if (why) return problems.push(`X version ${k + 1}: can't be published — it contains ${why}.`);
    const es = checkSummary(v?.es);
    if (!es.ok) return problems.push(...es.problems.map((p) => `X version ${k + 1} · ${p}`));
    versions.push({ en: text, es: buildExplanationText(es.value.summary, es.value.tone) });
  });
  if (!problems.length && new Set(versions.map((v) => xFingerprint(v.en))).size !== versions.length) problems.push("X: two versions are the same — each one must be worded differently.");
  return problems.length ? { ok: false, problems } : { ok: true, versions };
}

async function sendDraft(d: DraftDeps, row: Pick<ChangelogRow, "id" | "versions" | "kind" | "meta">, now: number): Promise<void> {
  for (const admin of d.cfg.adminIds) {
    await tgEnqueue(d.db, { chatId: String(admin), method: "sendMessage", payload: approvalMessage(row, 0, viewOf(d)), dedupeKey: `changelog-draft:${row.id}:${admin}` }, now);
  }
}

/**
 * Stores an update's drafts — one for Telegram, one for X — and sends each to every admin in private, as two separate
 * messages. A SMALL update is only stored: it waits for the weekly summary. Nothing is published here.
 */
export async function receiveDraft(d: DraftDeps, input: unknown): Promise<DraftResult> {
  if (!d.cfg.changelogEnabled) return { ok: false, status: 404, error: "Not found." };
  if (!d.cfg.enabled || !d.cfg.hasToken) return { ok: false, status: 503, error: "The Telegram bot isn't switched on." };
  if (d.cfg.adminIds.size === 0) return { ok: false, status: 503, error: "No Telegram admin is configured to approve it." };
  if (!d.cfg.channelId) return { ok: false, status: 503, error: "The channel isn't configured." };
  const o = (input && typeof input === "object" ? input : {}) as DraftInput;
  const level: Level = o.level === "small" ? "small" : "important";
  const problems: string[] = [];
  const checked = checkDraft(input);
  if (!checked.ok) problems.push(...checked.problems);
  const digestWhy = digestProblem(o.digest);
  if (digestWhy) problems.push(`Digest (the one-line summary for the weekly post): ${digestWhy}.`);
  // X: an important update brings its three posts. A small one is told on X only through its one-line summary.
  const x = level === "important" || o.x !== undefined ? checkXVersions(o.x) : null;
  if (x && !x.ok) problems.push(...x.problems);
  const imageUrl = o.imageUrl === undefined || o.imageUrl === null || o.imageUrl === "" ? null : httpsUrl(o.imageUrl);
  if (o.imageUrl && !imageUrl) problems.push("Image: it must be an https link.");
  if (problems.length || !checked.ok) return { ok: false, status: 422, error: "This draft can't be published as written.", problems };

  const now = d.now();
  const versions: DraftVersion[] = checked.versions.map((v) => ({ en: buildChangelogText(v.sections, now), es: buildExplanationText(v.summary, v.tone) }));
  const xVersions = x && x.ok ? x.versions : [];
  const id = newId();
  const xId = xVersions.length ? newId() : null;
  const digest = o.digest!.trim();
  const status = level === "small" ? "deferred" : "pending";
  const tgRow = { id, kind: "changelog", versions, meta: { level, digest, ...(xId ? { pair: xId } : {}) } satisfies DraftMeta };
  await tgInsertChangelog(d.db, { ...tgRow, now, status });
  // The image is on by default only when the update brings its own.
  const xRow = xId ? { id: xId, kind: "x", versions: xVersions, meta: { level, digest, pair: id, x: { image: !!imageUrl, link: false, imageUrl } } satisfies DraftMeta } : null;
  if (xRow) await tgInsertChangelog(d.db, { ...xRow, now, status });

  if (level === "small") {
    const waiting = (await tgDeferredDrafts(d.db)).filter((r) => r.kind === "changelog").length;
    for (const admin of d.cfg.adminIds) {
      await tgEnqueue(d.db, { chatId: String(admin), method: "sendMessage", payload: { text: `🗂 Actualización pequeña guardada para el resumen semanal del lunes (${waiting} en espera). No se publica nada ahora.\n\n«${digest}»` }, dedupeKey: `changelog-small:${id}:${admin}` }, now);
    }
  } else {
    await sendDraft(d, tgRow, now);
    if (xRow) await sendDraft(d, xRow, now);
  }
  return { ok: true, id, xId, deferred: level === "small", versions, xVersions, sentTo: d.cfg.adminIds.size };
}

// ── the weekly summary ──────────────────────────────────────────────────────────────────────────────────────────────

const WEEKLY_HOUR_UTC = 8;
/** Monday (UTC), from 08:00: the day the week's small updates become one draft for each place. Its date, or null. */
export function weeklyDue(now: number): string | null {
  const d = new Date(now);
  return d.getUTCDay() === 1 && d.getUTCHours() >= WEEKLY_HOUR_UTC ? d.toISOString().slice(0, 10) : null;
}

/** The Telegram side of a weekly summary: version k is every waiting update's version k, section by section. */
function weeklyTelegramVersions(rows: ChangelogRow[], now: number): DraftVersion[] {
  const n = rows.length;
  const summary = n === 1 ? "Es el resumen de la semana: cuenta la única novedad pequeña que estaba guardada." : `Es el resumen de la semana: junta en un solo mensaje las ${n} novedades pequeñas que estaban guardadas.`;
  const out: DraftVersion[] = [];
  for (let k = 0; k < VERSIONS; k++) {
    const merged: Record<string, string[]> = {};
    for (const row of rows) {
      const parsed = parseChangelogMarkdown((row.versions[k] ?? row.versions[0])?.en ?? "");
      for (const s of SECTIONS) for (const item of parsed[s.key] ?? []) if (!(merged[s.key] ??= []).includes(item)) merged[s.key].push(item);
    }
    const sections = SECTIONS.filter((s) => merged[s.key]?.length).map((s) => ({ title: s.title, items: merged[s.key].slice(0, MAX_ITEMS) }));
    if (sections.length) out.push({ en: buildChangelogText(sections, now), es: summary });
  }
  return out;
}

/**
 * The week's small updates (and the posts for X an admin sent "al resumen semanal") become ONE draft for Telegram and
 * ONE for X, sent to the admins like any other. What went into them is marked so it is never summarised twice. An
 * empty week sends nothing.
 */
export async function buildWeeklyDrafts(d: DraftDeps): Promise<{ telegram: string | null; x: string | null; items: number }> {
  const waiting = await tgDeferredDrafts(d.db);
  if (waiting.length === 0) return { telegram: null, x: null, items: 0 };
  const now = d.now();
  const tgRows = waiting.filter((r) => r.kind === "changelog");
  const digests = [...new Set(waiting.map((r) => metaOf(r).digest?.trim()).filter((x): x is string => !!x))];
  let telegram: string | null = null;
  let x: string | null = null;

  const tgVersions = tgRows.length ? weeklyTelegramVersions(tgRows, now) : [];
  if (tgVersions.length) {
    telegram = newId();
    const row = { id: telegram, kind: "changelog", versions: tgVersions, meta: { weekly: true, level: "small" } satisfies DraftMeta };
    await tgInsertChangelog(d.db, { ...row, now });
    await sendDraft(d, row, now);
  }
  const posts = weeklyXVersions(digests).filter((t) => !xTextProblem(t));
  if (posts.length) {
    x = newId();
    const summary = digests.length === 1 ? "Es el resumen de la semana para X: cuenta en una frase la novedad pequeña que estaba guardada." : `Es el resumen de la semana para X: cuenta en una o dos frases las ${digests.length} novedades pequeñas que estaban guardadas.`;
    const row = { id: x, kind: "x", versions: posts.map((en) => ({ en, es: summary })), meta: { weekly: true, level: "small", ...(telegram ? { pair: telegram } : {}), x: { image: false, link: false, imageUrl: null } } satisfies DraftMeta };
    await tgInsertChangelog(d.db, { ...row, now });
    await sendDraft(d, row, now);
  }
  for (const r of waiting) await tgMoveChangelog(d.db, r.id, ["deferred"], "digested", { now });
  return { telegram, x, items: waiting.length };
}

/** The cron's weekly step: on Monday, once (the date is remembered), build the summary if anything is waiting. */
export async function runWeekly(d: DraftDeps): Promise<string> {
  if (!d.cfg.changelogEnabled || d.cfg.adminIds.size === 0) return "off";
  const day = weeklyDue(d.now());
  if (!day) return "not due";
  const key = "weekly-summary.day";
  if ((await tgGetState<string>(d.db, key)) === day) return "done already";
  const r = await buildWeeklyDrafts(d);
  await tgSetState(d.db, key, day, d.now());
  return r.items === 0 ? "nothing waiting" : `summary of ${r.items}`;
}

// ── the buttons ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const isChangelogCallback = (data: string) => PREFIXES.some((p) => data.startsWith(p));

export type CallbackOutcome = "not_admin" | "off" | "unknown" | "already" | "published" | "discarded" | "switched" | "edit_asked" | "deferred" | "duplicate" | "limit" | "failed";
type ApprovalDeps = DraftDeps & {
  audit: (action: string, object: string, data?: Record<string, unknown>) => Promise<void>;
  editMessage?: (chatId: number, messageId: number, payload: Record<string, unknown>) => Promise<void>;
  x?: XDeps;
};

function channelMessage(cfg: TelegramConfig, text: string, id: string) {
  if (!cfg.channelId) return null;
  const markup = cfg.groupUrl ? { reply_markup: { inline_keyboard: [[{ text: tt("en", "btnDiscuss"), url: cfg.groupUrl }]] } } : {};
  return { chatId: cfg.channelId, method: "sendMessage" as const, payload: { text: esc(text), parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup }, dedupeKey: `changelog:${id}` };
}

const startOfUtcDay = (now: number) => Math.floor(now / 86_400_000) * 86_400_000;
const STATUS_TOAST: Record<string, string> = { published: "Ya está publicado.", discarded: "Ya está descartado.", deferred: "Ya está guardado para el resumen semanal.", digested: "Ya entró en un resumen semanal.", publishing: "Se está publicando ahora mismo.", failed: "Quedó cerrado: revisa X." };

/**
 * A press of one of a draft's buttons. Only a configured admin's press does anything. Switching version or a choice
 * rewrites the same message; "Publicar" publishes the version that message shows, once (the status change is atomic).
 */
export async function handleChangelogCallback(d: ApprovalDeps, p: { data: string; fromId: number; chatId: number; messageId?: number }): Promise<{ outcome: CallbackOutcome; toast: string }> {
  if (!d.cfg.adminIds.has(p.fromId)) return { outcome: "not_admin", toast: "Solo un admin de PANDA puede hacer esto." };
  if (!d.cfg.changelogEnabled) return { outcome: "off", toast: "Los borradores están apagados." };
  const prefix = PREFIXES.find((x) => p.data.startsWith(x))!;
  const m = /^([a-f0-9]{16})(?:_(\d))?$/.exec(p.data.slice(prefix.length));
  if (!m) return { outcome: "unknown", toast: "Borrador desconocido." };
  const id = m[1];
  const now = d.now();
  const reply = (text: string, extra: Record<string, unknown> = {}) => tgEnqueue(d.db, { chatId: String(p.chatId), method: "sendMessage", payload: { text, link_preview_options: { is_disabled: true }, ...extra } }, now);
  const edit = async (payload: Record<string, unknown>) => {
    if (d.editMessage && p.messageId !== undefined) await d.editMessage(p.chatId, p.messageId, payload).catch(() => undefined); // "message is not modified" and the like
  };
  const closed = (title: string, text: string) => edit({ parse_mode: "HTML", link_preview_options: { is_disabled: true }, text: `<b>${title}</b>\n\n${esc(text)}` });
  const row = await tgGetChangelog(d.db, id);
  if (!row) return { outcome: "unknown", toast: "Borrador desconocido." };
  const decided = (status: string) => ({ outcome: "already" as const, toast: STATUS_TOAST[status] ?? "Ya está decidido." });
  if (row.status !== "pending") return decided(row.status);
  if (row.versions.length === 0) row.versions = [{ en: row.text, es: null }]; // a draft from before versions existed
  const kind = kindOf(row);
  const meta = metaOf(row);
  const view = viewOf(d);
  const k = m[2] === undefined ? 0 : Number(m[2]);
  const label = kind === "x" ? "X" : "TELEGRAM";

  if (prefix === CB_VERSION) {
    if (!row.versions[k]) return { outcome: "unknown", toast: "Esa versión no existe." };
    await edit(approvalMessage(row, k, view));
    return { outcome: "switched", toast: `Versión ${versionName(row.versions, k)}` };
  }

  if (prefix === CB_EDIT) {
    await tgSetState(d.db, editKey(p.fromId), { id, chatId: p.chatId, messageId: p.messageId ?? null, at: now } satisfies EditState, now);
    await reply(
      kind === "x"
        ? `✏️ Responde a este mensaje con tu texto para X: un post corto en inglés (máximo ${X_MAX} caracteres), frases normales, sin lista, sin hashtags y sin enlaces. Se añadirá como versión «mía».`
        : "✏️ Responde a este mensaje con tu texto. Mismo formato: las secciones «✨ New», «🔧 Improved» y «🐛 Fixed» (solo las que uses) y debajo sus líneas empezando por «- ». Se añadirá como versión «mía».",
      { reply_markup: { force_reply: true, input_field_placeholder: kind === "x" ? "Your post…" : "✨ New …" } }
    );
    return { outcome: "edit_asked", toast: "Responde con tu texto" };
  }

  if (prefix === CB_DISCARD) {
    if (!(await tgMoveChangelog(d.db, id, ["pending"], "discarded", { by: p.fromId, now }))) return decided((await tgGetChangelog(d.db, id))?.status ?? "discarded");
    await closed(`❌ ${label} · Descartado — no se ha publicado nada`, row.versions[0]?.en ?? row.text);
    await reply(`❌ ${label}: descartado. No se ha publicado nada.`);
    await d.audit(kind === "x" ? "x.post.discard" : "telegram.changelog.discard", id, { by: p.fromId });
    return { outcome: "discarded", toast: "Descartado" };
  }

  if (prefix === CB_IMAGE || prefix === CB_LINK || prefix === CB_WEEKLY) {
    if (kind !== "x") return { outcome: "unknown", toast: "Eso es solo para los borradores de X." };
    const x = meta.x ?? { image: false, link: false, imageUrl: null };
    if (prefix === CB_WEEKLY) {
      if (!(await tgMoveChangelog(d.db, id, ["pending"], "deferred", { by: p.fromId, now }))) return decided((await tgGetChangelog(d.db, id))?.status ?? "deferred");
      await closed("⏳ X · Guardado para el resumen semanal", row.versions[0]?.en ?? row.text);
      await reply("⏳ X: guardado para el resumen semanal del lunes. No se ha publicado nada.");
      await d.audit("x.post.defer", id, { by: p.fromId });
      return { outcome: "deferred", toast: "Al resumen semanal" };
    }
    const next = { ...x };
    if (prefix === CB_IMAGE) {
      if (!x.image && !imageFor(meta, view)) return { outcome: "unknown", toast: "No hay ninguna imagen: ni la del anuncio ni la imagen por defecto." };
      next.image = !x.image;
    } else {
      if (!x.link && xFinalLength(row.versions[k]?.en ?? "", true) > X_MAX) return { outcome: "unknown", toast: "Con el enlace esta versión no cabe en 280 caracteres." };
      next.link = !x.link;
    }
    if (!(await tgSetChangelogMeta(d.db, id, { ...meta, x: next }))) return decided((await tgGetChangelog(d.db, id))?.status ?? "published");
    await edit(approvalMessage({ ...row, meta: { ...meta, x: next } }, k, view));
    return { outcome: "switched", toast: prefix === CB_IMAGE ? `Imagen: ${next.image ? "sí" : "no"}` : `Enlace: ${next.link ? "sí" : "no"}` };
  }

  // Publish: the version this message is showing — its English text, nothing else.
  const version = row.versions[k];
  if (!version) return { outcome: "unknown", toast: "Esa versión no existe." };

  if (kind === "x") return publishOnX(d, { row, meta, version, k, by: p.fromId, now, reply, closed, edit, view, decided });

  const out = channelMessage(d.cfg, version.en, id);
  if (!out) {
    await reply("No hay dónde publicarlo (el canal no está configurado), así que no se ha publicado nada.");
    return { outcome: "off", toast: "No hay dónde publicarlo." };
  }
  if (!(await tgMoveChangelog(d.db, id, ["pending"], "published", { by: p.fromId, now, version: k, text: version.en }))) return decided((await tgGetChangelog(d.db, id))?.status ?? "published");
  await tgEnqueue(d.db, out, now);
  await closed(`✅ TELEGRAM · Publicado · versión ${versionName(row.versions, k)}`, version.en);
  await reply(`✅ TELEGRAM: publicada la versión ${versionName(row.versions, k)} en el canal.`);
  await d.audit("telegram.changelog.publish", id, { by: p.fromId, version: k + 1 });
  return { outcome: "published", toast: "Publicado ✅" };
}

type PublishCtx = {
  row: ChangelogRow;
  meta: DraftMeta;
  version: DraftVersion;
  k: number;
  by: number;
  now: number;
  reply: (text: string, extra?: Record<string, unknown>) => Promise<unknown>;
  closed: (title: string, text: string) => Promise<void>;
  edit: (payload: Record<string, unknown>) => Promise<void>;
  view: ApprovalView;
  decided: (status: string) => { outcome: "already"; toast: string };
};

/**
 * "✅ Publicar en X". Every check comes BEFORE anything is sent; the draft is then claimed (pending → publishing) so two
 * presses can't both send; X is called ONCE. X saying no leaves the draft as it was (pressing again is a person's
 * decision — each attempt is billed). No answer, or an unreadable one, closes the draft for good: the post may exist.
 */
async function publishOnX(d: ApprovalDeps, c: PublishCtx): Promise<{ outcome: CallbackOutcome; toast: string }> {
  const { row, meta, version, k } = c;
  const x = d.x;
  const off = async (text: string) => {
    await c.reply(`${text} No se ha publicado nada.`);
    return { outcome: "off" as const, toast: "No se ha publicado" };
  };
  if (!x || !x.config.enabled) return off("Publicar en X está apagado (hay que encenderlo en la configuración del servidor).");
  if (await x.paused()) return off("Publicar en X está en pausa de emergencia (se quita en /admin).");
  if (!x.client) return off(`Faltan credenciales de X en el servidor: ${x.config.missing.join(", ") || "sin configurar"}.`);

  const choices = meta.x ?? { image: false, link: false, imageUrl: null };
  const text = xFinalText(version.en, choices.link ? c.view.siteUrl : null);
  const why = xTextProblem(version.en);
  if (why || xFinalLength(version.en, choices.link) > X_MAX) return off(`Esta versión no se puede publicar en X: ${why ?? `con el enlace pasa de ${X_MAX} caracteres`}.`);

  const published = await tgPublishedOnX(d.db);
  if (published.some((r) => xFingerprint(r.text) === xFingerprint(text) || xFingerprint(r.text) === xFingerprint(version.en))) {
    await c.reply("Ese mismo texto ya se publicó en X. No se publica dos veces: elige otra versión o edítala.");
    return { outcome: "duplicate", toast: "Ese texto ya se publicó" };
  }
  const today = published.filter((r) => (r.decidedAt ?? 0) >= startOfUtcDay(c.now)).length;
  if (today >= x.config.maxPerDay) {
    const moved = meta.weekly ? null : await tgMoveChangelog(d.db, row.id, ["pending"], "deferred", { by: c.by, now: c.now });
    if (moved) await c.closed("⏳ X · Guardado para el resumen semanal", version.en);
    await c.reply(`Hoy ya se ha publicado en X el máximo (${x.config.maxPerDay} al día). No se ha publicado nada${moved ? " y este borrador queda guardado para el resumen semanal del lunes." : "; pulsa de nuevo mañana."}`);
    await d.audit("x.post.limit", row.id, { by: c.by });
    return { outcome: "limit", toast: "Límite diario de X alcanzado" };
  }

  if (!(await tgMoveChangelog(d.db, row.id, ["pending"], "publishing", { by: c.by, now: c.now }))) return c.decided((await tgGetChangelog(d.db, row.id))?.status ?? "published");
  const back = () => tgMoveChangelog(d.db, row.id, ["publishing"], "pending");
  const refused = async (what: string, reason: string) => {
    await back();
    await c.reply(`⚠️ X · No se ha publicado nada. ${what}: ${reason}.\n\nNo lo reintento solo (cada intento cuesta). Cuando esté resuelto, pulsa otra vez «Publicar en X» en el borrador.`);
    await d.audit("x.post.rejected", row.id, { by: c.by, reason });
    return { outcome: "failed" as const, toast: "X no lo ha publicado" };
  };

  let mediaId: string | undefined;
  const imageUrl = choices.image ? imageFor(meta, c.view) : null;
  if (imageUrl) {
    const image = await x.fetchImage(imageUrl);
    if (!image.ok) return refused("No he podido preparar la imagen", image.reason);
    const up = await x.client.uploadImage(image.bytes, image.mime);
    if (!up.ok) return refused("X no ha aceptado la imagen", up.reason);
    mediaId = up.value.mediaId;
  }

  const sent = await x.client.post(text, mediaId);
  if (!sent.ok && sent.kind === "rejected") return refused("X ha rechazado el post", sent.reason);
  if (!sent.ok) {
    await tgMoveChangelog(d.db, row.id, ["publishing"], "failed", { by: c.by, now: c.now, text, version: k });
    await c.closed("⚠️ X · Resultado desconocido — revisa el perfil", text);
    await c.reply(`⚠️ X · No sé si se ha publicado: ${sent.reason}.\n\nMira el perfil de X antes de hacer nada. Este borrador queda cerrado para no publicar dos veces; si no salió, envía uno nuevo.`);
    await d.audit("x.post.unknown", row.id, { by: c.by, reason: sent.reason });
    return { outcome: "failed", toast: "Resultado desconocido: revisa X" };
  }
  const url = `https://x.com/i/status/${sent.value.id}`;
  await tgMoveChangelog(d.db, row.id, ["publishing"], "published", { by: c.by, now: c.now, text, version: k, meta: { ...meta, x: { ...choices, postId: sent.value.id, url } } });
  await c.closed(`✅ X · Publicado · versión ${versionName(row.versions, k)}`, `${text}\n\n${url}`);
  await c.reply(`✅ X: publicado.\n${url}`);
  await d.audit("x.post.publish", row.id, { by: c.by, version: k + 1, postId: sent.value.id, image: !!mediaId, link: choices.link });
  return { outcome: "published", toast: "Publicado en X ✅" };
}

/**
 * The admin's answer to "✏️ Editar": their own text, checked with the same rules as every version of that place. If it
 * passes it becomes the version "mía" (replacing an earlier one of theirs) and the approval message switches to it; if
 * not, the bot says what is wrong and keeps waiting. Returns false when this message isn't such an answer.
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
  let mine: string;
  if (kindOf(row) === "x") {
    const why = xTextProblem(msg.text);
    if (why) {
      await say(`No se puede usar ese texto en X: contiene ${why}.\n\nCorrígelo y responde otra vez al mensaje anterior.`);
      return true;
    }
    mine = msg.text.trim();
  } else {
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
    mine = buildChangelogText(checked.sections, row.createdAt);
  }
  const versions: DraftVersion[] = [...row.versions.filter((v) => !v.mine), { en: mine, es: null, mine: true }];
  if (!(await tgSetChangelogVersions(d.db, row.id, versions))) {
    await say("Ese borrador ya está decidido, así que no se puede editar.");
    return true;
  }
  await tgDeleteState(d.db, editKey(msg.fromId));
  const k = versions.length - 1;
  const message = approvalMessage({ ...row, versions }, k, viewOf(d));
  if (d.editMessage && state.messageId !== null) await d.editMessage(state.chatId, state.messageId, message).catch(() => undefined);
  else await tgEnqueue(d.db, { chatId: String(msg.chatId), method: "sendMessage", payload: message }, now);
  await say(`Añadida como versión «${k + 1} · mía». Ya se ve en el mensaje del borrador: pulsa «✅ Publicar» ahí si es la que quieres.`);
  await d.audit(kindOf(row) === "x" ? "x.post.edit" : "telegram.changelog.edit", row.id, { by: msg.fromId });
  return true;
}
