import { bpsOf } from "@/lib/money/bps";

/**
 * How a sale price is divided. Integer lamports only; the parts always add up to
 * the price exactly. Both the transaction builder and the on-chain verifier
 * derive their list of payments from the SAME function (`saleTransfers`), so
 * what is built and what is checked can't drift apart.
 *
 *  - fee      : PANDA's marketplace fee, on every sale;
 *  - royalty  : the creator's royalty (from the NFT's own on-chain Royalties
 *               plugin), on SECONDARY sales only — when the creator sells
 *               their own NFT for the first time there is no one to pay it to;
 *  - seller   : everything else.
 */

export type SaleKind = "primary" | "secondary";

/** Primary = the creator selling their own NFT for the first time. Everything else is secondary. */
export function saleKind(args: { seller: string; creator: string; priorSales: number }): SaleKind {
  return args.seller === args.creator && args.priorSales === 0 ? "primary" : "secondary";
}

export type RoyaltyCreator = { address: string; percentage: number };

export type Split = {
  kind: SaleKind;
  price: number;
  feeLamports: number;
  royaltyLamports: number;
  sellerLamports: number;
  royaltyPayouts: { address: string; lamports: number }[];
};

export function computeSplit(args: {
  priceLamports: number;
  feeBps: number;
  royaltyBps: number;
  creators: RoyaltyCreator[];
  kind: SaleKind;
}): Split {
  const { priceLamports, feeBps, royaltyBps, creators, kind } = args;
  if (!Number.isSafeInteger(priceLamports) || priceLamports <= 0) throw new RangeError("Price must be a positive integer number of lamports.");
  if (!Number.isSafeInteger(feeBps) || !Number.isSafeInteger(royaltyBps)) throw new RangeError("Basis points must be integers.");
  if (feeBps + royaltyBps > 10_000) throw new RangeError("Fee plus royalty can't exceed the price.");
  if (creators.length === 0 || creators.reduce((s, c) => s + c.percentage, 0) !== 100 || creators.some((c) => !Number.isInteger(c.percentage) || c.percentage < 0)) {
    throw new RangeError("Royalty creators must be whole percentages summing to 100.");
  }

  const price = BigInt(priceLamports);
  const feeLamports = Number(bpsOf(price, feeBps));
  const royaltyLamports = kind === "secondary" ? Number(bpsOf(price, royaltyBps)) : 0;

  // Each creator gets their whole-percent share, rounded down; the rounding leftovers go to the first creator so nothing is lost.
  const payouts = creators.map((c) => ({ address: c.address, lamports: Math.floor((royaltyLamports * c.percentage) / 100) }));
  payouts[0].lamports += royaltyLamports - payouts.reduce((s, p) => s + p.lamports, 0);

  const sellerLamports = priceLamports - feeLamports - royaltyLamports;
  return { kind, price: priceLamports, feeLamports, royaltyLamports, sellerLamports, royaltyPayouts: payouts.filter((p) => p.lamports > 0) };
}

export type Transfer = { from: string; to: string; lamports: number };

/**
 * The exact SOL payments a sale consists of, buyer -> {seller, creators, PANDA}.
 * A royalty owed to the seller themselves (a creator reselling) is folded into
 * the seller's payment; zero amounts and pay-yourself transfers are omitted.
 */
export function saleTransfers(split: Split, parties: { buyer: string; seller: string; treasury: string }): Transfer[] {
  const { buyer, seller, treasury } = parties;
  let toSeller = split.sellerLamports;
  const out: Transfer[] = [];
  for (const p of split.royaltyPayouts) {
    if (p.address === seller) toSeller += p.lamports;
    else out.push({ from: buyer, to: p.address, lamports: p.lamports });
  }
  if (toSeller > 0) out.unshift({ from: buyer, to: seller, lamports: toSeller });
  if (split.feeLamports > 0) out.push({ from: buyer, to: treasury, lamports: split.feeLamports });
  return out.filter((t) => t.from !== t.to);
}
