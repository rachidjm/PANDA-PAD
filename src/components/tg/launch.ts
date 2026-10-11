/**
 * A coin being created in the Mini App, written down for the minutes it takes (its public address — nothing else).
 *
 * The wallet app sends the launch itself; PANDA's records of it (the "Launched on PANDA" list, the fee registry) are
 * written when the Mini App hears back. If Telegram restarts the app on the way back from the wallet, that moment is
 * lost — so on its next start the app asks whether that coin now exists, finishes the records and opens its page.
 */
const KEY = "panda.tg.launch";
const MAX_AGE_MS = 30 * 60_000;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function notePendingLaunch(mint: string, now: number = Date.now()): void {
  try {
    if (MINT.test(mint)) localStorage.setItem(KEY, JSON.stringify({ mint, at: now }));
  } catch {}
}

export function clearPendingLaunch(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function pendingLaunch(now: number = Date.now()): { mint: string; at: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as { mint?: unknown; at?: unknown } | null;
    if (v && typeof v.mint === "string" && MINT.test(v.mint) && typeof v.at === "number" && now - v.at <= MAX_AGE_MS) return { mint: v.mint, at: v.at };
    if (v) clearPendingLaunch();
  } catch {}
  return null;
}

type Api = (path: string) => Promise<Response>;
type Post = (path: string, body: unknown) => Promise<unknown>;
const send: Post = (path, body) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined);

/** The address of the coin that was being created, once it is known to exist (its records are completed here); null otherwise. */
export async function takePendingLaunch(api: Api, now: number = Date.now(), post: Post = send): Promise<string | null> {
  const pending = pendingLaunch(now);
  if (!pending) return null;
  const res = await api(`/api/tg/launch?mint=${pending.mint}`);
  if (!res.ok) return null; // asked again on the next start
  const data = (await res.json().catch(() => null)) as { signature?: string | null } | null;
  if (!data?.signature) {
    // Not on the chain: the launch was cancelled in the wallet. Given a few minutes (a slow confirmation), then forgotten.
    if (now - pending.at > 5 * 60_000) clearPendingLaunch();
    return null;
  }
  // The same calls the create form makes when it hears back itself; each one re-checks the chain on the server.
  await post("/api/launch/record", { mint: pending.mint, signature: data.signature });
  await post("/api/pump/register-fee-distribution", { mint: pending.mint });
  clearPendingLaunch();
  return pending.mint;
}
