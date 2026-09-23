import { readJson, updateJson } from "./blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgGetRegisteredMints, pgRegisterMint } from "@/lib/db/rewards";

const REGISTRY_PATH = "rewards/registry.json";

type Registry = { mints: string[] };

/**
 * The real (but lightweight) list of mints the rewards distributor should
 * process — written only after `src/lib/pump/fee-sharing.ts`'s
 * `getFeeSharingConfig` confirms a real on-chain SharingConfig exists (see
 * src/app/api/pump/register-fee-distribution/route.ts), never trusted from
 * the client alone. Lives in Blob, Blob + Postgres, or Postgres per PANDA_STORAGE_MODES (src/lib/db/mode.ts).
 */
export async function getRegisteredMints(): Promise<string[]> {
  if (storageMode("rewards") === "postgres") return pgGetRegisteredMints(getDb());
  const registry = await readJson<Registry>(REGISTRY_PATH, { mints: [] });
  return registry.mints;
}

export async function registerMint(mint: string): Promise<void> {
  const mode = storageMode("rewards");
  if (mode !== "postgres") {
    await updateJson<Registry, void>(REGISTRY_PATH, { mints: [] }, (registry) => {
      if (!registry.mints.includes(mint)) registry.mints.push(mint);
      return { next: registry, result: undefined };
    });
  }
  if (mode === "postgres") await pgRegisterMint(getDb(), mint);
  else if (mode === "dual") await mirror("rewards", `register ${mint}`, () => pgRegisterMint(getDb(), mint));
}
