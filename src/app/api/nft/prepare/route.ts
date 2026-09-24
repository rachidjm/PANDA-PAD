import { NextResponse } from "next/server";
import { moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { moneyRateGate } from "@/lib/rate-limit";
import { getSessionWallet, sameOrigin } from "@/lib/auth/session";
import { isEnabled } from "@/lib/config/flags";
import { pausedResponse } from "@/lib/protocol/guard";
import { realNftDeps, siteUrlFor } from "@/lib/nft/deps";
import { prepareMint } from "@/lib/nft/service";

/**
 * Auth: signed-in wallet session; the upload must belong to that wallet.
 * Body: { contentId, assetAddress } — assetAddress is the public key of a FRESH keypair the
 * browser generated (only it can sign for that address).
 * Output: the unsigned Core-create transaction (base64) and a plain summary of what will be
 * created. The wallet signs and pays; PANDA never signs. Re-checks that the theme is still open.
 * Gated by NFT_THEMES and the `nft_minting` pause switch.
 */
export async function POST(req: Request) {
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  if (!isEnabled("NFT_THEMES")) return NextResponse.json({ error: "Not available." }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden origin." }, { status: 403 });
  const paused = await pausedResponse("nft_minting");
  if (paused) return paused;

  const wallet = await getSessionWallet(req);
  if (!wallet) return NextResponse.json({ error: "Sign in with your wallet first.", code: "AUTH_REQUIRED" }, { status: 401 });
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`nft-prepare:${wallet}`, 20, 60_000, () => NextResponse.json({ error: "Too many attempts — wait a minute.", code: "RATE_LIMITED" }, { status: 429 }));
    if (limited) return limited;
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body.contentId !== "string") return NextResponse.json({ error: "Invalid request.", code: "BAD_REQUEST" }, { status: 400 });

  try {
    const r = await prepareMint(realNftDeps(siteUrlFor(req)), { wallet, contentId: body.contentId, assetAddress: body.assetAddress });
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
    return NextResponse.json({
      transaction: r.transactionBase64,
      lastValidBlockHeight: r.lastValidBlockHeight,
      summary: {
        name: r.expected.name,
        owner: r.expected.owner,
        asset: r.expected.assetAddress,
        royaltyBps: r.expected.royaltyBps,
        attributes: r.expected.attributes,
      },
    });
  } catch (err) {
    console.error("[PANDA] nft prepare failed", String(err));
    return NextResponse.json({ error: "Couldn't prepare the transaction — try again.", code: "ERROR" }, { status: 500 });
  }
}
