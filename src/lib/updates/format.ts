import { contentProblem } from "@/lib/telegram/changelog-format";

/**
 * The public "Updates" page (/updates): what an entry is and what it may say. An entry is longer than a changelog line —
 * a short title, a tag, and two to five sentences on what changes for the user and how to use it, in English and in
 * Spanish — but the SAME content rules apply (nothing about security details, internal wallets, the admin area,
 * settings or infrastructure; nothing that isn't open to everyone; no promises). Pure, so every rule is tested.
 */

export const TAGS = ["new", "improved", "fixed"] as const;
export type UpdateTag = (typeof TAGS)[number];
export type Bilingual = { en: string; es: string };
export type UpdateEntry = { tag: UpdateTag; title: Bilingual; body: Bilingual; imageUrl: string | null };
/** An entry of the history also says which day it belongs to (YYYY-MM-DD). */
export type DatedEntry = UpdateEntry & { date: string };

export const MAX_ENTRIES_PER_DRAFT = 4;
export const MAX_TITLE_CHARS = 70;
export const MAX_BODY_CHARS = 600;
export const MIN_SENTENCES = 2;
export const MAX_SENTENCES = 5;

export const sentences = (text: string) => (text.match(/[^.!?…]+[.!?…]+(?=\s|$)/g) ?? []).length;

/** An image is one of the site's own files ("/updates/orders.png") or an https address. */
export function imageOf(v: unknown): string | null | "invalid" {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string") return "invalid";
  const s = v.trim();
  if (/^\/[A-Za-z0-9/_.-]{1,200}\.(?:png|jpe?g|webp|gif|svg)$/.test(s) && !s.includes("..")) return s;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

function textProblem(what: string, text: unknown, max: number): string | null {
  if (typeof text !== "string" || !text.trim()) return `${what} is missing`;
  const t = text.trim();
  if (t.length > max) return `${what} is longer than ${max} characters`;
  if (/[<>]/.test(t)) return `${what} has markup`;
  const content = contentProblem(t);
  return content ? `${what} can't be published — it contains ${content}` : null;
}

export function checkEntry(raw: unknown): { ok: true; entry: UpdateEntry } | { ok: false; problems: string[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as { tag?: unknown; title?: Partial<Bilingual>; body?: Partial<Bilingual>; imageUrl?: unknown };
  const problems: string[] = [];
  const tag = typeof o.tag === "string" ? o.tag.trim().toLowerCase() : "";
  if (!(TAGS as readonly string[]).includes(tag)) problems.push("the tag must be New, Improved or Fixed");
  for (const lang of ["en", "es"] as const) {
    const title = textProblem(`the ${lang.toUpperCase()} title`, o.title?.[lang], MAX_TITLE_CHARS);
    if (title) problems.push(title);
    else if (/[\r\n]/.test(o.title![lang]!.trim())) problems.push(`the ${lang.toUpperCase()} title must be one line`);
    const body = textProblem(`the ${lang.toUpperCase()} text`, o.body?.[lang], MAX_BODY_CHARS);
    if (body) problems.push(body);
    else {
      const n = sentences(o.body![lang]!.trim());
      if (n < MIN_SENTENCES || n > MAX_SENTENCES) problems.push(`the ${lang.toUpperCase()} text must be ${MIN_SENTENCES} to ${MAX_SENTENCES} sentences (it has ${n})`);
    }
  }
  const image = imageOf(o.imageUrl);
  if (image === "invalid") problems.push("the image must be a file of the site (/…png) or an https address");
  if (problems.length) return { ok: false, problems };
  const clean = (s: string) => s.trim().replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, " ");
  return {
    ok: true,
    entry: { tag: tag as UpdateTag, title: { en: clean(o.title!.en!), es: clean(o.title!.es!) }, body: { en: clean(o.body!.en!), es: clean(o.body!.es!) }, imageUrl: image === "invalid" ? null : image },
  };
}

/** A draft's entries for the web: at least one, a few at most, each within the rules. */
export function checkWebEntries(raw: unknown): { ok: true; entries: UpdateEntry[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, problems: ["Web: the detailed version for the Updates page is missing (at least one entry)."] };
  if (raw.length > MAX_ENTRIES_PER_DRAFT) return { ok: false, problems: [`Web: at most ${MAX_ENTRIES_PER_DRAFT} entries per update (got ${raw.length}).`] };
  const problems: string[] = [];
  const entries: UpdateEntry[] = [];
  raw.forEach((e, k) => {
    const c = checkEntry(e);
    if (c.ok) entries.push(c.entry);
    else problems.push(...c.problems.map((p) => `Web entry ${k + 1}: ${p}.`));
  });
  return problems.length ? { ok: false, problems } : { ok: true, entries };
}

export const MAX_HISTORY_ENTRIES = 60;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The history: dated entries, oldest to newest, none in the future. */
export function checkHistory(raw: unknown, now: number): { ok: true; entries: DatedEntry[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, problems: ["History: no entries."] };
  if (raw.length > MAX_HISTORY_ENTRIES) return { ok: false, problems: [`History: at most ${MAX_HISTORY_ENTRIES} entries (got ${raw.length}).`] };
  const problems: string[] = [];
  const entries: DatedEntry[] = [];
  raw.forEach((e, k) => {
    const date = typeof (e as { date?: unknown })?.date === "string" ? (e as { date: string }).date.trim() : "";
    const ts = DAY.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
    if (!Number.isFinite(ts) || ts > now + 86_400_000) problems.push(`History entry ${k + 1}: the date must be a past day, as YYYY-MM-DD.`);
    const c = checkEntry(e);
    if (!c.ok) problems.push(...c.problems.map((p) => `History entry ${k + 1}: ${p}.`));
    else if (Number.isFinite(ts)) entries.push({ ...c.entry, date });
  });
  return problems.length ? { ok: false, problems } : { ok: true, entries: entries.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
}

/** "PANDA orders for everyone" + its day → "2026-10-10-panda-orders-for-everyone": the entry's own address. */
export function slugFor(title: string, ts: number): string {
  const day = new Date(ts).toISOString().slice(0, 10);
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${day}-${words || "update"}`;
}

export const SLUG_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]{1,70}$/;
export const TAG_LABEL: Record<UpdateTag, Bilingual> = { new: { en: "New", es: "Nuevo" }, improved: { en: "Improved", es: "Mejorado" }, fixed: { en: "Fixed", es: "Corregido" } };

// ── screenshots ──────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * An entry's screenshot is one of the site's own files, under /updates/. When the screen's text changes with the
 * language there are two files, "….en.webp" and "….es.webp": the entry stores the English one and the Spanish reader
 * gets its sibling. A picture with no text in it is a single file without that mark.
 */
const SHOT_RE = /^\/updates\/[a-z0-9][a-z0-9._-]{0,80}\.(?:webp|png|jpe?g)$/;
export const isScreenshotPath = (v: unknown): v is string => typeof v === "string" && SHOT_RE.test(v) && !v.includes("..");

export function localizedImage(url: string, lang: string): string {
  return lang === "es" ? url.replace(/\.en\.(webp|png|jpe?g)$/, ".es.$1") : url;
}
/** Every file an entry's picture stands for (one, or the English and the Spanish one). */
export function imageVariants(url: string): string[] {
  const es = localizedImage(url, "es");
  return es === url ? [url] : [url, es];
}

export const MAX_IMAGE_ASSIGNMENTS = 60;
export type ImageAssignment = { id: string; imageUrl: string | null };

/** Screenshots for entries that are ALREADY on the page: which entry, which file (null takes the picture away). */
export function checkImageAssignments(raw: unknown): { ok: true; items: ImageAssignment[] } | { ok: false; problems: string[] } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, problems: ["Images: no entries."] };
  if (raw.length > MAX_IMAGE_ASSIGNMENTS) return { ok: false, problems: [`Images: at most ${MAX_IMAGE_ASSIGNMENTS} entries (got ${raw.length}).`] };
  const problems: string[] = [];
  const items: ImageAssignment[] = [];
  const seen = new Set<string>();
  raw.forEach((r, k) => {
    const o = (r && typeof r === "object" ? r : {}) as { id?: unknown; imageUrl?: unknown };
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!SLUG_RE.test(id)) return void problems.push(`Image ${k + 1}: the entry's id isn't valid.`);
    if (seen.has(id)) return void problems.push(`Image ${k + 1}: ${id} appears twice.`);
    seen.add(id);
    if (o.imageUrl === null) return void items.push({ id, imageUrl: null });
    if (!isScreenshotPath(o.imageUrl)) return void problems.push(`Image ${k + 1}: the picture must be a file of the site under /updates/ (webp, png or jpg).`);
    items.push({ id, imageUrl: o.imageUrl });
  });
  return problems.length ? { ok: false, problems } : { ok: true, items };
}
