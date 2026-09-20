import { Connection } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { getRegisteredMints } from "@/lib/rewards/registry";
import { getLedger } from "@/lib/rewards/ledger";
import { getEpochs } from "@/lib/points/store";
import { claimedTotals, loadVerifiedAllocation } from "@/lib/airdrop/store";
import { pandaMint } from "@/lib/airdrop/solana-chain";
import { listThemes } from "@/lib/themes/store";
import { listSales } from "@/lib/market/store";
import { readDays, readTotal } from "./rollup";
import type { AirdropEpoch, EconomyDeps } from "./snapshot";

/** Rewards ledgers read per request (each is a storage read). */
const MAX_LEDGERS = 120;
/** Airdrop claim records read per request across all epochs. */
const MAX_CLAIM_RECORDS = 1500;

async function decimalsOfPandaMint(): Promise<number | null> {
  const mint = pandaMint();
  if (!mint) return null;
  try {
    const info = await new Connection(serverRpcUrl(), "confirmed").getParsedAccountInfo(mint);
    const data = info.value?.data;
    const d = data && "parsed" in data ? (data.parsed as { info?: { decimals?: number } }).info?.decimals : undefined;
    return Number.isInteger(d) ? (d as number) : null;
  } catch {
    return null;
  }
}

export function realEconomyDeps(): EconomyDeps {
  return {
    now: () => Date.now(),
    total: readTotal,
    days: readDays,

    ledgers: async () => {
      const mints = await getRegisteredMints();
      const read = mints.slice(0, MAX_LEDGERS);
      const ledgers = [];
      for (let i = 0; i < read.length; i += 10) ledgers.push(...(await Promise.all(read.slice(i, i + 10).map(getLedger))));
      return { ledgers, partial: mints.length > read.length };
    },

    airdrops: async () => {
      const published = (await getEpochs()).filter((e) => e.merkleRoot);
      const epochs: AirdropEpoch[] = [];
      const unverified: number[] = [];
      let budget = MAX_CLAIM_RECORDS;
      let partial = false;
      for (const e of published) {
        const loaded = await loadVerifiedAllocation(e);
        if (loaded === null || loaded === "integrity") {
          unverified.push(e.id);
          continue;
        }
        const c = await claimedTotals(e.id, budget);
        budget -= c.read;
        if (c.truncated) partial = true;
        epochs.push({ epoch: e.id, distributed: loaded.set.distributed, claimed: c.claimed.toString(), claimedCount: c.count, leaves: loaded.set.entries.length });
      }
      return { epochs, partial, unverified, decimals: await decimalsOfPandaMint() };
    },

    sales: async () => {
      const themes = await listThemes();
      return (await Promise.all(themes.map((t) => listSales(t.themeId)))).flat();
    },
  };
}
