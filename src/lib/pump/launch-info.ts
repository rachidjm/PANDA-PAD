/**
 * The figures Create shows next to the form (the live preview's key facts and the cost summary). None is made up:
 *
 *   - supply and the graduation point come from Pump.fun's own on-chain Global account (the curve's starting reserves);
 *   - what creating the coin costs is MEASURED: the very launch transaction PANDA builds is simulated against the
 *     network and the payer's balance read back (src/app/api/pump/launch-info). It is rent for the coin's accounts on
 *     Solana plus the network fee — Pump.fun's Global has no creation fee, and a real launch shows none.
 *
 * The numbers below are only what is shown when the network can't be asked: the curve's long-standing parameters, and
 * the cost of a real PANDA launch and of its first buy (8 Oct 2026), lamport for lamport.
 */

export type CurveStart = { initialVirtualSolReserves: bigint; initialVirtualTokenReserves: bigint; initialRealTokenReserves: bigint; tokenTotalSupply: bigint };

export const FALLBACK_CURVE: CurveStart = {
  initialVirtualSolReserves: BigInt(30_000_000_000),
  initialVirtualTokenReserves: BigInt("1073000000000000"),
  initialRealTokenReserves: BigInt("793100000000000"),
  tokenTotalSupply: BigInt("1000000000000000"),
};
export const PUMP_TOKEN_DECIMALS = 6;

/** A real launch through PANDA (create + fee split, one transaction): the coin's accounts and the network fee. */
export const FALLBACK_CREATE_LAMPORTS = 11_638_120;
/** What a creator's first buy adds on top of the purchase itself and PANDA's trade fee: one new account and the network fee. */
export const FIRST_BUY_EXTRA_LAMPORTS = 1_548_840;

/**
 * The SOL that has to be bought into the curve (net of trading fees) for the coin to graduate: the curve is
 * constant-product on its virtual reserves and completes when its real token reserves are sold out.
 */
export function graduationLamports(c: CurveStart): bigint {
  const left = c.initialVirtualTokenReserves - c.initialRealTokenReserves;
  if (left <= BigInt(0)) return BigInt(0);
  const k = c.initialVirtualSolReserves * c.initialVirtualTokenReserves;
  // Rounded up: the last lamport that empties the curve.
  return (k + left - BigInt(1)) / left - c.initialVirtualSolReserves;
}

export type LaunchInfo = {
  /** Whole tokens. */
  supply: number;
  graduationSol: number;
  createLamports: number;
  firstBuyExtraLamports: number;
  /** False when a figure is the stored reference instead of a fresh reading. */
  live: { curve: boolean; cost: boolean };
};

/** A simulated cost is used only when it is believable: between a tenth and ten times the measured reference. */
export function plausibleCreateCost(lamports: number): boolean {
  return Number.isFinite(lamports) && lamports >= FALLBACK_CREATE_LAMPORTS / 10 && lamports <= FALLBACK_CREATE_LAMPORTS * 10;
}

export function launchInfo(curve: CurveStart | null, createLamports: number | null): LaunchInfo {
  const c = curve ?? FALLBACK_CURVE;
  const cost = createLamports !== null && plausibleCreateCost(createLamports) ? createLamports : null;
  return {
    supply: Number(c.tokenTotalSupply / BigInt(10 ** PUMP_TOKEN_DECIMALS)),
    graduationSol: Number(graduationLamports(c)) / 1e9,
    createLamports: cost ?? FALLBACK_CREATE_LAMPORTS,
    firstBuyExtraLamports: FIRST_BUY_EXTRA_LAMPORTS,
    live: { curve: !!curve, cost: cost !== null },
  };
}

export const FALLBACK_LAUNCH_INFO: LaunchInfo = launchInfo(null, null);

/** Everything a launch takes from the wallet, in SOL: the first buy, PANDA's trade fee on it, and the accounts and network fees. */
export function launchCost(info: LaunchInfo, firstBuySol: number, feeBps: number): { firstBuy: number; pandaFee: number; network: number; total: number } {
  const firstBuy = Number.isFinite(firstBuySol) && firstBuySol > 0 ? firstBuySol : 0;
  const pandaFee = (firstBuy * feeBps) / 10_000;
  const network = (info.createLamports + (firstBuy > 0 ? info.firstBuyExtraLamports : 0)) / 1e9;
  return { firstBuy, pandaFee, network, total: firstBuy + pandaFee + network };
}
