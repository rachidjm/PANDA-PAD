import { NextResponse } from "next/server";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { requireAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { recordAudit } from "@/lib/audit/log";
import { getDb, DbNotConfiguredError } from "@/lib/db/client";
import { pgGetReservedMintKey, pgSetReservedMintKey } from "@/lib/db/reserved-mint";
import { encryptSecretKey, hasReservedMintKey } from "@/lib/reserved-mint/crypto";
import { PANDA_TOKEN_RESERVED_PURPOSE, RESERVED_PANDA_CREATOR, peekReservedPandaKeypair } from "@/lib/reserved-mint/stock";
import { buildCreateTransaction, buildLaunchTransaction } from "@/lib/pump/create";
import { getLaunchLookupTable } from "@/lib/pump/launch-alt";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { PANDA_SHARE_BPS } from "@/lib/config/protocol";
import type { FeeShareholderInput } from "@/lib/pump/fee-shares-validation";

/**
 * Admin-only. Actions (POST, JSON):
 *   { action: "status" }                     → whether the reserved $PANDA key has been imported, and whether it's been used
 *   { action: "import", secretKey: number[] } → one-time: encrypts and stores a freshly-grinded keypair (never overwrites an existing one)
 *   { action: "simulate", name?, uri? }       → builds the REAL create transaction with the reserved mint (peek only, never marks it
 *                                               used) and runs connection.simulateTransaction with sigVerify:false — never signs or
 *                                               sends anything on-chain, safe to call repeatedly
 * The secret key is never logged or returned — only its derived public key.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);

  try {
    if (body?.action === "status") {
      if (!hasReservedMintKey()) return NextResponse.json({ configured: false, imported: false, pubkey: null, used: false });
      let row;
      try {
        row = await pgGetReservedMintKey(getDb(), PANDA_TOKEN_RESERVED_PURPOSE);
      } catch (err) {
        if (!(err instanceof DbNotConfiguredError)) throw err;
        row = null;
      }
      return NextResponse.json({ configured: true, imported: !!row, pubkey: row?.pubkey ?? null, used: row ? row.usedAt !== null : false });
    }

    if (body?.action === "import") {
      if (!hasReservedMintKey()) return NextResponse.json({ error: "RESERVED_MINT_KEY isn't configured on this deployment." }, { status: 503 });
      const secretArray = body.secretKey;
      if (!Array.isArray(secretArray) || secretArray.length !== 64 || !secretArray.every((n: number) => Number.isInteger(n) && n >= 0 && n <= 255)) {
        return NextResponse.json({ error: "secretKey must be the 64-byte array from the keypair JSON file." }, { status: 400 });
      }
      let keypair: Keypair;
      try {
        keypair = Keypair.fromSecretKey(Uint8Array.from(secretArray));
      } catch {
        return NextResponse.json({ error: "That isn't a valid Solana keypair." }, { status: 400 });
      }
      const enc = encryptSecretKey(keypair.secretKey)!; // hasReservedMintKey() already confirmed the key is usable
      const inserted = await pgSetReservedMintKey(getDb(), { purpose: PANDA_TOKEN_RESERVED_PURPOSE, pubkey: keypair.publicKey.toBase58(), ...enc });
      if (!inserted) {
        return NextResponse.json({ error: "A reserved key for this purpose already exists — it is never overwritten.", code: "ALREADY_IMPORTED" }, { status: 409 });
      }
      await recordAudit({ req, actor: admin.wallet, action: "admin.reserved_mint_imported", object: keypair.publicKey.toBase58(), newState: { purpose: PANDA_TOKEN_RESERVED_PURPOSE } });
      return NextResponse.json({ imported: true, pubkey: keypair.publicKey.toBase58() });
    }

    if (body?.action === "simulate") {
      const keypair = await peekReservedPandaKeypair();
      if (!keypair) return NextResponse.json({ error: "No reserved $PANDA key is imported yet." }, { status: 404 });

      const connection = new Connection(serverRpcUrl(), "confirmed");
      const user = new PublicKey(RESERVED_PANDA_CREATOR);
      const name = typeof body.name === "string" && body.name ? body.name : "PANDA";
      const symbol = "PANDA";
      const uri = typeof body.uri === "string" && body.uri ? body.uri : "https://panda-pad.vercel.app/panda-metadata.json";
      const shareholders: FeeShareholderInput[] = [
        { address: PANDA_TREASURY.toBase58(), shareBps: PANDA_SHARE_BPS },
        { address: RESERVED_PANDA_CREATOR, shareBps: 10_000 - PANDA_SHARE_BPS },
      ];

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const creatorLamports = await connection.getBalance(user, "confirmed").catch(() => null);
      const lookupTable = await getLaunchLookupTable(connection);
      let combined = false;
      let simResult;
      if (lookupTable) {
        const tx = await buildLaunchTransaction({ mint: keypair.publicKey, user, name, symbol, uri, shareholders, lookupTable, blockhash });
        if (tx) {
          combined = true;
          simResult = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
        }
      }
      if (!simResult) {
        const legacy = await buildCreateTransaction({ mint: keypair.publicKey, user, name, symbol, uri });
        legacy.feePayer = user;
        legacy.recentBlockhash = blockhash;
        const asVersioned = new VersionedTransaction(legacy.compileMessage());
        simResult = await connection.simulateTransaction(asVersioned, { sigVerify: false, replaceRecentBlockhash: true });
      }

      await recordAudit({ req, actor: admin.wallet, action: "admin.reserved_mint_simulated", object: keypair.publicKey.toBase58(), newState: { combined, ok: !simResult.value.err } });
      return NextResponse.json({
        mint: keypair.publicKey.toBase58(),
        endsInPanda: keypair.publicKey.toBase58().toLowerCase().endsWith("panda"),
        creator: user.toBase58(),
        creatorLamports,
        combined,
        ok: !simResult.value.err,
        err: simResult.value.err ?? null,
        logs: simResult.value.logs ?? [],
        unitsConsumed: simResult.value.unitsConsumed ?? null,
      });
    }

    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
