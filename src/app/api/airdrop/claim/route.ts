import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { pausedResponse } from "@/lib/protocol/guard";
import { getEpochs } from "@/lib/points/store";
import { getWalletAllocation, updateClaim } from "@/lib/airdrop/store";
import { claimAirdrop, ClaimCode } from "@/lib/airdrop/engine";
import { airdropChainConfig, solanaClaimChain } from "@/lib/airdrop/solana-chain";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";

// Waiting for finality can take ~20s; Vercel Hobby allows at most 30s.
export const maxDuration = 30;

const HTTP: Record<ClaimCode, number> = {
  NOT_DISTRIBUTING: 409,
  NOT_ELIGIBLE: 404,
  INTEGRITY: 503,
  IN_PROGRESS: 202,
  PREPARE_FAILED: 503,
  SEND_UNCERTAIN: 202,
  CONFIRMING: 202,
  FAILED_ONCHAIN: 502,
};

/**
 * Auth: signed-in wallet session — the wallet is the session's, never a request field.
 * Body: { epochId }. Nothing else is accepted: the amount comes from the published,
 * re-verified allocation. Idempotent: claiming again never pays again.
 * Gated by PANDA_AIRDROPS + MERKLE_CLAIMS, the `airdrops` pause switch, and the
 * airdrop pool being configured (otherwise fails closed). Audited.
 *
 * 200 = paid and finalized. 202 = accepted but not final yet (poll /api/airdrop/me,
 * or claim again — safe). Errors carry a `code`.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  if (!isEnabled("PANDA_AIRDROPS") || !isEnabled("MERKLE_CLAIMS")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const paused = await pausedResponse("airdrops");
  if (paused) return paused;

  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with this wallet to claim.", code: "AUTH_REQUIRED" }, { status: 401 });
  // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
  const tooMany = () => NextResponse.json({ error: "Too many attempts — wait a minute." }, { status: 429 });
  const limited = (await moneyRateGate(`airdrop-claim:ip:${clientIp(req)}`, 20, 60_000, tooMany)) ?? (await moneyRateGate(`airdrop-claim:wallet:${wallet}`, 6, 60_000, tooMany));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.epochId) || body.epochId < 1) return NextResponse.json({ error: "Invalid epoch." }, { status: 400 });

  const cfg = airdropChainConfig();
  if (!cfg) return NextResponse.json({ error: "Airdrop payouts aren't configured yet.", code: "NOT_CONFIGURED" }, { status: 503 });

  try {
    const result = await claimAirdrop(
      { epochId: body.epochId, wallet },
      {
        getEpoch: async (id) => (await getEpochs()).find((e) => e.id === id) ?? null,
        getAllocation: async (epoch, w) => {
          const a = await getWalletAllocation(epoch, w);
          return a === null || a === "integrity" ? a : { amount: a.amount };
        },
        updateClaim,
        chain: solanaClaimChain(cfg),
        now: () => Date.now(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        alert: alertOps,
      }
    );

    if (result.ok) {
      if (!result.alreadyClaimed) {
        await recordAudit({ req, actor: wallet, action: "airdrop.claim.paid", object: `epoch:${body.epochId}`, newState: { amount: result.amount, signature: result.signature } });
      }
      return NextResponse.json({ status: result.status, amount: result.amount, signature: result.signature, alreadyClaimed: result.alreadyClaimed });
    }

    if (result.code === "SEND_UNCERTAIN" || result.code === "CONFIRMING" || result.code === "FAILED_ONCHAIN") {
      await recordAudit({ req, actor: wallet, action: `airdrop.claim.${result.code.toLowerCase()}`, object: `epoch:${body.epochId}`, newState: { signature: result.signature } });
    }
    return NextResponse.json({ error: result.error, code: result.code, signature: result.signature ?? null }, { status: HTTP[result.code] });
  } catch (err) {
    console.error("[PANDA] airdrop claim crashed", String(err));
    await alertOps("Airdrop claim request crashed", { epoch: body.epochId, wallet, error: String(err).slice(0, 200) });
    return NextResponse.json({ error: "The claim couldn't be completed — nothing is lost; check again shortly.", code: "ERROR" }, { status: 500 });
  }
}
