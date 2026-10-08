import { NextResponse } from "next/server";
import { coinCreationGuardResponse, moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { buildCreateTransaction, buildFeeSharingTransaction, buildLaunchTransaction } from "@/lib/pump/create";
import { getLaunchLookupTable } from "@/lib/pump/launch-alt";
import { registerPendingFeeLock } from "@/lib/pump/fee-lock";
import { validateShareholders, FeeShareholderInput } from "@/lib/pump/fee-shares-validation";
import { pausedResponse } from "@/lib/protocol/guard";
import { isEnabled } from "@/lib/config/flags";
import { PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { holderShareIssue } from "@/lib/pump/holder-rewards";
import { recordAudit } from "@/lib/audit/log";
import { claimLaunchMintKeypair } from "@/lib/reserved-mint/stock";
import { createMinFirstBuySol } from "@/lib/config/create-limits";

export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  const creationBlocked = coinCreationGuardResponse();
  if (creationBlocked) return creationBlocked;
  const paused = await pausedResponse("token_launches");
  if (paused) return paused;
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`pump-create:${clientIp(req)}`, 20, 60_000, () => NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 }));
    if (limited) return limited;
  }
  try {
    const { mint: clientMint, user, name, symbol, uri, shareholders, step, firstBuySol } = await req.json();
    // A launch is ONE transaction (create + fee split, as a v0 message using PANDA's lookup table) when the table is available;
    // otherwise two: "create" (the coin) and then "fees" (its on-chain SharingConfig).
    const forFees = step === "fees";
    if (step !== undefined && step !== "create" && step !== "fees") return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    // "fees" reuses the mint of a coin that already exists — that one has to come from the client. "create" is
    // the opposite: the mint is now always ASSIGNED by the server (see mintKeypair below, "…panda" when the
    // vanity stock has one), so a mint from the client at this step is simply ignored, never trusted.
    if (!user || (forFees && !clientMint) || (!forFees && (!name || !symbol || !uri))) {
      return NextResponse.json({ error: forFees ? "Missing mint or user." : "Missing user, name, symbol or uri." }, { status: 400 });
    }

    if (
      typeof user !== "string" ||
      (forFees && typeof clientMint !== "string") ||
      (!forFees && ([name, symbol, uri].some((v) => typeof v !== "string") || name.length > 64 || symbol.length > 16 || uri.length > 400))
    ) {
      return NextResponse.json({ error: "Invalid coin details." }, { status: 400 });
    }

    // The first buy is now a mandatory part of a launch, not an afterthought: the "create" step itself is
    // refused without one that clears the configured minimum, so the requirement can't be skipped by calling
    // this API directly. The buy itself still happens afterwards, as its own transaction (see buyFirst in
    // CreateClient.tsx) — this only checks that the client declared a qualifying amount before the coin exists.
    if (!forFees) {
      const minFirstBuy = createMinFirstBuySol();
      if (typeof firstBuySol !== "number" || !Number.isFinite(firstBuySol) || firstBuySol < minFirstBuy) {
        return NextResponse.json({ error: `A first buy of at least ${minFirstBuy} SOL is required to launch.`, code: "FIRST_BUY_REQUIRED" }, { status: 400 });
      }
    }

    // Fee Distribution is required on both steps — every PANDA coin carries PANDA's locked 5% — and is validated up front so a
    // bad plan is refused BEFORE the coin exists. Never trust the client's own 100% check alone.
    {
      if (!Array.isArray(shareholders) || shareholders.length === 0) {
        return NextResponse.json({ error: "The fee split is missing." }, { status: 400 });
      }
      const validationError = validateShareholders(shareholders as FeeShareholderInput[]);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      const holderIssue = holderShareIssue(shareholders as FeeShareholderInput[], { enabled: isEnabled("HOLDER_REWARDS"), pool: PANDA_REWARDS_POOL?.toBase58() ?? null });
      if (holderIssue) return NextResponse.json({ error: holderIssue, code: "FEATURE_DISABLED", feature: "HOLDER_REWARDS" }, { status: 403 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);

    // The "create" step's mint: the one reserved "…panda" address when this exact wallet+ticker launches $PANDA
    // itself (src/lib/reserved-mint/stock.ts), otherwise a pre-generated "…panda" address from the generic
    // stock when one is available, a plain random keypair otherwise — never a reason the launch is blocked
    // (src/lib/vanity/stock.ts). Only its PUBLIC key is used to build the transaction below; the secret goes
    // back to the client in the response so it can sign as a co-signer of its own creation, exactly as it did
    // when it generated the keypair itself.
    let mintKeypair: Keypair | null = null;
    let vanity = false;
    let mint: string;
    if (forFees) {
      mint = clientMint;
    } else {
      const claimed = await claimLaunchMintKeypair(user, String(symbol));
      mintKeypair = claimed.keypair;
      vanity = claimed.vanity;
      mint = mintKeypair.publicKey.toBase58();
    }
    const mintKey = new PublicKey(mint);

    if (forFees && !(await connection.getAccountInfo(mintKey, "confirmed"))) {
      return NextResponse.json({ error: "That coin doesn't exist on-chain yet — wait for its creation to confirm first.", code: "MINT_NOT_FOUND" }, { status: 409 });
    }

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const split = shareholders as FeeShareholderInput[];

    let tx: Transaction | VersionedTransaction | null = null;
    let combined = false;
    if (!forFees) {
      // Preferred: the whole launch atomically in one transaction (falls back below when there is no table, or it doesn't fit).
      const lookupTable = await getLaunchLookupTable(connection);
      if (lookupTable) {
        tx = await buildLaunchTransaction({ mint: mintKey, user: userKey, name: String(name), symbol: String(symbol), uri: String(uri), shareholders: split, lookupTable, blockhash });
        combined = tx !== null;
      }
    }

    if (!tx) {
      const legacy = forFees
        ? await buildFeeSharingTransaction({ mint: mintKey, user: userKey, shareholders: split })
        : await buildCreateTransaction({ mint: mintKey, user: userKey, name: String(name), symbol: String(symbol), uri: String(uri) });
      legacy.feePayer = userKey;
      legacy.recentBlockhash = blockhash;
      tx = legacy;
      if (!forFees) {
        // Two-transaction launch: until the split is set the coin exists WITHOUT PANDA's 5%. Register it so it stays out of every
        // PANDA list, its creator is told to finish, and the audit log records it (see fee-lock.ts).
        const reg = await registerPendingFeeLock(connection, { mint: String(mint), creator: userKey.toBase58(), shareholders: split });
        if (!reg.ok) {
          return NextResponse.json(
            reg.reason === "exists"
              ? { error: "That mint already exists on-chain.", code: "MINT_EXISTS" }
              : { error: "Launches are briefly unavailable — try again in a few minutes.", code: "LAUNCH_QUEUE_FULL" },
            { status: reg.reason === "exists" ? 409 : 503 }
          );
        }
      }
    }

    // Build request only — nothing is created until the user signs and it confirms on-chain.
    // The caller isn't authenticated here, so the actor is recorded as a claim, not a fact.
    await recordAudit({
      req,
      actor: `unauthenticated:${userKey.toBase58()}`,
      action: forFees ? "token.fee_sharing_tx_built" : combined ? "token.launch_tx_built" : "token.create_tx_built",
      object: String(mint),
      newState: { symbol, shareholders: shareholders ?? null },
    });

    const serialized = tx instanceof VersionedTransaction ? Buffer.from(tx.serialize()) : (tx as Transaction).serialize({ requireAllSignatures: false, verifySignatures: false });
    // `combined`: one v0 transaction does everything (the client signs it with the mint and skips the second step);
    // otherwise `feeSplitStep` tells the client to send the "fees" transaction next. On "create", `mint` and
    // `mintSecretKey` are the server-assigned keypair the client must sign with (see above) — never sent again
    // on the "fees" step, which already has its own mint.
    return NextResponse.json({
      transaction: serialized.toString("base64"),
      versioned: combined,
      combined,
      feeSplitStep: !forFees && !combined,
      ...(forFees ? {} : { mint, mintSecretKey: Array.from(mintKeypair!.secretKey), vanity }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
