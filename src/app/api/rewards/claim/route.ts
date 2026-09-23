import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { serverRpcUrl } from "@/lib/solana/rpc";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionExpiredBlockheightExceededError,
} from "@solana/web3.js";
import { getLedger, unclaimedLamports, reserveClaim, releaseClaim, markClaimSent, confirmClaim, type Reservation } from "@/lib/rewards/ledger";
import { DAILY_CAP_LAMPORTS, MAX_CLAIM_LAMPORTS, reserveDailyPayout, releaseDailyPayout } from "@/lib/rewards/limits";
import { getRewardsPoolSigner } from "@/lib/pump/rewards-pool-signer";
import { fetchTokenPools } from "@/lib/gecko/client";
import { meetsRewardsThreshold } from "@/lib/rewards";
import { alertOps } from "@/lib/alerts";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { recordActivity } from "@/lib/activity/record";

const LAMPORTS_PER_SOL = 1_000_000_000;
// Never let a payout drain the pool below what it needs to keep signing (fees + rent headroom).
const POOL_RESERVE_LAMPORTS = 10_000_000;

function connection() {
  return new Connection(serverRpcUrl(), "confirmed");
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

function isValidAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
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

/**
 * Pays a holder's unclaimed rewards. Order matters for safety:
 *   1. Book the payout against today's cap and RESERVE it in the ledger
 *      (both atomic) — so concurrent requests can't double-spend one balance.
 *   2. Only then send SOL from the Rewards Pool.
 *   3. If the payout definitely didn't land, release the reservations; if the
 *      outcome is unknown, keep them (a stuck claim is recoverable, a double
 *      payout isn't) and raise an alert.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const paused = await pausedResponse("claims");
  if (paused) return paused;
  if (rateLimited(`claim:ip:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many claim attempts — wait a minute and try again." }, { status: 429 });
  }

  let reserved = 0;
  let reservation: Reservation | null = null;
  let mint = "";
  let holder = "";
  try {
    const body = await req.json();
    mint = body.mint;
    holder = body.holder;
    if (!isValidAddress(mint) || !isValidAddress(holder)) {
      return NextResponse.json({ error: "Missing or invalid mint or holder." }, { status: 400 });
    }
    // Only the wallet's owner (proven by a signed sign-in, see /api/auth/*) can trigger its claim.
    if (getSessionWallet(req) !== holder) {
      return NextResponse.json({ error: "Sign in with this wallet to claim.", code: "AUTH_REQUIRED" }, { status: 401 });
    }
    if (rateLimited(`claim:holder:${holder}`, 3, 60_000)) {
      return NextResponse.json({ error: "Too many claim attempts for this wallet — wait a minute." }, { status: 429 });
    }

    const signer = getRewardsPoolSigner();
    if (!signer) return NextResponse.json({ error: "Rewards Pool isn't configured yet." }, { status: 503 });

    const conn = connection();

    const estimate = unclaimedLamports(await getLedger(mint), holder);
    if (estimate <= 0) return NextResponse.json({ error: "Nothing to claim." }, { status: 400 });

    // Eligibility is re-checked live, against the holder's real current
    // balance — not frozen at whatever it was when the entitlement accrued.
    const valueUsd = await realHolderValueUsd(conn, mint, holder);
    if (!meetsRewardsThreshold(valueUsd)) {
      return NextResponse.json({ error: "This wallet's current holding is below the minimum to claim." }, { status: 400 });
    }

    const wanted = Math.min(estimate, MAX_CLAIM_LAMPORTS);
    if (!(await reserveDailyPayout(wanted))) {
      await alertOps("Daily payout cap reached — claims are paused until 00:00 UTC", {
        capSol: DAILY_CAP_LAMPORTS / LAMPORTS_PER_SOL,
        mint,
        holder,
      });
      return NextResponse.json({ error: "Rewards payouts are paused for today — try again tomorrow." }, { status: 503 });
    }

    reservation = await reserveClaim(mint, holder, wanted);
    reserved = reservation.amount;
    if (reserved < wanted) await releaseDailyPayout(wanted - reserved);
    if (reserved <= 0) return NextResponse.json({ error: "Nothing to claim." }, { status: 400 });
    const booked = reservation; // the reservation this request owns, for the closures below

    const poolBalance = await conn.getBalance(signer.publicKey);
    if (poolBalance < reserved + POOL_RESERVE_LAMPORTS) {
      await releaseClaim(booked);
      await releaseDailyPayout(reserved);
      await alertOps("Rewards Pool balance too low to pay a claim", {
        poolSol: poolBalance / LAMPORTS_PER_SOL,
        neededSol: reserved / LAMPORTS_PER_SOL,
        mint,
      });
      reserved = 0;
      return NextResponse.json({ error: "Payouts are temporarily unavailable — please try again later." }, { status: 503 });
    }

    const tx = new Transaction();
    tx.add(SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: new PublicKey(holder), lamports: reserved }));
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = signer.publicKey;
    tx.recentBlockhash = blockhash;
    tx.sign(signer);

    const rollback = async () => {
      await releaseClaim(booked);
      await releaseDailyPayout(reserved);
      reserved = 0;
    };

    let signature: string;
    try {
      signature = await conn.sendRawTransaction(tx.serialize());
    } catch (err) {
      await rollback();
      await alertOps("Claim transaction could not be sent", { mint, holder, error: String(err) });
      return NextResponse.json({ error: "Couldn't send the payout — nothing was paid, please try again." }, { status: 502 });
    }

    // From here SOL may be on its way: record the signature (Postgres tracks the claim as "sent" until its outcome is known).
    await markClaimSent(booked, signature);

    try {
      const confirmation = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) {
        await rollback();
        await alertOps("Claim transaction failed on-chain", { mint, holder, signature, err: confirmation.value.err });
        await recordAudit({ req, actor: holder, action: "claim.failed_onchain", object: mint, newState: { signature, lamports: reserved } });
        return NextResponse.json({ error: "The payout failed on-chain — nothing was paid, please try again." }, { status: 500 });
      }
    } catch (err) {
      if (err instanceof TransactionExpiredBlockheightExceededError) {
        await rollback();
        return NextResponse.json({ error: "The payout expired before confirming — nothing was paid, please try again." }, { status: 500 });
      }
      // Unknown outcome: it may still land. Keep the reservation so it can't be paid twice.
      await alertOps("Claim outcome UNKNOWN — reservation kept, check the signature manually", {
        mint,
        holder,
        signature,
        lamports: reserved,
      });
      await recordAudit({ req, actor: holder, action: "claim.outcome_unknown", object: mint, newState: { signature, lamports: reserved } });
      reserved = 0;
      return NextResponse.json(
        { error: `Your claim was submitted but not confirmed yet. Check your wallet before retrying (tx ${signature}).` },
        { status: 500 }
      );
    }

    await confirmClaim(booked); // reserved → claimed
    const paid = reserved;
    reserved = 0;
    reservation = null;
    await recordAudit({ req, actor: holder, action: "claim.paid", object: mint, newState: { signature, lamports: paid } });
    // The payout is confirmed on-chain (checked just above), so this is a verified event.
    await recordActivity({ id: `claim:${signature}`, kind: "reward_claim", ts: Date.now(), mint, wallet: holder, lamports: paid, signature });
    return NextResponse.json({ signature, lamports: paid });
  } catch (err) {
    // Anything unexpected after a reservation was booked and before the send: undo it.
    if (reserved > 0 && reservation) {
      await releaseClaim(reservation).catch(() => {});
      await releaseDailyPayout(reserved).catch(() => {});
    }
    const message = err instanceof Error ? err.message : "Claim failed.";
    await alertOps("Claim request crashed", { mint, holder, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
