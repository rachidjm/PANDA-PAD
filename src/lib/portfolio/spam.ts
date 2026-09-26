/**
 * Wallet apps hide the junk that gets airdropped to every wallet (a "token" named like an advertisement, with a website in its name). Same here:
 * a token whose name or symbol is a link/ad — a domain, a URL, or a sentence — is listed under "hidden" (still one click away, never deleted
 * or counted in the total unless it has a real price). Being unpriced alone is NOT a reason to hide a token: a brand-new coin has no price yet.
 */
const DOMAIN = /\b[a-z0-9-]+\.(io|com|net|org|xyz|app|fun|ai|gg|cc|me|co|site|online|to|so)\b/i;
const URLISH = /https?:\/\/|www\./i;
const MAX_SYMBOL = 14;

export function looksLikeSpam(token: { symbol?: string; name?: string }): boolean {
  const symbol = token.symbol ?? "";
  const name = token.name ?? "";
  if (DOMAIN.test(symbol) || DOMAIN.test(name) || URLISH.test(symbol) || URLISH.test(name)) return true;
  if (symbol.length > 24) return true; // a symbol is a short ticker; a paragraph is an ad
  const words = name.trim().split(/\s+/).filter(Boolean).length;
  return words >= 7;
}

/** A label that fits a row: cut with an ellipsis instead of stretching the layout. */
export function clipLabel(text: string, max = MAX_SYMBOL): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
