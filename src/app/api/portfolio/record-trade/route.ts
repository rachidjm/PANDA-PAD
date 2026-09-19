import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection, clusterApiUrl } from "@solana/web3.js";
import { recordTrade } from "@/lib/portfolio/trade-log";
import { fetchTokenPools } from "@/lib/gecko/client";

const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS_PER_SOL = 1_000_000_000;

async function realSolPriceUsd(): Promise<number> {
  const { data } = await fetchTokenPools(SOL_MINT);
  const best = [...data].sort(
    (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
  )[0];
  return best?.attributes.base_token_price_usd ? Number(best.attributes.base_token_price_usd) : 0;
}

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

    const connection = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
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

    const solPriceUsdAtTrade = await realSolPriceUsd();

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

    return NextResponse.json({ recorded: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record trade.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
