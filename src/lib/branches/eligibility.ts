import { BRANCH_CONFIG as C } from "./config";

/**
 * Can this creator open a branch in this theme? Measured from PANDA's own verified sales (never from anything the
 * client sends), and deliberately not "simple volume alone": a sale only counts when it looks like genuine demand.
 * A sale does NOT count when
 *   - the buyer is the seller or the creator (self-purchase);
 *   - the buyer already owned that NFT before (it came back: the classic wash pattern);
 *   - the buyer or seller has any abuse flag (a review, restriction or disqualification);
 *   - the buyer didn't hold it for the minimum time (a quick flip is not sustained interest).
 * Counted sales give the unique buyers and the legitimate volume. Pure.
 */

export type EligibilitySale = { assetAddress: string; buyer: string; seller: string; creator: string; priceLamports: number; status: string; ts: number };

export type Criterion = { key: "uniqueBuyers" | "volume" | "noFlags"; required: number; actual: number; met: boolean };

export type Eligibility = {
  eligible: boolean;
  criteria: Criterion[];
  uniqueBuyers: number;
  volumeLamports: number;
  /** The creator's best-selling NFT by counted volume: the "successful NFT" the branch continues. */
  rootAsset: string | null;
  /** Sales that did NOT count, by reason — so a creator can see why. */
  excluded: { selfPurchase: number; returnedOwner: number; flagged: number; heldTooShort: number };
  configVersion: string;
};

export function evaluateEligibility(args: {
  creator: string;
  sales: EligibilitySale[];
  now: number;
  /** Every wallet with an abuse status other than NORMAL. */
  flagged: ReadonlySet<string>;
  cfg?: { minUniqueBuyers: number; minVolumeLamports: number; minHoldMs: number };
}): Eligibility {
  const { creator, now, flagged } = args;
  const cfg = args.cfg ?? C.eligibility;

  const mine = args.sales.filter((s) => s.status === "COMPLETED" && s.creator === creator && Number.isFinite(s.ts) && Number.isSafeInteger(s.priceLamports) && s.priceLamports > 0);
  const byAsset = new Map<string, EligibilitySale[]>();
  for (const s of mine) byAsset.set(s.assetAddress, [...(byAsset.get(s.assetAddress) ?? []), s]);

  const excluded = { selfPurchase: 0, returnedOwner: 0, flagged: 0, heldTooShort: 0 };
  const buyers = new Set<string>();
  let volume = 0;
  let root: { asset: string; volume: number } | null = null;

  for (const [asset, list] of byAsset) {
    const sales = [...list].sort((a, b) => a.ts - b.ts);
    const owners = new Set<string>([creator]);
    let assetVolume = 0;
    sales.forEach((s, i) => {
      const heldUntil = i + 1 < sales.length ? sales[i + 1].ts : now;
      const seenBefore = owners.has(s.buyer);
      owners.add(s.buyer);
      owners.add(s.seller);

      if (s.buyer === s.seller || s.buyer === creator) return void excluded.selfPurchase++;
      if (seenBefore) return void excluded.returnedOwner++;
      if (flagged.has(s.buyer) || flagged.has(s.seller)) return void excluded.flagged++;
      if (heldUntil - s.ts < cfg.minHoldMs) return void excluded.heldTooShort++;

      buyers.add(s.buyer);
      volume += s.priceLamports;
      assetVolume += s.priceLamports;
    });
    if (assetVolume > 0 && (!root || assetVolume > root.volume || (assetVolume === root.volume && asset < root.asset))) root = { asset, volume: assetVolume };
  }

  const creatorClean = !flagged.has(creator);
  const criteria: Criterion[] = [
    { key: "uniqueBuyers", required: cfg.minUniqueBuyers, actual: buyers.size, met: buyers.size >= cfg.minUniqueBuyers },
    { key: "volume", required: cfg.minVolumeLamports, actual: volume, met: volume >= cfg.minVolumeLamports },
    { key: "noFlags", required: 1, actual: creatorClean ? 1 : 0, met: creatorClean },
  ];
  return {
    eligible: criteria.every((c) => c.met),
    criteria,
    uniqueBuyers: buyers.size,
    volumeLamports: volume,
    rootAsset: root?.asset ?? null,
    excluded,
    configVersion: C.version,
  };
}
