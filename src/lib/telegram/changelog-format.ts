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
  { why: "a feature that isn't open to everyone", re: /\bpanda orders?\b|\bdurable nonce|\bpre-?signed\b/i },
  { why: "a security detail", re: /\b(?:vulnerab\w*|exploit\w*|bypass\w*|injection|xss|csrf|attack\w*|hack\w*|leak\w*|breach\w*|spoof\w*|phishing|malicious|unauthori[sz]ed|csp|sandbox\w*)\b/i },
  { why: "a promise about the future", re: /\b(?:soon|coming|upcoming|will be|we will|we'll|going to|next (?:week|month|release|update)|roadmap|stay tuned|planned|eta)\b/i },
  { why: "a promise about price or rewards", re: /\b(?:price (?:will|is going)|pump(?!\.fun|swap)\w*|moon\w*|100x|guarantee\w*|profit\w*|airdrops?|giveaway\w*|earn (?:more|free)|free (?:money|tokens|sol))\b/i },
];
/** The ONE thing that may be said about a security change. */
const SECURITY_OK = /^security improvements\.?$/i;

export function lineProblem(line: string): string | null {
  const text = line.trim();
  if (!text) return "an empty line";
  if (text.length > MAX_ITEM_CHARS) return `more than ${MAX_ITEM_CHARS} characters`;
  if (/[\r\n<>]/.test(text)) return "line breaks or markup";
  if (SECURITY_OK.test(text)) return null;
  if (/\bsecurity\b/i.test(text)) return 'a security detail (the most that may be said is "Security improvements")';
  for (const f of FORBIDDEN) if (f.re.test(text)) return f.why;
  return null;
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
    current = head === "new" ? "new" : head === "improved" ? "improved" : head === "fixed" ? "fixed" : null;
  }
  return out;
}
