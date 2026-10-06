/**
 * Phantom's universal "browse" link — the same format @solana/wallet-adapter-phantom uses to open a page inside the
 * Phantom app's own browser. `pageUrl` is the page the user is on right now. A typed recruiter code (`?code=`) and a
 * recruiter's `?ref=` travel inside the target URL, because the in-app browser has its own storage and would
 * otherwise lose them.
 */
export function phantomBrowseUrl(
  pageUrl: string,
  origin: string,
  options: { code?: string | null; ref?: string | null } = {}
): string {
  const target = new URL(pageUrl);
  if (options.code) target.searchParams.set("code", options.code);
  if (options.ref && !target.searchParams.has("ref")) target.searchParams.set("ref", options.ref);
  return `https://phantom.app/ul/browse/${encodeURIComponent(target.toString())}?ref=${encodeURIComponent(origin)}`;
}
