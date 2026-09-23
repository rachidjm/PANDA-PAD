import { listPaths, readJson } from "@/lib/rewards/blob-store";
import { docListPaths, docRead } from "@/lib/storage/store";
import type { Ledger } from "@/lib/rewards/ledger";
import type { LoggedTrade } from "@/lib/portfolio/trade-log";
import type { StoredEvent } from "@/lib/activity/types";
import type { DayDoc, TotalDoc } from "@/lib/economy/rollup";
import { EMPTY_PAUSE_STATE, type PauseState } from "@/lib/protocol/pause";

/**
 * A read-only view of everything the migrated domains keep in Vercel Blob. The backfill and the comparator both read through
 * this, so tests can feed them a fake and the real thing (`blobSource`) is used by the scripts. It never writes.
 */
export interface BlobSource {
  registry(): Promise<string[]>;
  ledger(mint: string): Promise<Ledger>;
  payoutDay(): Promise<{ date: string; lamports: number } | null>;
  tradeWallets(): Promise<string[]>;
  trades(wallet: string): Promise<LoggedTrade[]>;
  backfillMarks(): Promise<{ wallet: string; at: number }[]>;
  /** Every journal document: the UTC day it was written and its events. */
  journal(): Promise<{ day: string; events: StoredEvent[] }[]>;
  economyDays(): Promise<DayDoc[]>;
  economyTotal(): Promise<TotalDoc | null>;
  pause(): Promise<PauseState>;
}

const base = (prefix: string, suffix = ".json") => (p: string) => p.slice(prefix.length, p.length - suffix.length);

export function blobSource(): BlobSource {
  return {
    registry: async () => (await readJson<{ mints: string[] }>("rewards/registry.json", { mints: [] })).mints,
    ledger: (mint) => readJson<Ledger>(`rewards/ledger/${mint}.json`, { mint, totalDistributedLamports: 0, holders: {} }),
    payoutDay: () => readJson<{ date: string; lamports: number } | null>("rewards/payout-day.json", null),
    tradeWallets: async () => (await listPaths("portfolio/trades/")).map(base("portfolio/trades/")),
    trades: (wallet) => readJson<LoggedTrade[]>(`portfolio/trades/${wallet}.json`, []),
    backfillMarks: async () => {
      const wallets = (await listPaths("portfolio/backfill/")).map(base("portfolio/backfill/"));
      const out: { wallet: string; at: number }[] = [];
      for (const wallet of wallets) {
        const m = await readJson<{ at: number } | null>(`portfolio/backfill/${wallet}.json`, null);
        if (m) out.push({ wallet, at: m.at });
      }
      return out;
    },
    journal: async () => {
      const days = (await docListPaths("activity/journal/")).map(base("activity/journal/"));
      return Promise.all(days.map(async (day) => ({ day, events: (await docRead<{ events: StoredEvent[] }>(`activity/journal/${day}.json`, { events: [] })).events })));
    },
    economyDays: async () => {
      const days = (await docListPaths("economy/daily/")).map(base("economy/daily/"));
      return Promise.all(days.map((day) => docRead<DayDoc>(`economy/daily/${day}.json`, { version: 1, day, metrics: {} as DayDoc["metrics"] })));
    },
    economyTotal: () => docRead<TotalDoc | null>("economy/total.json", null),
    pause: () => readJson<PauseState>("protocol/pause.json", EMPTY_PAUSE_STATE),
  };
}
