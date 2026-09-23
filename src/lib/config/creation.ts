import { parseNetwork } from "./network";
import type { Env } from "./env";

/**
 * Coin creation is held back on mainnet until the treasury is a multisig. The treasury address is written into the
 * on-chain fee-sharing config of EVERY coin created (PANDA's 5% share), and that cannot be corrected afterwards for coins
 * that already exist — so no real coin is created before the address is the final, multisig one. Trading is not affected.
 *
 * TREASURY_IS_MULTISIG is the owner's own declaration ("true" once NEXT_PUBLIC_PANDA_TREASURY is a Squads vault): the code
 * cannot verify from the chain that an address is a multisig, so this is an attestation, not a check.
 */
export type CoinCreationDecision = { allowed: true } | { allowed: false; reason: "treasury_not_multisig" };

export function decideCoinCreation(env: Env = process.env): CoinCreationDecision {
  if (parseNetwork(env.NETWORK) === "mainnet" && env.TREASURY_IS_MULTISIG !== "true") return { allowed: false, reason: "treasury_not_multisig" };
  return { allowed: true };
}

export const COIN_CREATION_BLOCKED_MESSAGE =
  "Creating coins is paused: on mainnet PANDA's treasury must be a multisig first (the address that receives PANDA's 5% share is written into every coin's on-chain config and can't be changed afterwards). Trading is not affected.";
