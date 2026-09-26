/**
 * RugCheck's public token summary — https://api.rugcheck.xyz/swagger/doc.json (official OpenAPI): `GET /v1/tokens/{mint}/report/summary`,
 * no API key. 200 → `{ score, score_normalised, risks: [{ name, level, description, score, value }], lpLockedPct, tokenProgram, tokenType }`;
 * 400 → invalid mint; 404 → token not found. It answers `X-Rate-Limit-Limit: 15` per IP, so PANDA caches (src/lib/rugcheck/server.ts).
 *
 * The badge level comes from RugCheck's OWN per-risk levels, not from a threshold invented here: any "danger" risk → danger, otherwise any
 * "warn" → warn, otherwise good (no alerts). The number shown is RugCheck's `score_normalised` (a risk score: 1 for a clean token, ~60 for
 * the ones it flags as dangerous). Third-party, automated, and it can be wrong: the UI says so.
 */

export type RugLevel = "good" | "warn" | "danger";
export type RugRisk = { name: string; level: string };
export type RugSummary = { level: RugLevel; score: number | null; risks: RugRisk[]; lpLockedPct: number | null };

export const RUGCHECK_API = "https://api.rugcheck.xyz/v1/tokens";
export const rugcheckPageUrl = (mint: string) => `https://rugcheck.xyz/tokens/${mint}`;

/** A summary from RugCheck's JSON, or null when it isn't a usable one (an error body, a missing score, garbage): then NOTHING is shown. */
export function parseSummary(raw: unknown): RugSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.error === "string" && o.error) return null;
  if (!Array.isArray(o.risks)) return null;
  const score = typeof o.score_normalised === "number" && Number.isFinite(o.score_normalised) ? o.score_normalised : null;
  if (score === null && typeof o.score !== "number") return null; // neither score present: not a report
  const risks: RugRisk[] = [];
  for (const r of o.risks) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    if (typeof x.name === "string" && typeof x.level === "string") risks.push({ name: x.name.slice(0, 80), level: x.level });
  }
  const level: RugLevel = risks.some((r) => r.level === "danger") ? "danger" : risks.some((r) => r.level === "warn") ? "warn" : "good";
  const lp = typeof o.lpLockedPct === "number" && Number.isFinite(o.lpLockedPct) ? o.lpLockedPct : null;
  // The worst first, so a tooltip's first lines are the ones that matter; danger before warn before the rest.
  const rank = (l: string) => (l === "danger" ? 0 : l === "warn" ? 1 : 2);
  risks.sort((a, b) => rank(a.level) - rank(b.level));
  return { level, score: score === null ? null : Math.round(score), risks: risks.slice(0, 6), lpLockedPct: lp };
}
