/**
 * Scrubs anything secret-looking out of an object before it is written to the
 * audit log (or any log). Keys are matched by name — values can't be reliably
 * told apart (a Solana transaction signature and a secret key are both ~88
 * base58 characters), so callers must also never pass secrets in at all; this
 * is the backstop, not the plan.
 */

const SECRET_KEY = /secret|private|seed|mnemonic|password|passphrase|authoriz|cookie|api[-_]?key|credential/i;
const EXACT_SECRET_KEY = /^(token|accesstoken|authtoken|jwt|bearer|sig_secret)$/i;

const MAX_DEPTH = 6;
const MAX_STRING = 500;
const MAX_KEYS = 50;
const MAX_ITEMS = 50;

export const REDACTED = "[REDACTED]";

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[max depth]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      out[k] = SECRET_KEY.test(k) || EXACT_SECRET_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
