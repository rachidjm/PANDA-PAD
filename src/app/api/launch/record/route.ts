import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgRecordPandaLaunch } from "@/lib/db/referrals";

/**
 * Records a mint as "launched through PANDA's own Create flow" — written only after the creation transaction is
 * confirmed on-chain, and only once PANDA has independently re-verified it, never from the client's say-so alone
 * (the same discipline as /api/portfolio/record-trade). Two things read this row: the "Lanzadas en PANDA"
 * showcase and a coin page's own doubling as its creator's recruiter link (src/lib/referrals/client.ts).
 */
export async function POST(req: Request) {
  if (await rateLimited(`launch-record:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint, signature } = await req.json();
    if (!mint || !signature) return NextResponse.json({ error: "Missing mint or signature." }, { status: 400 });

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || tx.meta?.err) return NextResponse.json({ error: "That signature isn't a real, confirmed transaction." }, { status: 400 });

    const accountKeys = tx.transaction.message.accountKeys;
    const mintSigned = accountKeys.some((k) => k.pubkey.toBase58() === mint && k.signer);
    if (!mintSigned) return NextResponse.json({ error: "That transaction wasn't signed by the claimed mint." }, { status: 400 });

    // The creator is the OTHER signer — the fee payer that built and sent this transaction (see CreateClient.tsx's `signers: [mint]`, with the wallet itself as the primary signer).
    const creator = accountKeys.find((k) => k.signer && k.pubkey.toBase58() !== mint)?.pubkey.toBase58();
    if (!creator) return NextResponse.json({ error: "Couldn't find the creator's own signature in that transaction." }, { status: 400 });

    let db;
    try {
      db = getDb();
    } catch (err) {
      if (err instanceof DbNotConfiguredError) return NextResponse.json({ recorded: false });
      throw err;
    }
    const recorded = await pgRecordPandaLaunch(db, mint, creator, tx.blockTime ? tx.blockTime * 1000 : Date.now());
    return NextResponse.json({ recorded });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to record launch.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
