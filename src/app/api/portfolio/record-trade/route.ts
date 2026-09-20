import { NextResponse } from "next/server";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection } from "@solana/web3.js";
import { recordTrade } from "@/lib/portfolio/trade-log";
import { solPriceUsd } from "@/lib/solana/prices";
import { isEnabled } from "@/lib/config/flags";
import { awardTradePoints } from "@/lib/points/trade-award";

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Logs one real trade to the wallet's trade history (src/lib/portfolio/trade-log.ts).
 * Trusts nothing from the client except which signature to look at and which mint/side it
 * concerns — the actual SOL and token amounts are derived from the confirmed transaction's
 * own real pre/post balance deltas, not from what the client claims it sent or received.
 */
export async function POST(req: Request) {
  if (rateLimited(`record-trade:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { wallet, mint, ticker, side, signature } = await req.json();
    if (!wallet || !mint || !ticker || (side !== "buy" && side !== "sell") || !signature) {
      return NextResponse.json({ error: "Missing wallet, mint, ticker, side or signature." }, { status: 400 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) {
      return NextResponse.json({ error: "That signature isn't a real, confirmed transaction." }, { status: 400 });
    }

    const accountKeys = tx.transaction.message.accountKeys;
    const walletIndex = accountKeys.findIndex((k) => k.pubkey.toBase58() === wallet && k.signer);
    if (walletIndex === -1) {
      return NextResponse.json({ error: "That transaction wasn't signed by the claimed wallet." }, { status: 400 });
    }

    // Real SOL delta for the wallet's own account (lamports), sign-agnostic — a buy spends SOL
    // (negative), a sell receives it (positive); we only need the magnitude here.
    const preLamports = tx.meta?.preBalances[walletIndex] ?? 0;
    const postLamports = tx.meta?.postBalances[walletIndex] ?? 0;
    const solAmount = Math.abs(postLamports - preLamports) / LAMPORTS_PER_SOL;

    // Real token delta for the wallet's own token account of `mint`, from the transaction's
    // own pre/post token balances — not estimated, not trusted from the client.
    const pre = tx.meta?.preTokenBalances?.find((b) => b.mint === mint && b.owner === wallet);
    const post = tx.meta?.postTokenBalances?.find((b) => b.mint === mint && b.owner === wallet);
    const preAmount = pre?.uiTokenAmount.uiAmount || 0;
    const postAmount = post?.uiTokenAmount.uiAmount || 0;
    const tokenAmount = Math.abs(postAmount - preAmount);

    // Buy or sell is what the chain says (did the wallet's token balance go up?), not what the client claims.
    const realSide = postAmount > preAmount ? "buy" : "sell";
    if (realSide !== side) {
      return NextResponse.json({ error: "That transaction wasn't a " + side + " of this coin for the claimed wallet." }, { status: 400 });
    }

    if (solAmount <= 0 || tokenAmount <= 0) {
      return NextResponse.json({ error: "Couldn't find a real balance change for this wallet in that transaction." }, { status: 400 });
    }

    const solPriceUsdAtTrade = await solPriceUsd();
    if (solPriceUsdAtTrade <= 0) {
      return NextResponse.json({ error: "No SOL price available right now to value this trade — try again shortly." }, { status: 503 });
    }

    await recordTrade(wallet, {
      mint,
      ticker,
      side,
      solAmount,
      tokenAmount,
      solPriceUsdAtTrade,
      signature,
      ts: Date.now(),
    });

    // PANDA Points (feature-flagged, off by default). A points failure must never fail the trade record.
    let points: { outcome: string; awarded: number } | undefined;
    if (isEnabled("PANDA_POINTS")) {
      try {
        const r = await awardTradePoints({
          tx,
          signature,
          wallet,
          mint,
          observedSolMovementLamports: Math.abs(postLamports - preLamports),
        });
        points = { outcome: r.outcome, awarded: r.awarded };
      } catch (err) {
        console.error("[PANDA POINTS] award failed", signature, String(err));
      }
    }

    return NextResponse.json({ recorded: true, ...(points ? { points } : {}) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record trade.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
