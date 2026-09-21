import { PANDA_FEE_BPS } from "@/lib/pump/constants";

/**
 * What a buy really needs in the wallet, so the app can say "you don't have enough" BEFORE anything is signed
 * (a transaction that runs out of SOL fails on-chain and still costs the network fee).
 *
 * needed = amount + PANDA's fee (added on top of the amount) + a cushion for the network fee and for the token
 * accounts a first trade may have to open (a token account costs ~0.002 SOL of rent; a swap can open two).
 */
export const NETWORK_BUFFER_SOL = 0.006;
/** Selling needs only the network fee (PANDA's fee is taken from the proceeds). */
export const SELL_MIN_SOL = 0.0005;

export const feeMultiplier = (feeBps: number = PANDA_FEE_BPS) => 1 + feeBps / 10_000;

/** SOL that must be in the wallet to buy `amountSol` worth. */
export function requiredSolForBuy(amountSol: number, feeBps: number = PANDA_FEE_BPS): number {
  if (!Number.isFinite(amountSol) || amountSol <= 0) return 0;
  return amountSol * feeMultiplier(feeBps) + NETWORK_BUFFER_SOL;
}

/** The most that can be bought with `balanceSol`, rounded DOWN to 4 decimals so it never asks for more than there is. */
export function maxBuyAmount(balanceSol: number, feeBps: number = PANDA_FEE_BPS): number {
  if (!Number.isFinite(balanceSol) || balanceSol <= NETWORK_BUFFER_SOL) return 0;
  const raw = (balanceSol - NETWORK_BUFFER_SOL) / feeMultiplier(feeBps);
  return Math.floor(raw * 10_000 + 1e-9) / 10_000;
}

/** Null when the buy is affordable (or the balance isn't known); otherwise what is missing and the most that can be bought. */
export function buyShortfall(amountSol: number, balanceSol: number | null, feeBps: number = PANDA_FEE_BPS): { need: number; have: number; max: number } | null {
  if (balanceSol === null || !(amountSol > 0)) return null;
  const need = requiredSolForBuy(amountSol, feeBps);
  return need > balanceSol ? { need, have: balanceSol, max: maxBuyAmount(balanceSol, feeBps) } : null;
}
