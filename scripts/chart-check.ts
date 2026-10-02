/**
 * chart-check — hits a RUNNING dev server's own /api/coins and /api/chart routes (the exact code real users
 * hit, not a mock) across real coins spanning every profile asked for (home list, recently created, bonding
 * curve, graduated, Token-2022, low activity, large cap, outside Pump.fun) and all 7 timeframes, and flags:
 *
 *   - no data (0 or 1 real candle)
 *   - candles out of chronological order, or an invalid (≤0 / non-numeric) price
 *   - two different timeframes on the same coin returning byte-identical candles — the exact shape of the
 *     original "every tab shows today's date" bug (one tab's cached payload leaking into another's)
 *   - a short timeframe (1m/5m) whose last real candle is implausibly old for a coin that IS actively trading
 *     right now (checked against that coin's own real activity count, never a blind assumption)
 *   - a completely flat price (every close identical) is a WARNING, not a failure — real on a coin with
 *     ~zero trades, confirmed earlier this session; only genuinely useful to know, not to block on
 *
 *   npm run chart:check -- [--base-url http://localhost:3010] [--min-coins 30]
 *
 * Needs `npm run dev` running first — this is a real integration check against the live route, including
 * the Upstash cache and the DexPaprika fallback (src/lib/chart/cache.ts, src/lib/chart/config.ts), not a
 * direct call into GeckoTerminal.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { tokenProgramOf } from "../src/lib/pump/token-program";
import { fetchTokenPools } from "../src/lib/gecko/client";
import { poolToCoin } from "../src/lib/live-coins";
import { TIMEFRAMES, type Timeframe } from "../src/lib/chart/config";
import type { Coin } from "../src/lib/types";

/** Real, verified-by-hand mints (checked against GeckoTerminal's own token lookup while building this
 *  script — never guessed) for well-known, long-established, genuinely high-volume tokens — the "this
 *  SHOULD obviously have chart data" control group. Looked up directly by token address (fetchTokenPools,
 *  the same path PANDA itself uses when a coin is opened by pasting its mint — see getLiveCoinBase), not
 *  through PANDA's own free-text search: a real finding while building this script is that GeckoTerminal's
 *  OWN text-search endpoint (what `/api/coins?q=` uses) doesn't always surface a token's main, most-liquid
 *  pool — e.g. searching "JUP" misses its real $40M+ JUP/USDC pool entirely, a characteristic of Discover's
 *  search, not of the chart-loading pipeline this script exists to verify. */
// A real finding while re-verifying this script: the mint this list used for "JUP" (JUPrJXKV6MyLkbFgZMDXPn7mYR4yqMNn5Pwg27zcyyG)
// is a real but UNVERIFIED look-alike token on GeckoTerminal (gt_verified: false, near-zero real transaction
// score) — not the actual Jupiter governance token — which explains why it kept failing even through real
// production caching: it isn't actually a reliably-active veteran coin at all. The genuine, CoinGecko-verified
// JUP (coingecko_coin_id "jup") is JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN, confirmed via GeckoTerminal's
// own token-info endpoint before using it here.
const KNOWN_MATURE_MINTS: { mint: string; ticker: string }[] = [
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", ticker: "JUP" },
  { mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", ticker: "BONK" },
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const BASE_URL = (arg("base-url") || process.env.CHART_CHECK_BASE_URL || "http://localhost:3010").replace(/\/$/, "");
const MIN_COINS = Number(arg("min-coins") || 30);
const CONCURRENCY = Number(arg("concurrency") || 1);
/** A real visitor's requests are spread out and mostly cache-served (src/lib/chart/cache.ts) — this script's
 *  aren't, since Upstash credentials aren't available on a laptop (Vercel never hands "Sensitive" vars to
 *  one, same as every other script here that says so). A real finding while building this: even PACED
 *  requests (400ms apart, concurrency 2) can exhaust GeckoTerminal's real free-tier budget AND the
 *  DexPaprika fallback's real 15/min keyless limit by the time a 150-200 request run reaches its later
 *  coins — reproduced directly: a coin that failed near the end of a run returned perfect real candles
 *  seconds later when queried alone. This default is deliberately conservative (and concurrency 1, not 2) so
 *  a full run stays within both services' real documented limits throughout, not just at the start. */
const REQUEST_DELAY_MS = Number(arg("delay-ms") || 2500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Candle = { time: number; close: number };
type CoinCheck = { coin: Coin; tags: string[] };
type Issue = { severity: "fail" | "warn"; message: string };

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function activityCount(c: Coin): number {
  const w = c.activity?.h1 || c.activity?.m5;
  return w ? w.buys + w.sells : 0;
}

/** Picks a real, varied set from the live list — every category the brief asked for, topped up with plain
 *  volume leaders until there are at least MIN_COINS. A coin can (and often does) carry more than one tag. */
async function discoverCoins(): Promise<CoinCheck[]> {
  const { coins } = await fetchJson<{ coins: Coin[] }>("/api/coins");
  const withPool = coins.filter((c) => !!c.poolAddress);
  if (withPool.length === 0) throw new Error("/api/coins returned no coin with a pool address — is the live feed up?");

  const byAge = [...withPool].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const byMcap = [...withPool].sort((a, b) => b.marketCap - a.marketCap);
  const byVolume = [...withPool].sort((a, b) => b.volume24h - a.volume24h);
  const byActivityAsc = [...withPool].sort((a, b) => activityCount(a) - activityCount(b));

  const picked = new Map<string, CoinCheck>();
  const add = (c: Coin, tag: string) => {
    const existing = picked.get(c.mint);
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
    } else picked.set(c.mint, { coin: c, tags: [tag] });
  };

  // A sanity floor: well-known, long-established, genuinely high-volume tokens — the home list itself skews
  // young by nature (it's "what's hot right now"). Without at least a few mature coins in the mix, a quiet
  // moment where the whole home list happens to be fresh launches would make every tab's "should have data
  // by now" check untestable in practice. Looked up directly (see KNOWN_MATURE_MINTS above), not through
  // PANDA's own search. Added FIRST (not last) so they're tested while GeckoTerminal's per-run budget is
  // still fresh — reproduced directly: these same mints failed when tested near the end of a long run, then
  // returned perfect real candles seconds later when queried alone, which is cumulative rate-limit exhaustion
  // from the run itself, not a problem with these coins or their pools.
  for (const { mint, ticker } of KNOWN_MATURE_MINTS) {
    try {
      const { data, included } = await fetchTokenPools(mint);
      const best = [...data].sort((a, b) => Number(b.attributes.reserve_in_usd || 0) - Number(a.attributes.reserve_in_usd || 0))[0];
      if (!best) continue;
      const tokenId = best.relationships.base_token.data.id;
      const token = included?.find((t) => t.id === tokenId);
      const dexId = best.relationships.dex?.data.id || "unknown";
      add(poolToCoin(best, token, dexId), `veterana (control, ${ticker})`);
    } catch {
      // best-effort — a lookup miss doesn't fail the whole run
    }
  }

  for (const c of byAge.slice(0, 8)) add(c, "recién creada");
  for (const c of withPool.filter((c) => c.source === "pump-fun").slice(0, 8)) add(c, "curva de vinculación");
  for (const c of withPool.filter((c) => c.source === "pumpswap").slice(0, 10)) add(c, "graduada");
  for (const c of byMcap.slice(0, 6)) add(c, "gran capitalización");
  for (const c of byActivityAsc.slice(0, 6)) add(c, "poca actividad");
  for (const c of withPool.filter((c) => c.source === "other").slice(0, 8)) add(c, "fuera de Pump.fun");

  for (const c of byVolume) {
    if (picked.size >= MIN_COINS) break;
    add(c, "inicio");
  }

  return [...picked.values()];
}

/** Real on-chain check (not an assumption) — Pump.fun's newer coins run on Token-2022; this confirms it per
 *  coin via the mint's own owning program, exactly the way a real buy/sell has to pick the right program. */
async function tagToken2022(checks: CoinCheck[]): Promise<void> {
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const candidates = checks.filter((c) => c.coin.source === "pump-fun").slice(0, 8);
  for (const c of candidates) {
    try {
      const program = await tokenProgramOf(connection, new PublicKey(c.coin.mint));
      if (program.equals(TOKEN_2022_PROGRAM_ID)) c.tags.push("Token-2022");
    } catch {
      // Best-effort — an RPC hiccup here doesn't fail the chart check itself.
    }
  }
}

function sameCandles(a: Candle[], b: Candle[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return false;
  return a.every((c, i) => c.time === b[i].time && c.close === b[i].close);
}

/** Below this age, "not enough real candles yet" on a given tab is expected, not a bug — a coin born 3
 *  minutes ago cannot have 2 days of real hourly history (see point 1's own rule: never invent candles for a
 *  coin younger than the range). Deliberately generous: a real finding while building this script was that a
 *  pool can have genuinely heavy trading (thousands of trades/hour, confirmed via its own activity counts)
 *  and STILL show no OHLCV candles on GeckoTerminal (or on the DexPaprika fallback) for a while after it's
 *  created — a brand-new pool address (e.g. right after a Pump.fun graduation creates a new AMM pool) takes
 *  the indexer some real time to pick up, separate from whether trades are actually happening. These
 *  thresholds give that lag room so only a pool old enough that indexing lag can no longer excuse it gets
 *  flagged as a real failure. */
const MIN_AGE_FOR_DATA_MS: Record<Timeframe, number> = {
  "1m": 3 * 3_600_000,
  "5m": 4 * 3_600_000,
  "1h": 6 * 3_600_000,
  "4h": 12 * 3_600_000,
  "1d": 3 * 3_600_000,
  "1w": 3 * 24 * 3_600_000,
  "30d": 5 * 24 * 3_600_000,
};

function checkOneTimeframe(candles: Candle[], tf: Timeframe, coin: Coin): Issue[] {
  const issues: Issue[] = [];
  if (candles.length < 2) {
    const ageMs = Date.now() - new Date(coin.createdAt).getTime();
    const tooYoung = ageMs < MIN_AGE_FOR_DATA_MS[tf];
    issues.push({
      severity: tooYoung ? "warn" : "fail",
      message: tooYoung
        ? `sin datos (0 o 1 vela) — moneda de ${(ageMs / 60_000).toFixed(0)} min, probablemente aún no tiene historial real en ${tf}`
        : `sin datos (0 o 1 vela real) en una moneda de ${(ageMs / 3_600_000).toFixed(1)}h — debería haber historial`,
    });
    return issues;
  }
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].time < candles[i - 1].time) {
      issues.push({ severity: "fail", message: `fechas desordenadas (vela ${i} antes que la ${i - 1})` });
      break;
    }
  }
  if (candles.some((c) => !Number.isFinite(c.close) || c.close <= 0)) {
    issues.push({ severity: "fail", message: "precio inválido (≤0 o no numérico) en alguna vela" });
  }
  const closes = candles.map((c) => c.close);
  if (candles.length > 3 && Math.min(...closes) === Math.max(...closes)) {
    issues.push({ severity: "warn", message: "escala completamente plana (real si la moneda casi no opera)" });
  }
  const activity = activityCount(coin);
  if ((tf === "1m" || tf === "5m") && activity > 5) {
    const lastAgeHours = (Date.now() / 1000 - candles[candles.length - 1].time) / 3600;
    if (lastAgeHours > 6) {
      issues.push({
        severity: "fail",
        message: `última vela de hace ${lastAgeHours.toFixed(1)}h en ${tf}, pero la moneda tiene actividad reciente real (${activity} txs) — posible mezcla con otra pestaña`,
      });
    }
  }
  return issues;
}

async function main() {
  console.log(`chart:check — ${BASE_URL}\n`);

  let coins: CoinCheck[];
  try {
    coins = await discoverCoins();
  } catch (err) {
    console.error(`No se pudo leer ${BASE_URL}/api/coins — ¿está "npm run dev" corriendo?`);
    console.error(String(err));
    process.exit(2);
  }
  if (coins.length < MIN_COINS) {
    console.log(`Aviso: solo ${coins.length} monedas reales con pool encontradas (se pedían ${MIN_COINS}+) — el feed en vivo puede estar más tranquilo ahora mismo.\n`);
  }
  await tagToken2022(coins);

  const tasks: { coin: CoinCheck; tf: Timeframe }[] = [];
  for (const c of coins) for (const tf of TIMEFRAMES) tasks.push({ coin: c, tf });
  console.log(`Probando ${coins.length} monedas × ${TIMEFRAMES.length} temporalidades = ${tasks.length} combinaciones (concurrencia ${CONCURRENCY})...\n`);

  const candlesByKey = new Map<string, Candle[]>();
  const rows: string[] = [];
  let hardFails = 0;
  let softWarns = 0;
  let requestErrors = 0;

  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const { coin, tf } = tasks[cursor++];
      let issues: Issue[];
      try {
        const { candles } = await fetchJson<{ candles: Candle[] }>(`/api/chart?pool=${encodeURIComponent(coin.coin.poolAddress!)}&tf=${tf}`);
        candlesByKey.set(`${coin.coin.mint}:${tf}`, candles);
        issues = checkOneTimeframe(candles, tf, coin.coin);
      } catch (err) {
        requestErrors++;
        issues = [{ severity: "fail", message: `la petición falló: ${String(err)}` }];
      }
      const fail = issues.filter((i) => i.severity === "fail");
      const warn = issues.filter((i) => i.severity === "warn");
      if (fail.length > 0) hardFails++;
      if (warn.length > 0) softWarns++;
      if (fail.length > 0 || warn.length > 0) {
        rows.push(`${fail.length > 0 ? "FAIL" : "WARN"}  $${coin.coin.ticker.padEnd(10)} [${tf.padEnd(3)}] (${coin.tags.join(", ")}): ${[...fail, ...warn].map((i) => i.message).join("; ")}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Cross-timeframe check: the same exact candle set under two different tabs for one coin means one tab's
  // cached payload leaked into another's — the original bug this whole point exists to catch for good. Only
  // meaningful once the coin is old enough that BOTH tabs could plausibly show distinguishable real history;
  // a young coin honestly has the same handful of real candles for every window bigger than its own age (not
  // a mixup) — reproduced directly with a 2-hour-old coin whose "1h" and "1w" requests legitimately returned
  // the same real candles, because that's genuinely all the history that exists yet.
  let crossTfFails = 0;
  for (const c of coins) {
    const ageMs = Date.now() - new Date(c.coin.createdAt).getTime();
    for (let i = 0; i < TIMEFRAMES.length; i++) {
      for (let j = i + 1; j < TIMEFRAMES.length; j++) {
        const tfA = TIMEFRAMES[i];
        const tfB = TIMEFRAMES[j];
        if (ageMs < MIN_AGE_FOR_DATA_MS[tfA] || ageMs < MIN_AGE_FOR_DATA_MS[tfB]) continue;
        const a = candlesByKey.get(`${c.coin.mint}:${tfA}`);
        const b = candlesByKey.get(`${c.coin.mint}:${tfB}`);
        if (a && b && sameCandles(a, b)) {
          crossTfFails++;
          hardFails++;
          rows.push(`FAIL  $${c.coin.ticker.padEnd(10)} [${tfA}/${tfB}]: devuelven exactamente las mismas velas — mezcla entre pestañas`);
        }
      }
    }
  }

  console.log(rows.length > 0 ? rows.join("\n") : "Ninguna incidencia.");
  console.log(`\n${tasks.length} combinaciones probadas en ${coins.length} monedas reales.`);
  console.log(`Fallos: ${hardFails} (de ellos, ${requestErrors} por error de red/HTTP, ${crossTfFails} por mezcla entre pestañas) · Avisos: ${softWarns}`);
  console.log("\nMonedas probadas:");
  for (const c of coins) console.log(`  $${c.coin.ticker.padEnd(10)} ${c.coin.mint}  — ${c.tags.join(", ")}`);

  process.exit(hardFails > 0 ? 1 : 0);
}

main();
