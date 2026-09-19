import { NextResponse } from "next/server";
import { Connection, PublicKey, SystemProgram, Transaction, clusterApiUrl } from "@solana/web3.js";
import { getLedger, unclaimedLamports, markClaimed } from "@/lib/rewards/ledger";
import { getRewardsPoolSigner } from "@/lib/pump/rewards-pool-signer";
import { fetchTokenPools } from "@/lib/gecko/client";
import { meetsRewardsThreshold } from "@/lib/rewards";

function connection() {
  return new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("mainnet-beta"), "confirmed");
}

/** Real current USD value of `holder`'s balance of `mint` — same pricing approach as src/lib/solana/portfolio.ts. */
async function realHolderValueUsd(conn: Connection, mint: string, holder: string): Promise<number> {
  const [tokenAccounts, pools] = await Promise.all([
    conn.getParsedTokenAccountsByOwner(new PublicKey(holder), { mint: new PublicKey(mint) }),
    fetchTokenPools(mint),
  ]);
  const amount = tokenAccounts.value[0]?.account.data.parsed?.info?.tokenAmount?.uiAmount || 0;
  const best = [...pools.data].sort(
    (a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0)
  )[0];
  const priceUsd = best?.attributes.base_token_price_usd ? Number(best.attributes.base_token_price_usd) : 0;
  return amount * priceUsd;
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const mint = params.get("mint");
  const holder = params.get("holder");
  if (!mint || !holder) return NextResponse.json({ error: "Missing mint or holder." }, { status: 400 });

  try {
    const ledger = await getLedger(mint);
    const entry = ledger.holders[holder] || { entitledLamports: 0, claimedLamports: 0 };
    return NextResponse.json({
      entitledLamports: entry.entitledLamports,
      claimedLamports: entry.claimedLamports,
      unclaimedLamports: unclaimedLamports(ledger, holder),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read rewards ledger.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { mint, holder } = await req.json();
    if (!mint || !holder) return NextResponse.json({ error: "Missing mint or holder." }, { status: 400 });

    const signer = getRewardsPoolSigner();
    if (!signer) return NextResponse.json({ error: "Rewards Pool isn't configured yet." }, { status: 503 });

    const conn = connection();

    const ledger = await getLedger(mint);
    const amount = unclaimedLamports(ledger, holder);
    if (amount <= 0) return NextResponse.json({ error: "Nothing to claim." }, { status: 400 });

    // Eligibility is re-checked live, against the holder's real current
    // balance — not frozen at whatever it was when the entitlement accrued.
    const valueUsd = await realHolderValueUsd(conn, mint, holder);
    if (!meetsRewardsThreshold(valueUsd)) {
      return NextResponse.json({ error: "This wallet's current holding is below the minimum to claim." }, { status: 400 });
    }

    const holderKey = new PublicKey(holder);
    const tx = new Transaction();
    tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: holderKey, lamports: amount }));

    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(signer);

    const signature = await conn.sendRawTransaction(tx.serialize());
    const confirmation = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (confirmation.value.err) {
      return NextResponse.json({ error: "Claim transaction failed to confirm." }, { status: 500 });
    }

    // Only mark claimed after real on-chain confirmation — never before.
    await markClaimed(mint, holder, amount);

    return NextResponse.json({ signature, lamports: amount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claim failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
