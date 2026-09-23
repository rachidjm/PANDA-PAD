import { NextResponse } from "next/server";
import { coinCreationGuardResponse, moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildCreateTransaction, buildFeeSharingTransaction } from "@/lib/pump/create";
import { validateShareholders, FeeShareholderInput } from "@/lib/pump/fee-shares-validation";
import { pausedResponse } from "@/lib/protocol/guard";
import { isEnabled } from "@/lib/config/flags";
import { PANDA_REWARDS_POOL } from "@/lib/pump/constants";
import { holderShareIssue } from "@/lib/pump/holder-rewards";
import { recordAudit } from "@/lib/audit/log";

export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  const creationBlocked = coinCreationGuardResponse();
  if (creationBlocked) return creationBlocked;
  const paused = await pausedResponse("token_launches");
  if (paused) return paused;
  if (rateLimited(`pump-create:${clientIp(req)}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 });
  }
  try {
    const { mint, user, name, symbol, uri, shareholders, step } = await req.json();
    // A launch is two transactions: "create" (the coin) and, when there is a fee split, "fees" (its on-chain SharingConfig).
    const forFees = step === "fees";
    if (step !== undefined && step !== "create" && step !== "fees") return NextResponse.json({ error: "Unknown step." }, { status: 400 });
    if (!mint || !user || (!forFees && (!name || !symbol || !uri))) {
      return NextResponse.json({ error: forFees ? "Missing mint or user." : "Missing mint, user, name, symbol or uri." }, { status: 400 });
    }

    if (
      [mint, user].some((v) => typeof v !== "string") ||
      (!forFees && ([name, symbol, uri].some((v) => typeof v !== "string") || name.length > 64 || symbol.length > 16 || uri.length > 400))
    ) {
      return NextResponse.json({ error: "Invalid coin details." }, { status: 400 });
    }

    // Fee Distribution is optional for "create" (validated up front so a bad plan is refused BEFORE the coin exists) and
    // required for "fees". Never trust the client's own 100% check alone.
    if (shareholders !== undefined || forFees) {
      if (!Array.isArray(shareholders) || shareholders.length === 0) {
        return NextResponse.json({ error: forFees ? "The fee split is missing." : "Invalid shareholders." }, { status: 400 });
      }
      const validationError = validateShareholders(shareholders as FeeShareholderInput[]);
      if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });
      const holderIssue = holderShareIssue(shareholders as FeeShareholderInput[], { enabled: isEnabled("HOLDER_REWARDS"), pool: PANDA_REWARDS_POOL?.toBase58() ?? null });
      if (holderIssue) return NextResponse.json({ error: holderIssue, code: "FEATURE_DISABLED", feature: "HOLDER_REWARDS" }, { status: 403 });
    }

    const connection = new Connection(serverRpcUrl(), "confirmed");
    const userKey = new PublicKey(user);
    const mintKey = new PublicKey(mint);

    if (forFees && !(await connection.getAccountInfo(mintKey, "confirmed"))) {
      return NextResponse.json({ error: "That coin doesn't exist on-chain yet — wait for its creation to confirm first.", code: "MINT_NOT_FOUND" }, { status: 409 });
    }

    const tx = forFees
      ? await buildFeeSharingTransaction({ mint: mintKey, user: userKey, shareholders: shareholders as FeeShareholderInput[] })
      : await buildCreateTransaction({ mint: mintKey, user: userKey, name: String(name), symbol: String(symbol), uri: String(uri) });

    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.feePayer = userKey;
    tx.recentBlockhash = blockhash;

    // Build request only — nothing is created until the user signs and it confirms on-chain.
    // The caller isn't authenticated here, so the actor is recorded as a claim, not a fact.
    await recordAudit({
      req,
      actor: `unauthenticated:${userKey.toBase58()}`,
      action: forFees ? "token.fee_sharing_tx_built" : "token.create_tx_built",
      object: String(mint),
      newState: { symbol, shareholders: shareholders ?? null },
    });

    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return NextResponse.json({ transaction: serialized.toString("base64"), feeSplitStep: !forFees && Array.isArray(shareholders) && shareholders.length > 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build transaction.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
