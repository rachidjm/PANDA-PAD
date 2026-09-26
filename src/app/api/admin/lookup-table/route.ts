import { NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { requireAdmin } from "@/lib/auth/admin";
import { sameOrigin } from "@/lib/auth/session";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { recordAudit } from "@/lib/audit/log";
import { launchLookupTableAddress, launchStaticAddresses } from "@/lib/pump/launch-alt";
import { checkLaunchTable } from "@/lib/pump/launch-alt-check";

/**
 * Admin-only helper for creating PANDA's launch Address Lookup Table with the admin's own wallet (the browser builds and Phantom signs
 * the two transactions; the server never holds a key). Actions (POST, JSON):
 *   { action: "plan" }                       → the accounts the table must hold, the rent, and the state of the configured table
 *   { action: "verify", address }            → read-only verdict on any table (exists, active, frozen, complete, a launch fits)
 *   { action: "record", address, signatures } → writes the audit event once the admin has created it
 * Nothing here changes the chain; PANDA_LOOKUP_TABLE itself is set by the owner in Vercel.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => null);
  const connection = new Connection(serverRpcUrl(), "confirmed");
  try {
    if (body?.action === "plan") {
      const addresses = await launchStaticAddresses();
      const configured = launchLookupTableAddress();
      const current = configured ? await checkLaunchTable((await connection.getAddressLookupTable(configured)).value) : null;
      return NextResponse.json({
        addresses: addresses.map((a) => a.toBase58()),
        rentLamports: await connection.getMinimumBalanceForRentExemption(56 + 32 * addresses.length),
        configured: configured?.toBase58() ?? null,
        current,
      });
    }
    if (body?.action === "verify" || body?.action === "record") {
      let address: PublicKey;
      try {
        address = new PublicKey(String(body.address));
      } catch {
        return NextResponse.json({ error: "Invalid table address." }, { status: 400 });
      }
      if (body.action === "record") {
        const signatures = Array.isArray(body.signatures) ? body.signatures.filter((s: unknown): s is string => typeof s === "string").slice(0, 4) : [];
        await recordAudit({ req, actor: admin.wallet, action: "admin.lookup_table_created", object: address.toBase58(), newState: { signatures } });
        return NextResponse.json({ recorded: true });
      }
      const check = await checkLaunchTable((await connection.getAddressLookupTable(address)).value);
      await recordAudit({ req, actor: admin.wallet, action: "admin.lookup_table_checked", object: address.toBase58(), newState: { ok: check.ok, frozen: check.frozen, addresses: check.addresses } });
      return NextResponse.json({ address: address.toBase58(), check });
    }
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}
