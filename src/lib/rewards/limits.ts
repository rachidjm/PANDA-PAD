import { updateJson } from "./blob-store";
import { getDb } from "@/lib/db/client";
import { mirror, storageMode } from "@/lib/db/mode";
import { pgAddDailyPayout, pgReleaseDailyPayout, pgReserveDailyPayout } from "@/lib/db/rewards";

const LAMPORTS_PER_SOL = 1_000_000_000;
const DAY_PATH = "rewards/payout-day.json";

type Day = { date: string; lamports: number };

function envSol(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Most a single claim request may pay out; a bigger entitlement is paid in several claims. */
export const MAX_CLAIM_LAMPORTS = Math.round(envSol("REWARDS_MAX_CLAIM_SOL", 2) * LAMPORTS_PER_SOL);
/** Most the Rewards Pool may pay out in total per UTC day, across every holder and coin. */
export const DAILY_CAP_LAMPORTS = Math.round(envSol("REWARDS_DAILY_CAP_SOL", 20) * LAMPORTS_PER_SOL);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Atomically books `lamports` against today's cap. False (and nothing booked) if it would exceed it. */
export async function reserveDailyPayout(lamports: number): Promise<boolean> {
  const mode = storageMode("rewards");
  if (mode === "postgres") return pgReserveDailyPayout(getDb(), today(), lamports, DAILY_CAP_LAMPORTS);
  const booked = await updateJson<Day, boolean>(DAY_PATH, { date: today(), lamports: 0 }, (current) => {
    const day = current.date === today() ? current : { date: today(), lamports: 0 };
    if (day.lamports + lamports > DAILY_CAP_LAMPORTS) return { next: day, result: false };
    day.lamports += lamports;
    return { next: day, result: true };
  });
  if (booked && mode === "dual") await mirror("rewards", "daily payout", () => pgAddDailyPayout(getDb(), today(), lamports));
  return booked;
}

export async function releaseDailyPayout(lamports: number): Promise<void> {
  if (lamports <= 0) return;
  const mode = storageMode("rewards");
  if (mode !== "postgres") {
    await updateJson<Day, void>(DAY_PATH, { date: today(), lamports: 0 }, (current) => {
      const day = current.date === today() ? current : { date: today(), lamports: 0 };
      day.lamports = Math.max(0, day.lamports - lamports);
      return { next: day, result: undefined };
    });
  }
  if (mode === "postgres") await pgReleaseDailyPayout(getDb(), today(), lamports);
  else if (mode === "dual") await mirror("rewards", "release daily payout", () => pgReleaseDailyPayout(getDb(), today(), lamports));
}
