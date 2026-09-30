import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { getLiveCoin, getLiveCoins } from "@/lib/live-coins";
import { getRugSummaries, type RugBatch } from "@/lib/rugcheck/server";
import { fetchHolderCount } from "@/lib/pump/holders-count";
import { callOpenAi, AiError } from "@/lib/ai/openai";
import { aiBudgetCheck, aiQuotaCheck, aiRecordSpend } from "@/lib/ai/limits";

const DISCLAIMER = {
  en: "This is not financial advice. Do your own research.",
  es: "Esto no es asesoramiento financiero. Haz tu propia investigación.",
};

/**
 * "Analizar moneda": a plain-language summary of one coin, built ONLY from data PANDA itself already reads
 * for real (RugCheck, live market data, holder count, the creator's other coins) — the model never invents a
 * number, it only explains the ones it's given. Never a buy/sell recommendation; the fixed disclaimer is
 * appended here, not left to the model to remember to include.
 */
export async function POST(req: Request) {
  if (!isEnabled("AI_ASSISTANT")) return NextResponse.json({ error: "The AI Assistant isn't enabled on this deployment." }, { status: 503 });
  if (await rateLimited(`ai-analyze:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const mint = typeof body.mint === "string" ? body.mint : "";
  const wallet = typeof body.wallet === "string" ? body.wallet : null;
  const lang: "es" | "en" = body.lang === "es" ? "es" : "en";
  try {
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }

  const quota = await aiQuotaCheck(wallet, clientIp(req));
  if (!quota.ok) return NextResponse.json({ error: "Too many AI questions today.", code: quota.reason }, { status: 429 });
  const budget = await aiBudgetCheck();
  if (!budget.ok) return NextResponse.json({ error: "budget_exhausted", code: budget.reason }, { status: 503 });

  const { coin } = await getLiveCoin(mint);
  if (!coin) return NextResponse.json({ error: "Couldn't find real data for this coin right now." }, { status: 404 });

  const [rug, holders, { coins: allCoins }] = await Promise.all([
    getRugSummaries([mint]).catch((): RugBatch => ({ results: {}, pending: [] })),
    fetchHolderCount(mint).catch(() => null),
    getLiveCoins().catch(() => ({ coins: [], suspect: [], live: false })),
  ]);
  const rugSummary = rug.results[mint];
  const creatorCoins = [...allCoins].filter((c) => c.creator === coin.creator && c.mint !== mint);

  // Every number below is real, already fetched by PANDA itself — the model is told explicitly to use only these.
  const facts = {
    ticker: coin.ticker,
    name: coin.name,
    ageHours: Math.max(0, (Date.now() - new Date(coin.createdAt).getTime()) / 3_600_000),
    source: coin.source,
    marketCapUsd: coin.marketCap,
    volume24hUsd: coin.volume24h,
    liquidityUsd: coin.liquidityUsd ?? null,
    changePct24h: coin.changePct,
    quality: coin.quality ?? "ok",
    qualityReasons: coin.qualityReasons ?? [],
    rugcheck: rugSummary ? { level: rugSummary.level, score: rugSummary.score, topRisks: rugSummary.risks.slice(0, 5).map((r) => r.name), lpLockedPct: rugSummary.lpLockedPct } : null,
    holderCount: holders,
    creatorOtherCoinsCount: creatorCoins.length,
    creatorOtherCoinsTickers: creatorCoins.slice(0, 8).map((c) => c.ticker),
  };

  const instructions =
    lang === "es"
      ? "Eres el asistente de PANDA (una plataforma de lanzamiento de monedas en Solana). Recibes datos REALES ya verificados de una moneda y debes explicarlos en lenguaje sencillo, para alguien sin conocimientos técnicos. USA SOLO los números que se te dan, nunca inventes cifras. NUNCA recomiendes comprar ni vender, ni sugieras que es buena o mala inversión — limítate a explicar lo que dicen los datos (riesgo de RugCheck, liquidez, concentración de holders si aparece en los riesgos, actividad del creador, volatilidad de 24h). Responde en español, en 4-6 frases cortas, sin markdown."
      : "You are PANDA's assistant (a Solana coin-launch platform). You receive REAL, already-verified data about one coin and must explain it in plain language for someone with no technical background. USE ONLY the numbers you are given, never invent figures. NEVER recommend buying or selling, or suggest it's a good or bad investment — just explain what the data says (RugCheck risk, liquidity, holder concentration if it appears in the risks, creator activity, 24h volatility). Reply in English, in 4-6 short sentences, no markdown.";

  try {
    const result = await callOpenAi({
      instructions,
      input: JSON.stringify(facts),
      maxOutputTokens: 400,
    });
    await aiRecordSpend(result.costUsd);
    return NextResponse.json({ summary: `${result.text}\n\n${DISCLAIMER[lang]}` });
  } catch (err) {
    const message = err instanceof AiError ? err.message : "Couldn't analyze this coin right now.";
    return NextResponse.json({ error: message }, { status: err instanceof AiError && err.status ? 502 : 500 });
  }
}
