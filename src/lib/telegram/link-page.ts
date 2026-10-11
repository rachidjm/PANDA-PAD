/**
 * The wallet-linking page (/telegram/link) on a phone. Telegram opens it in the phone's own browser — where there is
 * no wallet. A wallet APP has a browser of its own in which it is available to the page, and an official link to open
 * any address in it. So the page offers to open ITSELF (same address, same one-time code) inside the wallet app.
 * Pure functions, no wallet library: the page reads this before anything else.
 */

export type LinkWalletApp = "phantom" | "solflare";
export const LINK_WALLET_APPS: { id: LinkWalletApp; label: string }[] = [
  { id: "phantom", label: "Phantom" },
  { id: "solflare", label: "Solflare" },
];

/**
 * The wallets' official "browse" links (Phantom: docs → Deeplinks → Other methods → Browse; Solflare implements the
 * same one): they open `pageUrl` in the wallet app's in-app browser. `ref` is the site asking.
 */
export function browseUrl(app: LinkWalletApp, pageUrl: string, origin: string): string {
  const base = app === "phantom" ? "https://phantom.app/ul/browse" : "https://solflare.com/ul/v1/browse";
  return `${base}/${encodeURIComponent(pageUrl)}?ref=${encodeURIComponent(origin)}`;
}

/** The linking page's own address for a code — and nothing else from wherever it was opened (no stray parameters travel into the wallet app). */
export function linkPageAddress(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/telegram/link?code=${encodeURIComponent(code)}`;
}

export const isPhone = (userAgent: string) => /Android|iPhone|iPad|iPod/i.test(userAgent);

/** Only brings the Telegram APP back to the front; it opens nothing in it (the Mini App there is still open, and notices the link by itself). */
export const BACK_TO_TELEGRAM = "tg://resolve";

export type LinkCodeState = "ok" | "expired" | "invalid";
/** What a code's record says before anyone signs: usable, already used / too old, or not a code at all. */
export function linkCodeState(rec: { usedAt: number | null; expiresAt: number } | null, now: number): LinkCodeState {
  if (!rec) return "invalid";
  return rec.usedAt !== null || rec.expiresAt <= now ? "expired" : "ok";
}
