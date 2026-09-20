import { PublicKey } from "@solana/web3.js";
import { CREATOR_CONFIGURABLE_MAX_BPS, PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { BPS_TOTAL } from "@/lib/money/bps";

/**
 * The creator's fee-split choices, as pure integer basis-point math (no
 * floats), turned into the exact shareholder list the on-chain config takes.
 * This only shapes and pre-checks what the Create form sends; the server
 * re-validates the final list independently (see fee-shares-validation.ts).
 */

export type FeeKind = "panda" | "creator" | "holders" | "partner";
export type FeeLine = { kind: FeeKind; address: string; bps: number };

export type FeePlan = {
  creatorBps: number;
  holdersBps: number;
  partnerBps: number;
  partnerAddress: string;
};

export type PlanContext = { creator: string; treasury: string; rewardsPool: string | null };

export type PlanIssue =
  | { code: "TOTAL_MISMATCH"; deltaBps: number } // positive = still unassigned, negative = over
  | { code: "HOLDERS_UNAVAILABLE" }
  | { code: "PARTNER_ADDRESS_INVALID" }
  | { code: "PARTNER_ADDRESS_DUPLICATE" };

/** "70" -> 7000, "12.5" -> 1250, "0.25" -> 25. Whole-string decimal with at most 2 decimals; anything else -> null. */
export function parsePercentToBps(input: string): number | null {
  const s = input.trim();
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps <= BPS_TOTAL ? bps : null;
}

/** 7000 -> "70", 1250 -> "12.5", 25 -> "0.25". */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function planLines(plan: FeePlan, ctx: PlanContext): FeeLine[] {
  const lines: FeeLine[] = [{ kind: "panda", address: ctx.treasury, bps: PANDA_SHARE_BPS }];
  if (plan.creatorBps > 0) lines.push({ kind: "creator", address: ctx.creator, bps: plan.creatorBps });
  if (plan.holdersBps > 0 && ctx.rewardsPool) lines.push({ kind: "holders", address: ctx.rewardsPool, bps: plan.holdersBps });
  if (plan.partnerBps > 0) lines.push({ kind: "partner", address: plan.partnerAddress.trim(), bps: plan.partnerBps });
  return lines;
}

/** The first problem with this plan, or null if it can be sent. */
export function planIssue(plan: FeePlan, ctx: PlanContext): PlanIssue | null {
  const parts = [plan.creatorBps, plan.holdersBps, plan.partnerBps];
  if (parts.some((p) => !Number.isSafeInteger(p) || p < 0)) return { code: "TOTAL_MISMATCH", deltaBps: 0 };

  if (plan.holdersBps > 0 && !ctx.rewardsPool) return { code: "HOLDERS_UNAVAILABLE" };

  if (plan.partnerBps > 0) {
    let key: string;
    try {
      key = new PublicKey(plan.partnerAddress.trim()).toBase58();
    } catch {
      return { code: "PARTNER_ADDRESS_INVALID" };
    }
    if (key === ctx.creator || key === ctx.treasury || key === ctx.rewardsPool) return { code: "PARTNER_ADDRESS_DUPLICATE" };
  }

  const delta = CREATOR_CONFIGURABLE_MAX_BPS - parts.reduce((a, b) => a + b, 0);
  if (delta !== 0) return { code: "TOTAL_MISMATCH", deltaBps: delta };
  return null;
}
