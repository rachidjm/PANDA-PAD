/**
 * A recruiter's own short code (`launchonpanda.app/r/<code>`). Format and the reserved/offensive-word check
 * are pure and client-safe; uniqueness itself is the database's job (src/lib/db/fee-tier.ts).
 */

const MIN_LEN = 3;
const MAX_LEN = 20;
/** Lowercase letters, digits and hyphens only — never at the ends, never doubled (keeps a code readable and
 *  unambiguous in a URL, and rules out lookalike tricks like "pan--da"). */
const FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Reserved words: PANDA's own brand/role terms (never let a code impersonate "the official PANDA account" or an
 * admin), plus a short, deliberately non-exhaustive list of common English/Spanish slurs and profanity. This is
 * a best-effort first gate, not a claim of completeness — PANDA can still remove a code by hand
 * (`recruiter_codes` in Postgres) if something slips through that this list doesn't catch.
 */
const RESERVED = new Set([
  "panda",
  "pandapad",
  "panda-pad",
  "admin",
  "administrator",
  "official",
  "oficial",
  "support",
  "soporte",
  "staff",
  "team",
  "equipo",
  "mod",
  "moderator",
  "moderador",
  "root",
  "system",
  "sistema",
  "security",
  "seguridad",
  "help",
  "ayuda",
  "www",
  "api",
  "r",
  // A short, non-exhaustive profanity/slur list (EN/ES) — intentionally not expanded further here.
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "puta",
  "puto",
  "mierda",
  "gilipollas",
  "maricon",
  "maricón",
  "negro2",
]);

export type CodeProblem = "too_short" | "too_long" | "bad_format" | "reserved";

/** The first problem with `code` (not yet lowercased — this does that), or null if the format/word-list check passes. */
export function recruiterCodeProblem(code: string): CodeProblem | null {
  const c = code.trim().toLowerCase();
  if (c.length < MIN_LEN) return "too_short";
  if (c.length > MAX_LEN) return "too_long";
  if (!FORMAT.test(c)) return "bad_format";
  if (RESERVED.has(c)) return "reserved";
  return null;
}

/** Normalizes to the exact form stored/looked-up — lowercase, trimmed. Call this before every DB read/write. */
export function normalizeRecruiterCode(code: string): string {
  return code.trim().toLowerCase();
}

export function isValidRecruiterCode(code: string): boolean {
  return recruiterCodeProblem(code) === null;
}
