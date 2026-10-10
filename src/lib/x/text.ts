import { contentProblem } from "@/lib/telegram/changelog-format";

/**
 * What a post on X may look like. It is NOT a changelog: a short note, the way a person tells what they just shipped —
 * short natural sentences, no list, no headings, no dates, no marketing or "AI" phrases, no long dashes, no hashtags, at
 * most one emoji, at most 280 characters, and no link or domain written in it (X bills a post with a link at many times
 * the price; the link is a separate, explicit choice). The content rules of the changelog apply too. Pure: every rule is
 * tested.
 */

export const X_MAX = 280;
/** Every link counts as 23 characters on X, whatever its length. */
export const X_LINK_CHARS = 23;
/** Approximate prices per request, from X's pay-per-use price list (docs.x.com → X API → Pricing). They can change. */
export const X_COST_USD = { post: 0.015, postWithLink: 0.2 } as const;

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Length the way X counts it: one per character, two per emoji. */
export function xLength(text: string): number {
  const chars = [...text.normalize("NFC")].filter((c) => c !== "\uFE0F" && c !== "\u200D");
  return chars.reduce((n, c) => n + (/\p{Extended_Pictographic}/u.test(c) ? 2 : 1), 0);
}

const BANNED_PHRASES = [
  "excited to announce",
  "excited to share",
  "we're excited",
  "we are excited",
  "we're thrilled",
  "we are thrilled",
  "thrilled to",
  "proud to announce",
  "game-changer",
  "game changer",
  "game-changing",
  "seamless",
  "seamlessly",
  "elevate",
  "unlock",
  "dive in",
  "deep dive",
  "delve",
  "revolutionary",
  "revolutionize",
  "cutting-edge",
  "next-level",
  "next level",
  "supercharge",
  "say goodbye to",
  "look no further",
  "stay tuned",
];
const banned = new RegExp(`(?<![a-z])(?:${BANNED_PHRASES.map((p) => p.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&").replace(/'/g, "['’]")).join("|")})(?![a-z])`, "i");
const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}\\s+(?:${MONTHS})\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, "i");

/** Why this text can't be a post on X, or null. The first rule that matches is the one reported. */
export function xTextProblem(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "an empty text";
  if (/[<>]/.test(text)) return "markup";
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.some((l) => /^(?:[-•*·▪◦‣➤→]|\d{1,2}[.)])\s+/.test(l))) return "a list (bullets or numbered lines): write it as a couple of plain sentences";
  if (lines.some((l) => /^#+\s/.test(l) || /^(?:\P{L})*(?:new|improved|fixed|changelog|update|panda update)\s*:?\s*$/iu.test(l))) return "a heading (it is a post, not a changelog)";
  if (lines.filter(Boolean).length > 4) return "too many separate lines: it should read as one short note";
  if (/[—―–]/.test(text)) return "a long dash (— or –): use a comma or a full stop";
  if (/(^|\s)#[\p{L}\d_]+/u.test(text)) return "a hashtag";
  if ((text.match(EMOJI) ?? []).length > 1) return "more than one emoji";
  const phrase = banned.exec(text);
  if (phrase) return `a stock marketing phrase ("${phrase[0]}")`;
  if (DATE.test(text)) return "a date";
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}(?:\/|\b)/i.test(text)) return 'a link or a domain (X bills it as a link — write "Pumpfun", and use the link button if the post needs one)';
  const content = contentProblem(text);
  if (content) return content;
  const length = xLength(text);
  if (length > X_MAX) return `more than ${X_MAX} characters (${length})`;
  return null;
}

/** The post as it would go out: the text, plus the site's address on its own line when the link is on. */
export const xFinalText = (text: string, link: string | null) => (link ? `${text.trim()}\n${link}` : text.trim());
export const xFinalLength = (text: string, link: boolean) => xLength(text.trim()) + (link ? 1 + X_LINK_CHARS : 0);
export const xCostUsd = (link: boolean) => (link ? X_COST_USD.postWithLink : X_COST_USD.post);

/** Two texts are "the same post" if they only differ in case, spacing or punctuation. */
export const xFingerprint = (text: string) => text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// ── the weekly summary ──────────────────────────────────────────────────────────────────────────────────────────────

export const MAX_DIGEST_CHARS = 90;

/** A small update's one-line summary for the weekly post: a short phrase with no final stop ("trades confirm faster"). */
export function digestProblem(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return "missing (one short phrase for the weekly summary)";
  const line = raw.trim();
  if (line.length > MAX_DIGEST_CHARS) return `more than ${MAX_DIGEST_CHARS} characters`;
  if (/[\r\n]/.test(line) || /[.!?:;]$/.test(line)) return "it must be one phrase with no final punctuation";
  return xTextProblem(`This week on PANDA: ${line}.`);
}

/** "A new button" → "a new button"; a name in capitals ("PANDA orders…") is left alone. */
const lower = (s: string) => (/^[A-Z](?:[a-z]|\s)/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const upper = (s: string) => s[0].toUpperCase() + s.slice(1);
const listed = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * Three wordings of the week's small updates, from their one-line summaries. Each fits in a post: if they don't all fit,
 * the last ones are left out (never cut mid-phrase). No summaries → no versions.
 */
export function weeklyXVersions(digests: string[]): string[] {
  const items = [...new Set(digests.map((d) => d.trim()).filter(Boolean))];
  if (items.length === 0) return [];
  const forms: ((list: string[]) => string)[] = [
    (list) => `This week on PANDA: ${listed(list.map(lower))}.`,
    (list) => `A few small things landed on PANDA this week. ${list.map((i) => `${upper(i)}.`).join(" ")}`,
    (list) => `Quick weekly update from PANDA: ${listed(list.map(lower))}. Small changes, all live now.`,
  ];
  return forms.map((form) => {
    let list = items;
    while (list.length > 1 && xLength(form(list)) > X_MAX) list = list.slice(0, -1);
    return form(list);
  });
}
