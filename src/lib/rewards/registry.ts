import { readJson, writeJson } from "./blob-store";

const REGISTRY_PATH = "rewards/registry.json";

type Registry = { mints: string[] };

/**
 * The real (but lightweight) list of mints the rewards distributor should
 * process — written only after `src/lib/pump/fee-sharing.ts`'s
 * `getFeeSharingConfig` confirms a real on-chain SharingConfig exists (see
 * src/app/api/pump/register-fee-distribution/route.ts), never trusted from
 * the client alone.
 */
export async function getRegisteredMints(): Promise<string[]> {
  const registry = await readJson<Registry>(REGISTRY_PATH, { mints: [] });
  return registry.mints;
}

export async function registerMint(mint: string): Promise<void> {
  const registry = await readJson<Registry>(REGISTRY_PATH, { mints: [] });
  if (registry.mints.includes(mint)) return;
  registry.mints.push(mint);
  await writeJson(REGISTRY_PATH, registry);
}
