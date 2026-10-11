import { NextResponse } from "next/server";
import { Connection, Keypair } from "@solana/web3.js";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import { getOnlinePumpSdk } from "@/lib/pump/client";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { buildLaunchTransaction } from "@/lib/pump/create";
import { getLaunchLookupTable } from "@/lib/pump/launch-alt";
import { launchInfo, type CurveStart, type LaunchInfo } from "@/lib/pump/launch-info";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";

const FRESH_MS = 10 * 60_000;
let cached: { at: number; info: LaunchInfo } | null = null;

const big = (v: { toString(): string }) => BigInt(v.toString());

/**
 * The real figures Create shows (src/lib/pump/launch-info.ts): supply and graduation point read from Pump.fun's Global
 * account, and what creating a coin costs, measured by SIMULATING PANDA's own launch transaction (nothing is signed,
 * nothing is sent) and reading the payer's balance back. Whatever can't be read is answered with the stored reference
 * and marked as such. Public, read-only, kept for ten minutes.
 */
export async function GET(req: Request) {
  if (await rateLimited(`launch-info:${clientIp(req)}`, 60, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  if (cached && Date.now() - cached.at < FRESH_MS) return NextResponse.json(cached.info, { headers: { "Cache-Control": "public, max-age=300" } });

  let curve: CurveStart | null = null;
  let createLamports: number | null = null;
  try {
    const connection = new Connection(serverRpcUrl(), "confirmed");
    const global = await getOnlinePumpSdk(connection).fetchGlobal();
    curve = {
      initialVirtualSolReserves: big(global.initialVirtualSolReserves),
      initialVirtualTokenReserves: big(global.initialVirtualTokenReserves),
      initialRealTokenReserves: big(global.initialRealTokenReserves),
      tokenTotalSupply: big(global.tokenTotalSupply),
    };
    try {
      const lookupTable = await getLaunchLookupTable(connection);
      if (lookupTable) {
        // Any funded address will do as the one the simulation debits: Pump.fun's own fee account always is.
        const payer = global.feeRecipient;
        const { blockhash } = await connection.getLatestBlockhash("confirmed");
        const tx = await buildLaunchTransaction({
          mint: Keypair.generate().publicKey,
          user: payer,
          name: "Preview",
          symbol: "PREVIEW",
          uri: "https://launchonpanda.app/preview-metadata-000000000000000000000000000000000000000000000000.json",
          shareholders: [
            { address: PANDA_TREASURY.toBase58(), shareBps: PANDA_SHARE_BPS },
            { address: payer.toBase58(), shareBps: 10_000 - PANDA_SHARE_BPS },
          ],
          lookupTable,
          blockhash,
        });
        if (tx) {
          const before = await connection.getBalance(payer, "confirmed");
          const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed", accounts: { encoding: "base64", addresses: [payer.toBase58()] } });
          const after = sim.value.accounts?.[0]?.lamports;
          if (!sim.value.err && typeof after === "number") createLamports = before - after;
        }
      }
    } catch {
      // The cost stays the stored reference.
    }
  } catch {
    // Neither could be read: the stored reference for both.
  }
  const info = launchInfo(curve, createLamports);
  // A full reading is kept ten minutes; a partial one is asked again sooner.
  cached = { at: info.live.curve && info.live.cost ? Date.now() : Date.now() - FRESH_MS + 60_000, info };
  return NextResponse.json(info, { headers: { "Cache-Control": "public, max-age=300" } });
}
