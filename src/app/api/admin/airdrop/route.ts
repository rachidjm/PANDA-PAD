import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { sameOrigin } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/admin";
import { isEnabled } from "@/lib/config/flags";
import { pausedResponse } from "@/lib/protocol/guard";
import { publishAirdrop } from "@/lib/airdrop/store";
import { airdropChainConfig, poolTokenBalance } from "@/lib/airdrop/solana-chain";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

/**
 * Auth: admin. Body: { action: "publish", epochId, confirm: "PUBLISH AIRDROP <id>" }.
 * Turns a FINALIZED epoch's pinned points into airdrop allocations, builds the Merkle
 * tree, stores the set once, pins root + hash on the epoch (FINALIZED -> DISTRIBUTING).
 * Refuses unless the airdrop pool wallet really holds the tokens to be distributed.
 * Gated by PANDA_AIRDROPS and the `airdrops` pause switch. Audited.
 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (admin instanceof NextResponse) return admin;
  if (!isEnabled("PANDA_AIRDROPS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  if (await rateLimited(`admin:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const paused = await pausedResponse("airdrops");
  if (paused) return paused;

  const b = await req.json().catch(() => null);
  const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!b || b.action !== "publish" || !Number.isSafeInteger(b.epochId) || b.epochId < 1) return bad("Invalid request.");
  if (b.confirm !== `PUBLISH AIRDROP ${b.epochId}`) return bad(`Confirmation must be exactly "PUBLISH AIRDROP ${b.epochId}".`);

  try {
    const result = await publishAirdrop(b.epochId, Date.now(), async (needed) => {
      const cfg = airdropChainConfig();
      if (!cfg) return "The airdrop pool isn't configured (PANDA_AIRDROP_POOL_SECRET_KEY / NEXT_PUBLIC_PANDA_TOKEN_MINT).";
      const balance = await poolTokenBalance(cfg);
      return balance >= needed ? null : `The airdrop pool holds ${balance} base units but ${needed} are needed — fund it first.`;
    });
    if (!result.ok) {
      await alertOps("Airdrop publish refused", { epoch: b.epochId, error: result.error });
      return bad(result.error, 409);
    }
    await recordAudit({
      req,
      actor: admin.wallet,
      action: "airdrop.publish",
      object: `epoch:${b.epochId}`,
      newState: {
        merkleRoot: result.merkleRoot,
        allocationHash: result.allocation.allocationHash,
        recipients: result.allocation.entries.length,
        pool: result.allocation.pool,
        distributed: result.allocation.distributed,
        dust: result.allocation.dust,
      },
    });
    return NextResponse.json({
      epoch: result.epoch,
      merkleRoot: result.merkleRoot,
      recipients: result.allocation.entries.length,
      distributed: result.allocation.distributed,
      dust: result.allocation.dust,
    });
  } catch (err) {
    console.error("[PANDA] airdrop publish failed", String(err));
    return bad("Publishing failed — nothing was changed, or the state needs checking.", 500);
  }
}
