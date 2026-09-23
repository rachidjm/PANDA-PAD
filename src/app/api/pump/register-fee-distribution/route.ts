import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection, PublicKey } from "@solana/web3.js";
import { getFeeSharingConfig } from "@/lib/pump/fee-sharing";
import { registerMint } from "@/lib/rewards/registry";
import { fetchPumpCoins } from "@/lib/pump/frontend-api";
import { recordActivity } from "@/lib/activity/record";
import { resolvePending } from "@/lib/pump/fee-lock";

/**
 * Adds a mint to PANDA's own registry of coins the rewards distributor
 * should process — but only after re-verifying the real on-chain
 * `SharingConfig` actually exists, never trusting the client's say-so alone
 * (the same discipline every other write path in this app follows).
 */
export async function POST(req: Request) {
  if (rateLimited(`register-fee:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint } = await req.json();
    if (!mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const shareholders = await getFeeSharingConfig(connection, new PublicKey(mint));
    if (!shareholders) {
      return NextResponse.json({ error: "No real on-chain fee-sharing config found for this mint." }, { status: 400 });
    }

    await registerMint(mint);
    // Two-transaction launches: re-read the chain and take the coin out of the fee-lock registry if PANDA's share is really there.
    await resolvePending(connection, mint).catch((err) => console.error("[PANDA fee-lock] resolve failed", err));

    // A coin whose on-chain fee-sharing config PANDA verified: record its launch, dated by Pump.fun's own launch
    // time. If Pump.fun doesn't know the coin (yet), nothing is recorded rather than dating it by when we heard of it.
    const pump = (await fetchPumpCoins([mint]).catch(() => new Map())).get(mint);
    const ts = pump ? Date.parse(pump.createdAt) : NaN;
    if (pump && Number.isFinite(ts)) {
      await recordActivity({ id: `created:${mint}`, kind: "token_created", ts, mint, wallet: pump.creator || undefined });
    }
    return NextResponse.json({ registered: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to register.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
