import { Connection, PublicKey, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import { bondingCurvePda, getSellSolAmountFromTokenAmount, isLegacyQuoteMint, PUMP_AMM_PROGRAM_ID, type BondingCurve } from "@pump-fun/pump-sdk";
import { sellBaseInput, type SwapSolanaState } from "@pump-fun/pump-swap-sdk";
import { getOnlinePumpSdk, getPumpSdk } from "@/lib/pump/client";
import { getOnlinePumpAmmSdk, getPumpAmmSdk } from "@/lib/pump/amm-client";
import { graduatedPoolFor } from "@/lib/pump/amm-trade";
import { tokenProgramForOwner } from "@/lib/pump/token-program";
import type { Venue } from "./math";

/**
 * Where a PANDA order sells, read from the chain (server-only): the Pump.fun bonding curve while it's live, the coin's
 * PumpSwap token/SOL pool once it has graduated. Anything else (another DEX, an inverted SOL/token pool, a curve or
 * pool quoted in something other than SOL) is NOT supported — those coins keep Jupiter Trigger.
 *
 * Each venue answers two questions with Pump's own SDK math (fees included, exactly what the program pays):
 * `quoteOut` — how many lamports selling N tokens pays right now; and `saleInstructions` — the sale itself with a
 * fixed minimum out (no slippage applied on top: the minimum IS the user's signed condition).
 */

type CurveVenue = {
  venue: "curve";
  mint: PublicKey;
  tokenProgram: PublicKey;
  global: Awaited<ReturnType<ReturnType<typeof getOnlinePumpSdk>["fetchGlobal"]>>;
  feeConfig: Awaited<ReturnType<ReturnType<typeof getOnlinePumpSdk>["fetchFeeConfig"]>>;
  bondingCurve: BondingCurve;
  bondingCurveAccountInfo: AccountInfo<Buffer>;
  curveAddress: PublicKey;
};
type AmmVenue = { venue: "amm"; mint: PublicKey; tokenProgram: PublicKey; pool: PublicKey; state: SwapSolanaState };
export type VenueState = CurveVenue | AmmVenue;
export type VenueError = "not_found" | "unsupported";

const wsol = (m: PublicKey) => m.equals(NATIVE_MINT);

/** The venue for `mint`, as seen by `user` (their token accounts are part of the AMM state). `poolHint` is the pool the
 *  app already knows for a graduated coin (it isn't always the canonical one); it's verified, never trusted. */
export async function loadVenue(connection: Connection, mint: PublicKey, user: PublicKey, poolHint?: PublicKey): Promise<VenueState | VenueError> {
  const mintInfo = await connection.getAccountInfo(mint);
  if (!mintInfo) return "not_found";
  const tokenProgram = tokenProgramForOwner(mintInfo.owner);
  if (!tokenProgram) return "not_found";

  const curveAddress = bondingCurvePda(mint);
  const curveInfo = await connection.getAccountInfo(curveAddress);
  const offline = getPumpSdk();
  const curve = curveInfo ? offline.decodeBondingCurveNullable(curveInfo) : null;
  if (curve && curveInfo && !curve.complete) {
    if (!isLegacyQuoteMint(curve.quoteMint)) return "unsupported";
    const online = getOnlinePumpSdk(connection);
    const [global, feeConfig] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig()]);
    return { venue: "curve", mint, tokenProgram, global, feeConfig, bondingCurve: curve, bondingCurveAccountInfo: curveInfo, curveAddress };
  }

  // Graduated (or never on the curve): its PumpSwap pool — the hint first, then the canonical address.
  for (const pool of [poolHint, graduatedPoolFor(mint)]) {
    if (!pool) continue;
    const info = await connection.getAccountInfo(pool);
    if (!info || !info.owner.equals(PUMP_AMM_PROGRAM_ID)) continue;
    const state = await getOnlinePumpAmmSdk(connection).swapSolanaState(pool, user);
    if (!state.pool.baseMint.equals(mint) || !wsol(state.pool.quoteMint)) return "unsupported";
    if (state.poolBaseAmount.isZero() || state.poolQuoteAmount.isZero()) return "unsupported";
    return { venue: "amm", mint, tokenProgram, pool, state };
  }
  return "unsupported";
}

/** Lamports that selling `amount` raw tokens pays right now on this venue, after Pump's own fees. */
export function quoteOut(v: VenueState, amount: bigint): bigint {
  if (amount <= BigInt(0)) return BigInt(0);
  const a = new BN(amount.toString());
  if (v.venue === "curve") {
    const out = getSellSolAmountFromTokenAmount({ global: v.global, feeConfig: v.feeConfig, mintSupply: v.bondingCurve.tokenTotalSupply, bondingCurve: v.bondingCurve, amount: a });
    return BigInt(out.toString());
  }
  const { pool } = v.state;
  const r = sellBaseInput({
    base: a,
    slippage: 0,
    baseReserve: v.state.poolBaseAmount,
    quoteReserve: v.state.poolQuoteAmount,
    virtualQuoteReserves: pool.virtualQuoteReserves,
    globalConfig: v.state.globalConfig,
    baseMintAccount: v.state.baseMintAccount,
    baseMint: v.state.baseMint,
    coinCreator: pool.coinCreator,
    creator: pool.creator,
    feeConfig: v.state.feeConfig,
    quoteMint: pool.quoteMint,
    isMayhemMode: pool.isMayhemMode,
    creatorFeeBps: pool.creatorFeeBps,
  });
  return BigInt(r.uiQuote.toString());
}

/** The sale of `amount` tokens for AT LEAST `minOut` lamports — nothing added on top: `minOut` is the signed condition. */
export async function saleInstructions(v: VenueState, user: PublicKey, amount: bigint, minOut: bigint): Promise<TransactionInstruction[]> {
  const a = new BN(amount.toString());
  const min = new BN(minOut.toString());
  if (v.venue === "curve") {
    return getPumpSdk().sellInstructions({
      global: v.global,
      bondingCurveAccountInfo: v.bondingCurveAccountInfo,
      bondingCurve: v.bondingCurve,
      mint: v.mint,
      user,
      amount: a,
      solAmount: min,
      slippage: 0, // the SDK subtracts `slippage`% from solAmount: 0 keeps the minimum exactly as signed
      tokenProgram: v.tokenProgram,
      mayhemMode: v.bondingCurve.isMayhemMode,
      cashback: v.bondingCurve.isCashbackCoin,
    });
  }
  return getPumpAmmSdk().sellInstructions(v.state, a, min);
}

/** The accounts whose data moves the price: re-read each watcher tick (one getMultipleAccounts for every coin). */
export function priceAccounts(v: VenueState): PublicKey[] {
  return v.venue === "curve" ? [v.curveAddress] : [v.state.pool.poolBaseTokenAccount, v.state.pool.poolQuoteTokenAccount];
}

/** A token account's amount (u64 at byte 64 — the same layout for the classic and the 2022 token programs). */
export function tokenAccountAmount(info: AccountInfo<Buffer> | null): BN | null {
  if (!info || info.data.length < 72) return null;
  return new BN(info.data.readBigUInt64LE(64).toString());
}

/** The venue with fresh reserves from `priceAccounts`' data. "migrated" when the curve has just completed. */
export function refreshVenue(v: VenueState, infos: (AccountInfo<Buffer> | null)[]): VenueState | "migrated" | null {
  if (v.venue === "curve") {
    const info = infos[0];
    if (!info) return null;
    const curve = getPumpSdk().decodeBondingCurveNullable(info);
    if (!curve) return null;
    if (curve.complete) return "migrated";
    return { ...v, bondingCurve: curve, bondingCurveAccountInfo: info };
  }
  const base = tokenAccountAmount(infos[0]);
  const quote = tokenAccountAmount(infos[1]);
  if (!base || !quote || base.isZero() || quote.isZero()) return null;
  return { ...v, state: { ...v.state, poolBaseAmount: base, poolQuoteAmount: quote } };
}

export const venueOf = (v: VenueState): Venue => v.venue;
