import { NextResponse } from "next/server";
import { Connection } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { MIN_SYSTEM_ACCOUNT_LAMPORTS } from "@/lib/pump/fee-transfer";
import { getOnlinePumpSdk } from "@/lib/pump/client";
import { getJupiterQuote, SOL_MINT } from "@/lib/jupiter/client";
import { envReport, isPublicSolanaRpc } from "@/lib/config/env";
import { decideMoneyFlow, getNetworkStatus } from "@/lib/config/network";
import { decideCoinCreation } from "@/lib/config/creation";
import { needsDatabase, parseStorageModes } from "@/lib/db/mode";
import { databaseUrl, probeDb } from "@/lib/db/client";
import { getRedis } from "@/lib/rate-limit";

/**
 * "Can people trade on this deployment?" — one page (open /api/health/trading) that checks each thing a trade depends
 * on and says which one is missing. Read-only, no secrets in the answer (only yes/no and what to do): every environment
 * variable is reported as present / absent / invalid, never by its value.
 */

/** PANDA's treasury below this can't be counted on to receive fees (the chain's own minimum is ~0.00089 SOL). */
const TREASURY_WARN_LAMPORTS = 2_000_000; // 0.002 SOL

type Check = { id: string; ok: boolean; detail: string };

const BONK = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";

async function timed<T>(fn: () => Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([fn(), new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

export async function GET(req: Request) {
  if (await rateLimited(`health-trading:${clientIp(req)}`, 20, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const checks: Check[] = [];
  const connection = new Connection(serverRpcUrl(), "confirmed");
  // Solana's free public endpoints drop and rate-limit trades, whether they are configured explicitly or are the fallback.
  const dedicated = !isPublicSolanaRpc(process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL);

  // 1. The RPC every trade is built and sent through.
  const started = Date.now();
  try {
    await timed(() => connection.getLatestBlockhash("confirmed"));
    const ms = Date.now() - started;
    checks.push({
      id: "rpc",
      ok: dedicated,
      detail: dedicated
        ? `The Solana RPC answers (${ms} ms).`
        : `The RPC in use is Solana's public one (it answers in ${ms} ms but drops and rate-limits trades). Set SOLANA_RPC_URL in Vercel to a dedicated provider (Helius, QuickNode, Alchemy...).`,
    });
  } catch (err) {
    checks.push({ id: "rpc", ok: false, detail: `The Solana RPC did not answer (${err instanceof Error ? err.message : "error"}). Set SOLANA_RPC_URL in Vercel to a dedicated provider.` });
  }

  // 2. PANDA's treasury: a wallet that has never held SOL can't receive a small fee, and that used to make small trades fail.
  try {
    const lamports = await timed(() => connection.getBalance(PANDA_TREASURY, "confirmed"));
    const configured = !!process.env.NEXT_PUBLIC_PANDA_TREASURY;
    checks.push({
      id: "treasury",
      ok: lamports >= TREASURY_WARN_LAMPORTS && configured,
      detail:
        lamports >= TREASURY_WARN_LAMPORTS && configured
          ? `The treasury wallet is funded (${(lamports / 1e9).toFixed(4)} SOL).`
          : lamports >= TREASURY_WARN_LAMPORTS
          ? `The treasury wallet holds ${(lamports / 1e9).toFixed(4)} SOL, but it is the built-in default address: set NEXT_PUBLIC_PANDA_TREASURY to your own wallet.`
          : lamports >= MIN_SYSTEM_ACCOUNT_LAMPORTS
          ? `WARNING: the treasury wallet holds only ${(lamports / 1e9).toFixed(5)} SOL (under 0.002). It can receive fees today, but fund it with at least 0.002 SOL so small fees never fail.${configured ? "" : " It is also the built-in default address: set NEXT_PUBLIC_PANDA_TREASURY to your own wallet."}`
          : `The treasury wallet ${PANDA_TREASURY.toBase58()} holds ${(lamports / 1e9).toFixed(5)} SOL, so it cannot receive small fees and trades go through WITHOUT PANDA's fee. Send it at least 0.002 SOL${configured ? "" : ", and set NEXT_PUBLIC_PANDA_TREASURY to your own wallet (this is the built-in default)"}.`,
    });
  } catch (err) {
    checks.push({ id: "treasury", ok: false, detail: `Could not read the treasury wallet (${err instanceof Error ? err.message : "error"}).` });
  }

  // 3. Pump.fun's program state (needed to build any bonding-curve buy).
  try {
    await timed(() => getOnlinePumpSdk(connection).fetchGlobal());
    checks.push({ id: "pump", ok: true, detail: "Pump.fun's program state can be read." });
  } catch (err) {
    checks.push({ id: "pump", ok: false, detail: `Pump.fun's program state could not be read (${err instanceof Error ? err.message : "error"}) — usually the RPC.` });
  }

  // 4. Jupiter's swap API (coins that aren't Pump.fun's).
  try {
    const quote = await timed(() => getJupiterQuote({ inputMint: SOL_MINT, outputMint: BONK, amount: "10000000", slippageBps: 300 }));
    checks.push({ id: "jupiter", ok: !!quote.outAmount, detail: "Jupiter returns swap routes." });
  } catch (err) {
    checks.push({ id: "jupiter", ok: false, detail: `Jupiter's swap API did not answer (${err instanceof Error ? err.message : "error"}).` });
  }

  // 5. The network guard: is the RPC on the network NETWORK names? (Money flows are refused otherwise.)
  const network = await getNetworkStatus(serverRpcUrl());
  const moneyFlows = decideMoneyFlow(network);
  const networkDetail: Record<string, string> = {
    ok: `The RPC is on ${network.detected} and NETWORK=${network.expected}: they match.`,
    mismatch: `NETWORK=${network.expected} but the RPC reports ${network.detected}. Money flows are BLOCKED until they match — fix SOLANA_RPC_URL or NETWORK.`,
    not_configured: "NETWORK is not set (mainnet | devnet). In production, money flows are BLOCKED until it is.",
    unverified: "The RPC could not be asked which network it is on right now. Money flows are blocked until it answers.",
  };
  checks.push({ id: "network", ok: network.state === "ok", detail: networkDetail[network.state] });

  // 6. Coin creation is a separate gate from trading: on mainnet it needs the treasury declared a multisig.
  const creation = decideCoinCreation();
  checks.push({
    id: "creation",
    ok: creation.allowed,
    detail: creation.allowed ? "Coin creation is allowed." : "Coin creation is BLOCKED (trading still works): on mainnet, set TREASURY_IS_MULTISIG=true once NEXT_PUBLIC_PANDA_TREASURY is a multisig vault (Squads). The treasury address is written into every coin's on-chain config and can't be changed afterwards.",
  });

  // 7a. Rate limiting (Upstash): money routes are refused without it in production, so trading depends on it.
  {
    const redis = getRedis();
    let answers = false;
    let pingMs = 0;
    if (redis) {
      try {
        const t0 = performance.now();
        answers = (await Promise.race([redis.ping(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 2_000))])) === "PONG";
        pingMs = Math.round(performance.now() - t0);
      } catch {
        // reported below, without the error text
      }
    }
    const production = process.env.NODE_ENV === "production";
    checks.push({
      id: "ratelimit",
      ok: answers || (!production && !redis),
      detail: answers
        ? `Upstash answers (${pingMs} ms): rate limits are shared across instances.`
        : redis
          ? "Upstash is configured but NOT answering: money routes (trades, launches, claims, sending transactions) are refused with 503 until it does; other routes use a per-instance limiter."
          : production
            ? "Upstash isn't configured: in production every money route is refused with 503. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (docs/DEPLOY_CHECKLIST.md)."
            : "Upstash isn't configured: development uses a per-instance limiter (production would refuse money routes).",
    });
  }

  // 7. Postgres: reachable over the app's own connection, transactions work, and the migrations have run. Required only when a
  // domain uses it (PANDA_STORAGE_MODES); otherwise it is reported for information.
  if (needsDatabase() || databaseUrl()) {
    const needed = needsDatabase();
    const { modes, problems } = parseStorageModes(process.env.PANDA_STORAGE_MODES);
    let probe: Awaited<ReturnType<typeof probeDb>> | null = null;
    try {
      probe = await probeDb();
    } catch {
      // reported below, without the error text (it can contain the host)
    }
    const healthy = !!probe && probe.transactionOk && probe.schemaApplied;
    checks.push({
      id: "database",
      ok: (healthy || !needed) && problems.length === 0,
      detail: `${probe ? `Postgres answers (${probe.ms} ms); transactions ${probe.transactionOk ? "work" : "FAIL"}; schema ${probe.schemaApplied ? "applied" : "NOT applied (run the migrations: a production build applies them)"}.` : "Postgres is NOT reachable (check DATABASE_URL)."}${needed && !healthy ? " Domains in postgres mode fail closed and dual mode can't mirror." : ""} Domains: ${Object.entries(modes).map(([d, m]) => `${d}=${m}`).join(", ")}.${problems.length ? ` Unreadable PANDA_STORAGE_MODES entries: ${problems.join("; ")}.` : ""}`,
    });
  }

  // 8. Every environment variable, by name and status only.
  const env = envReport();
  const missingRequired = env.filter((i) => i.required && i.status !== "present");
  checks.push({
    id: "env",
    ok: missingRequired.length === 0,
    detail: missingRequired.length === 0 ? "Every required environment variable is present and valid." : `Required but not usable: ${missingRequired.map((i) => `${i.name} (${i.status})`).join(", ")}. See docs/DEPLOY_CHECKLIST.md.`,
  });

  const ok = checks.every((c) => c.ok);
  return NextResponse.json(
    {
      ok,
      moneyFlows: moneyFlows.blocking ? { allowed: false, reason: moneyFlows.reason } : { allowed: true },
      creation: creation.allowed ? { allowed: true } : { allowed: false, reason: creation.reason },
      network,
      env,
      checks,
      note: ok ? "Everything a trade depends on is in place." : "Fix the failing items above; each says what to do.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
