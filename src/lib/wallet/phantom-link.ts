/**
 * Phantom's universal "browse" link — the same format @solana/wallet-adapter-phantom uses to open a page inside the
 * Phantom app's own browser. `pageUrl` is the page the user is on right now; a typed recruiter code rides along as
 * `?code=` because the in-app browser has its own storage and would otherwise lose it.
 */
export function phantomBrowseUrl(pageUrl: string, origin: string, recruiterCode?: string | null): string {
  const target = new URL(pageUrl);
  if (recruiterCode) target.searchParams.set("code", recruiterCode);
  return `https://phantom.app/ul/browse/${encodeURIComponent(target.toString())}?ref=${encodeURIComponent(origin)}`;
}
