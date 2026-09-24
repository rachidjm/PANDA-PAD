import { NextResponse } from "next/server";
import { coinCreationGuardResponse, moneyFlowGuardResponse } from "@/lib/config/launch-guard";
import { featureDisabledResponse } from "@/lib/config/guard";
import { clientIp, moneyRateGate } from "@/lib/rate-limit";
import { pausedResponse } from "@/lib/protocol/guard";
import { recordAudit } from "@/lib/audit/log";
import { buildMeteoraLaunch, OtcApiError } from "@/lib/otc/client";
import { getOtcLaunch, transitionOtcLaunch } from "@/lib/otc/store";

/**
 * Step 2 of a PANDA Rewards (OTC) launch: builds the two Meteora transactions via OTC's real
 * POST /api/meteora/launch. Takes only `mint` from the client — everything OTC needs (name, symbol,
 * uri, creator, quoteMint, mode, buy) comes from PANDA's own record, already validated in step 1, so
 * this route can't be used to sneak an unvalidated quoteMint or a mismatched creator through.
 */
export async function POST(req: Request) {
  const disabled = featureDisabledResponse("OTC_REWARDS");
  if (disabled) return disabled;
  const moneyBlocked = await moneyFlowGuardResponse();
  if (moneyBlocked) return moneyBlocked;
  const creationBlocked = coinCreationGuardResponse();
  if (creationBlocked) return creationBlocked;
  const paused = await pausedResponse("token_launches");
  if (paused) return paused;
  {
    // Money route: fails CLOSED (503) if the limiter can't answer — see src/lib/rate-limit.ts.
    const limited = await moneyRateGate(`otc-build:${clientIp(req)}`, 15, 60_000, () => NextResponse.json({ error: "Too many requests — slow down a little." }, { status: 429 }));
    if (limited) return limited;
  }

  try {
    const { mint } = await req.json();
    if (typeof mint !== "string" || !mint) return NextResponse.json({ error: "Missing mint." }, { status: 400 });

    const record = await getOtcLaunch(mint);
    if (!record) return NextResponse.json({ error: "No launch found for this mint. Upload metadata first." }, { status: 404 });
    if (record.status !== "METADATA_CREATED") {
      if (record.status === "AWAITING_SIGNATURE" && record.config && record.blockhash && record.lastValidBlockHeight !== undefined) {
        // Already built (e.g. the tab reloaded) — hand back the same build instead of asking OTC again.
        return NextResponse.json({
          launch: record,
          config: record.config,
          blockhash: record.blockhash,
          lastValidBlockHeight: record.lastValidBlockHeight,
          quoteUsd: record.quoteUsd ?? 0,
        });
      }
      return NextResponse.json({ error: `This launch is at "${record.status}", not ready to build.` }, { status: 409 });
    }

    const building = await transitionOtcLaunch(mint, ["METADATA_CREATED"], { status: "LAUNCH_BUILDING" }, Date.now());
    if (!building) return NextResponse.json({ error: "This launch changed state — reload and try again." }, { status: 409 });

    try {
      const built = await buildMeteoraLaunch({
        mint: record.mint,
        name: record.name,
        symbol: record.symbol,
        uri: record.uri,
        creator: record.creator,
        quoteMint: record.quoteMint,
        mode: record.mode,
        buy: record.buy,
      });

      const updated = await transitionOtcLaunch(
        mint,
        ["LAUNCH_BUILDING"],
        {
          status: "AWAITING_SIGNATURE",
          config: built.config,
          blockhash: built.blockhash,
          lastValidBlockHeight: built.lastValidBlockHeight,
          quoteUsd: built.quoteUsd,
        },
        Date.now()
      );

      await recordAudit({ req, actor: `unauthenticated:${record.creator}`, action: "otc.launch_built", object: mint, newState: { config: built.config } });

      return NextResponse.json({ launch: updated, transactions: built.transactions, config: built.config, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight, quoteUsd: built.quoteUsd });
    } catch (buildErr) {
      const message = buildErr instanceof OtcApiError ? buildErr.message : buildErr instanceof Error ? buildErr.message : "Could not build the launch.";
      await transitionOtcLaunch(mint, ["LAUNCH_BUILDING"], { status: "FAILED", error: message }, Date.now());
      const status = buildErr instanceof OtcApiError ? buildErr.status : 500;
      return NextResponse.json({ error: message }, { status: status === 400 || status === 503 ? status : 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to build launch.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
