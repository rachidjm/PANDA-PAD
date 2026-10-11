/**
 * What the Mini App has already downloaded, kept while it is open: a screen that was seen once is on screen again the
 * instant it is asked for, and is quietly brought up to date behind. One request per address at a time, however many
 * parts of a screen ask for it.
 */

type Entry = { data: unknown; at: number };
const entries = new Map<string, Entry>();
const errors = new Set<string>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;
const tell = () => {
  version++;
  listeners.forEach((l) => l());
};
export const cacheVersion = () => version;
export const subscribeCache = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

/** How old something may be before the screen showing it asks again (it is shown meanwhile either way). */
export const FRESH_MS = 15_000;

export const cacheFailed = (key: string) => errors.has(key) && !entries.has(key);
export const cached = <T,>(key: string): T | undefined => entries.get(key)?.data as T | undefined;
export function putCached(key: string, data: unknown, now: number = Date.now()): void {
  entries.set(key, { data, at: now });
  errors.delete(key);
  tell();
}
export const isFresh = (key: string, now: number = Date.now()) => now - (entries.get(key)?.at ?? -Infinity) < FRESH_MS;

type Api = (path: string) => Promise<Response>;
/** Downloads `key` once (a second caller gets the same download). */
export function refresh(api: Api, key: string): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  const run = api(key)
    .then(async (res) => {
      const data = (await res.json().catch(() => null)) as unknown;
      if (res.ok && data) putCached(key, data);
      else {
        errors.add(key);
        tell();
      }
    })
    .catch(() => {
      errors.add(key);
      tell();
    })
    .finally(() => void inflight.delete(key));
  inflight.set(key, run);
  return run;
}

export type KnownCoin = { mint: string; ticker: string | null; name: string | null; image: string | null; priceUsd: number | null; marketCap: number | null; change24h: number | null };
/** A coin as some list already showed it: what its page puts on screen while its own data is on the way. */
export function knownCoin(mint: string): KnownCoin | null {
  for (const { data } of entries.values()) {
    const d = data as { coins?: KnownCoin[]; items?: KnownCoin[] } | null;
    const hit = (d?.coins ?? d?.items)?.find?.((c) => c?.mint === mint);
    if (hit) return hit;
  }
  return null;
}

export function clearTgCache(): void {
  entries.clear();
  errors.clear();
  tell();
}

export const WATCHLIST = "/api/tg/watchlist";
export const ALERTS = "/api/tg/alerts";
/** The screens that need nothing but the Telegram session: they can be shown before the wallet code has arrived. */
export const isListPath = (pathname: string | null) => pathname === "/tg" || pathname === "/tg/watchlist" || pathname === "/tg/alerts";
/** What the first lists are read from: asked for as soon as Telegram's sign-in is done, so each screen opens with its data already there. */
export const FIRST_LISTS = ["/api/tg/coins?tab=trending", "/api/tg/coins?tab=new", WATCHLIST, ALERTS];
