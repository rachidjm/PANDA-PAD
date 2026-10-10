/**
 * The public changelog's fixed format and content rules — pure text, no database and no network, so the local script
 * (scripts/changelog.ts) checks a draft with exactly the rules the server applies (changelog.ts).
 */

export const SECTIONS = [
  { key: "new", title: "✨ New" },
  { key: "improved", title: "🔧 Improved" },
  { key: "fixed", title: "🐛 Fixed" },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];
export type ChangelogInput = Partial<Record<SectionKey, string[]>>;

export const MAX_ITEMS = 3;
export const MAX_ITEM_CHARS = 140;
export const SITE_LINE = "🌐 launchonpanda.app";

/** Why a line can't go out, or null. One rule per entry: the first that matches is the one reported. */
const FORBIDDEN: { why: string; re: RegExp }[] = [
  { why: "a wallet address or transaction id", re: /\b[1-9A-HJ-NP-Za-km-z]{32,}\b/ },
  { why: "a variable or secret name", re: /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/ },
  { why: "a link", re: /https?:\/\/|www\.|\b(?!pump\.fun\b)[a-z0-9-]+\.(?:com|io|xyz|net|org|dev|fun)\b/i },
  { why: "code or a file name", re: /`|\bsrc\/|\/api\/|\.(?:tsx?|jsx?|sql|json|md|env)\b|\(\)|=>|\b(?:commit|repo|github|pull request|branch|refactor|typescript|endpoint|migration)\b/i },
  { why: "secrets or credentials", re: /\b(?:secret|password|private key|seed phrase|api key|credential|bearer|webhook)s?\b/i },
  { why: "the admin area or access lists", re: /\/admin|\badmins?\b|\ballow-?list|\bwhite-?list|\baccess list|\bfeature flag|\bbeta testers?\b/i },
  { why: "infrastructure", re: /\b(?:vercel|neon|postgres|database|upstash|redis|rpc|helius|cron|server|backend|deploy(?:ed|ment)?|blob storage|rate.?limit\w*)\b/i },
  { why: "how a feature works inside", re: /\bdurable nonce|\bpre-?signed\b/i },
  { why: "a security detail", re: /\b(?:vulnerab\w*|exploit\w*|bypass\w*|injection|xss|csrf|attack\w*|hack\w*|leak\w*|breach\w*|spoof\w*|phishing|malicious|unauthori[sz]ed|csp|sandbox\w*)\b/i },
  { why: "a promise about the future", re: /\b(?:soon|coming|upcoming|will be|we will|we'll|going to|next (?:week|month|release|update)|roadmap|stay tuned|planned|eta)\b/i },
  { why: "a promise about price or rewards", re: /\b(?:price (?:will|is going)|pump(?!\.?\s?fun|swap)\w*|moon\w*|100x|guarantee\w*|profit\w*|airdrops?|giveaway\w*|earn (?:more|free)|free (?:money|tokens|sol))\b/i },
];
/** PANDA orders may be named only once they are open to everyone (the access list is "*"): until then only the admins and the list see them. */
const ORDERS = /\bpanda orders?\b/i;
export const ordersOpenToAll = (env: Record<string, string | undefined> = process.env) => env.PANDA_ORDERS_ALLOWLIST?.trim() === "*";

/** The ONE thing that may be said about a security change. */
const SECURITY_OK = /^security improvements\.?$/i;

/** The content rules alone (what may never be said in public), whatever the format: a changelog line or a post on X. */
export function contentProblem(text: string): string | null {
  if (SECURITY_OK.test(text.trim())) return null;
  if (/\bsecurity\b/i.test(text)) return 'a security detail (the most that may be said is "Security improvements")';
  for (const f of FORBIDDEN) if (f.re.test(text)) return f.why;
  if (ORDERS.test(text) && !ordersOpenToAll()) return "a feature that isn't open to everyone";
  return null;
}

export function lineProblem(line: string): string | null {
  const text = line.trim();
  if (!text) return "an empty line";
  if (text.length > MAX_ITEM_CHARS) return `more than ${MAX_ITEM_CHARS} characters`;
  if (/[\r\n<>]/.test(text)) return "line breaks or markup";
  return contentProblem(text);
}

export type Checked = { ok: true; sections: { title: string; items: string[] }[] } | { ok: false; problems: string[] };

/** Only sections that have something; at most 3 short lines each; every line checked against the content rules. */
export function checkChangelog(input: unknown): Checked {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const problems: string[] = [];
  const sections: { title: string; items: string[] }[] = [];
  for (const s of SECTIONS) {
    const raw = o[s.key];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
      problems.push(`${s.title}: must be a list of lines.`);
      continue;
    }
    const items = (raw as string[]).map((x) => x.trim().replace(/^[-•*]\s*/, ""));
    if (items.length === 0) continue;
    if (items.length > MAX_ITEMS) problems.push(`${s.title}: at most ${MAX_ITEMS} lines (got ${items.length}).`);
    items.forEach((it, k) => {
      const why = lineProblem(it);
      if (why) problems.push(`${s.title} #${k + 1}: can't be published — it contains ${why}.`);
    });
    sections.push({ title: s.title, items });
  }
  if (!problems.length && sections.length === 0) problems.push("Nothing to publish: every section is empty.");
  return problems.length ? { ok: false, problems } : { ok: true, sections };
}

/** "October 10, 2026" (UTC). */
export const changelogDate = (now: number) => new Date(now).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The message exactly as the channel will show it. */
export function buildChangelogText(sections: { title: string; items: string[] }[], now: number): string {
  const body = sections.map((s) => [s.title, ...s.items.map((i) => `- ${i}`)].join("\n")).join("\n");
  return `🛠 PANDA Update · ${changelogDate(now)}\n\n${body}\n\n${SITE_LINE}`;
}

/**
 * A draft written as Markdown (what `npm run changelog -- file.md` reads): a heading or line naming the section
 * ("## New", "✨ New", "Improved:", "Fixed") followed by "- " lines. Anything else is ignored.
 */
export function parseChangelogMarkdown(md: string): ChangelogInput {
  const out: ChangelogInput = {};
  let current: SectionKey | null = null;
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const bullet = /^[-•*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (current && bullet[1].trim()) (out[current] ??= []).push(bullet[1].trim());
      continue;
    }
    const head = line.replace(/^#+\s*/, "").replace(/[^A-Za-z]/g, "").toLowerCase();
    current = head === "new" || head === "nuevo" ? "new" : head === "improved" || head === "mejorado" ? "improved" : head === "fixed" || head === "corregido" ? "fixed" : null;
  }
  return out;
}

// ── a draft: three versions for Telegram, three for X, each with a very plain Spanish summary ───────────────────────

export const VERSIONS = 3;
/**
 * The Spanish part is NOT a translation and not an explanation of each point: it is "🇪🇸 En resumen:" and one or two very
 * easy sentences, as if told to someone who knows nothing about programming or crypto ("Anuncia que ahora puedes poner
 * ventas y stops en el gráfico y se ejecutan solos."), plus — only if it helps — the tone in a word or two. It is only
 * ever shown to the admins; it is never published.
 */
export const ES_LABEL = "🇪🇸 En resumen:";
export const MAX_SUMMARY_CHARS = 320;
export const MAX_SUMMARY_SENTENCES = 2;
export const MAX_TONE_CHARS = 30;
export const MAX_TONE_WORDS = 3;

export type SummaryInput = { summary?: string; tone?: string } | string;
export type VersionInput = ChangelogInput & { es?: SummaryInput };
export type XVersionInput = { text?: string; es?: SummaryInput };
export type Level = "important" | "small";
export type DraftInput = {
  /** "important" → drafts for Telegram and X now. "small" → kept for Monday's weekly summary. */
  level?: Level;
  /** One short phrase for the weekly summary on X ("trades confirm faster"). */
  digest?: string;
  /** The announcement's own image, offered for the post on X (https). */
  imageUrl?: string;
  versions?: VersionInput[];
  x?: XVersionInput[];
};
export type CheckedSummary = { summary: string; tone: string | null };
export type CheckedVersion = { sections: { title: string; items: string[] }[] } & CheckedSummary;

const TECHNICAL = /`|\bsrc\/|\/api\/|\.(?:tsx?|jsx?|sql|json|md|env)\b|\(\)|=>|\b[a-z]+[A-Z][A-Za-z]+\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/;

/** One or two easy sentences, no markup, nothing technical; the tone, if given, in a word or two. */
export function checkSummary(es: unknown): { ok: true; value: CheckedSummary } | { ok: false; problems: string[] } {
  const o = (typeof es === "string" ? { summary: es } : es && typeof es === "object" ? es : {}) as { summary?: unknown; tone?: unknown };
  const summary = typeof o.summary === "string" ? o.summary.trim().replace(/^(?:🇪🇸\s*)?en resumen\s*:\s*/i, "").replace(/\s+/g, " ") : "";
  const tone = typeof o.tone === "string" ? o.tone.trim().replace(/^tono\s*:\s*/i, "").replace(/\.$/, "") : "";
  const problems: string[] = [];
  if (!summary) problems.push('the Spanish summary ("En resumen") is missing.');
  else {
    if (summary.length > MAX_SUMMARY_CHARS || /[<>]/.test(summary)) problems.push(`the Spanish summary is too long (max ${MAX_SUMMARY_CHARS} characters) or has markup.`);
    if ((summary.match(/[.!?…]+(?=\s|$)/g) ?? []).length > MAX_SUMMARY_SENTENCES) problems.push(`the Spanish summary must be ${MAX_SUMMARY_SENTENCES} sentences at most.`);
    if (/(?:^|\s)[-•*]\s/.test(summary)) problems.push("the Spanish summary must be plain sentences, not a list.");
    if (TECHNICAL.test(summary)) problems.push("the Spanish summary must not name files, functions or settings.");
  }
  if (tone && (tone.length > MAX_TONE_CHARS || tone.split(/\s+/).length > MAX_TONE_WORDS || /[<>\r\n]/.test(tone))) problems.push(`the tone must be a word or two (max ${MAX_TONE_WORDS}).`);
  return problems.length ? { ok: false, problems } : { ok: true, value: { summary, tone: tone || null } };
}

/** What the admin reads under a draft (after the "🇪🇸 En resumen:" label): the summary and, if given, the tone. */
export function buildExplanationText(summary: string, tone: string | null): string {
  return tone ? `${summary}\nTono: ${tone}` : summary;
}

export type CheckedDraft = { versions: CheckedVersion[] };

/** Exactly three versions for Telegram, each within the format and content rules, each with its summary, and really different. */
export function checkDraft(input: unknown): { ok: true; versions: CheckedVersion[] } | { ok: false; problems: string[] } {
  const raw = (input && typeof input === "object" ? (input as DraftInput).versions : undefined) ?? [];
  if (!Array.isArray(raw) || raw.length !== VERSIONS) return { ok: false, problems: [`A draft needs exactly ${VERSIONS} versions (got ${Array.isArray(raw) ? raw.length : 0}).`] };
  const problems: string[] = [];
  const versions: CheckedVersion[] = [];
  raw.forEach((v, k) => {
    const en = checkChangelog(v);
    if (!en.ok) return problems.push(...en.problems.map((p) => `Version ${k + 1} · ${p}`));
    const es = checkSummary((v as VersionInput)?.es);
    if (!es.ok) return problems.push(...es.problems.map((p) => `Version ${k + 1} · ${p}`));
    versions.push({ sections: en.sections, ...es.value });
  });
  if (!problems.length) {
    const body = versions.map((v) => JSON.stringify(v.sections).toLowerCase());
    if (new Set(body).size !== body.length) problems.push("Two versions are the same: each one must be worded differently.");
  }
  return problems.length ? { ok: false, problems } : { ok: true, versions };
}

/**
 * A draft file (what `npm run changelog -- file.md` reads). The Telegram versions keep their format; the versions for X
 * are plain text. Under each one, "### ES" and the summary in one or two easy sentences (+ an optional "Tono:" line):
 *
 *   Level: important            ← or "small": kept for Monday's weekly summary
 *   Digest: orders on the chart for everyone
 *   Image: https://…            ← optional
 *
 *   # Version 1
 *   ## New
 *   - …
 *   ### ES
 *   Anuncia que …
 *   Tono: cercano
 *   # Version 2 …   # Version 3 …
 *
 *   # X 1
 *   The post, as it would be published.
 *   ### ES
 *   Cuenta que …
 *   # X 2 …   # X 3 …
 */
export function parseDraftMarkdown(md: string): DraftInput {
  const out: DraftInput = { versions: [] };
  const x: XVersionInput[] = [];
  let chunk: { kind: "tg" | "x"; body: string[]; es: string[] } | null = null;
  let inEs = false;
  const summaryOf = (lines: string[]): SummaryInput => {
    const tone = lines.map((l) => /^\s*(?:[-•*]\s*)?tono\s*:\s*(.+)$/i.exec(l)?.[1]?.trim()).find(Boolean);
    const summary = lines
      .filter((l) => !/^\s*(?:[-•*]\s*)?tono\s*:/i.test(l))
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ");
    return tone ? { summary, tone } : { summary };
  };
  const flush = () => {
    if (!chunk) return;
    if (chunk.kind === "tg") out.versions!.push({ ...parseChangelogMarkdown(chunk.body.join("\n")), es: summaryOf(chunk.es) });
    else x.push({ text: chunk.body.join("\n").trim(), es: summaryOf(chunk.es) });
  };
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    const head = t.replace(/^#+\s*/, "").toLowerCase();
    if (/^#+\s*versi[oó]n\s*\d+\b/i.test(t)) {
      flush();
      chunk = { kind: "tg", body: [], es: [] };
      inEs = false;
    } else if (/^#+\s*x\s*\d+\b/i.test(t)) {
      flush();
      chunk = { kind: "x", body: [], es: [] };
      inEs = false;
    } else if (chunk && /^#+\s/.test(t) && /^(es|español|espanol|traducci[oó]n|spanish|en resumen)\b/.test(head)) {
      inEs = true;
    } else if (chunk) {
      (inEs ? chunk.es : chunk.body).push(line);
    } else {
      const m = /^(level|nivel|digest|resumen semanal|image|imagen)\s*:\s*(.+)$/i.exec(t);
      if (!m) continue;
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      if (key === "level" || key === "nivel") out.level = /^(small|peque)/i.test(value) ? "small" : "important";
      else if (key === "digest" || key === "resumen semanal") out.digest = value;
      else out.imageUrl = value;
    }
  }
  flush();
  if (x.length) out.x = x;
  return out;
}
