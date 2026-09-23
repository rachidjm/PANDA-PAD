import { Connection } from "@solana/web3.js";
import { moneyFlowEnvProblems, type Env } from "./env";

/**
 * The network guard. A trade built while the server's RPC points at a different chain than the one PANDA is meant to
 * run on is the worst kind of mistake (a devnet RPC quietly "working" on a mainnet deployment, or the reverse), so
 * before anything that moves money is built, the RPC's own genesis hash is compared with the one NETWORK names.
 * Both hashes were read from the clusters' public RPCs (getGenesisHash) when this was written.
 */

export type Network = "mainnet" | "devnet";

export const GENESIS_HASH: Record<Network, string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
};

export function parseNetwork(v: string | undefined): Network | null {
  return v === "mainnet" || v === "devnet" ? v : null;
}

export function networkFromGenesis(hash: string): Network | "other" {
  return hash === GENESIS_HASH.mainnet ? "mainnet" : hash === GENESIS_HASH.devnet ? "devnet" : "other";
}

export type NetworkState = "ok" | "mismatch" | "not_configured" | "unverified";
export type NetworkStatus = { state: NetworkState; expected: Network | null; detected: Network | "other" | null };

/** Pure: compares what NETWORK says with what the RPC reports. `getGenesisHash` throwing means the RPC couldn't be asked. */
export async function evaluateNetwork(expected: Network | null, getGenesisHash: () => Promise<string>): Promise<NetworkStatus> {
  if (!expected) return { state: "not_configured", expected: null, detected: null };
  try {
    const detected = networkFromGenesis(await getGenesisHash());
    return { state: detected === expected ? "ok" : "mismatch", expected, detected };
  } catch {
    return { state: "unverified", expected, detected: null };
  }
}

// A correct answer is cached for a minute (the genesis hash never changes; the RPC configuration can); a failed check only
// for a few seconds, so a flaky RPC doesn't keep money flows blocked longer than the flake.
const OK_TTL_MS = 60_000;
const FAIL_TTL_MS = 5_000;
let cached: { key: string; status: NetworkStatus; expires: number } | null = null;

export async function getNetworkStatus(rpcUrl: string, env: Env = process.env): Promise<NetworkStatus> {
  const expected = parseNetwork(env.NETWORK);
  const key = `${rpcUrl}|${expected}`;
  if (cached && cached.key === key && cached.expires > Date.now()) return cached.status;
  const status = await evaluateNetwork(expected, () => new Connection(rpcUrl, "confirmed").getGenesisHash());
  cached = { key, status, expires: Date.now() + (status.state === "ok" || status.state === "mismatch" ? OK_TTL_MS : FAIL_TTL_MS) };
  return status;
}

export type MoneyFlowBlock =
  | { blocking: false }
  | { blocking: true; reason: "network_mismatch" | "network_not_configured" | "network_unverified" | "env_missing"; expected: Network | null; detected: Network | "other" | null };

/**
 * Whether a flow that moves money may run right now. In production it needs NETWORK, SOLANA_RPC_URL and the treasury
 * configured AND the RPC on the network NETWORK names. Outside production a missing NETWORK / RPC / treasury only warns
 * (so local development keeps working with no .env), but a NETWORK that IS set is always enforced.
 */
export function decideMoneyFlow(status: NetworkStatus, env: Env = process.env): MoneyFlowBlock {
  const production = env.NODE_ENV === "production";
  if (status.state === "mismatch") return { blocking: true, reason: "network_mismatch", expected: status.expected, detected: status.detected };
  if (status.state === "unverified") return { blocking: true, reason: "network_unverified", expected: status.expected, detected: null };
  if (production) {
    if (status.state === "not_configured") return { blocking: true, reason: "network_not_configured", expected: null, detected: null };
    if (moneyFlowEnvProblems(env).length > 0) return { blocking: true, reason: "env_missing", expected: status.expected, detected: status.detected };
  }
  return { blocking: false };
}
