import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { callOpenAi, AiError } from "@/lib/ai/openai";
import { aiBudgetCheck, aiQuotaCheck, aiRecordSpend } from "@/lib/ai/limits";
import type { AiCoinFilter } from "@/lib/ai/coin-filter";

const SCHEMA = {
  type: "object",
  properties: {
    maxAgeHours: { type: ["number", "null"] },
    minLiquidityUsd: { type: ["number", "null"] },
    minMarketCap: { type: ["number", "null"] },
    maxMarketCap: { type: ["number", "null"] },
    rugSafe: { type: "boolean" },
    sort: { type: ["string", "null"], enum: ["new", "trending", "mcap", "volume", null] },
  },
  required: ["maxAgeHours", "minLiquidityUsd", "minMarketCap", "maxMarketCap", "rugSafe", "sort"],
  additionalProperties: false,
} as const;

/** "Buscar monedas": free-text filters applied to Discover's own real list (src/lib/ai/coin-filter.ts) —
 *  the model only decides WHICH knobs to turn, never fabricates or fetches coins itself. */
export async function POST(req: Request) {
  if (!isEnabled("AI_ASSISTANT")) return NextResponse.json({ error: "The AI Assistant isn't enabled on this deployment." }, { status: 503 });
  if (await rateLimited(`ai-search:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
  const wallet = typeof body.wallet === "string" ? body.wallet : null;
  const lang: "es" | "en" = body.lang === "es" ? "es" : "en";
  if (!query) return NextResponse.json({ error: "Describe what you're looking for first." }, { status: 400 });

  const quota = await aiQuotaCheck(wallet, clientIp(req));
  if (!quota.ok) return NextResponse.json({ error: "Too many AI questions today.", code: quota.reason }, { status: 429 });
  const budget = await aiBudgetCheck();
  if (!budget.ok) return NextResponse.json({ error: "budget_exhausted", code: budget.reason }, { status: 503 });

  const instructions =
    lang === "es"
      ? "Traduces una búsqueda de monedas en lenguaje natural a un filtro estructurado para PANDA (una lista de monedas en Solana). Campos: maxAgeHours (edad máxima en horas, o null si no se pide), minLiquidityUsd (liquidez mínima en USD, o null), minMarketCap / maxMarketCap (capitalización de mercado en USD, o null), rugSafe (true SOLO si pide explícitamente que sean seguras/de bajo riesgo/RugCheck verde), sort ('new' recientes, 'trending' tendencia, 'mcap' capitalización, 'volume' volumen, o null si no se especifica). No inventes valores para lo que no se pida — usa null."
      : "You translate a natural-language coin search into a structured filter for PANDA (a Solana coin list). Fields: maxAgeHours (max age in hours, or null if not asked), minLiquidityUsd (minimum liquidity in USD, or null), minMarketCap / maxMarketCap (market cap in USD, or null), rugSafe (true ONLY if explicitly asked for safe/low-risk/green RugCheck coins), sort ('new', 'trending', 'mcap', 'volume', or null if unspecified). Never invent a value for something not asked — use null.";

  try {
    const result = await callOpenAi({
      instructions,
      input: query,
      schema: SCHEMA,
      schemaName: "coin_search_filter",
      maxOutputTokens: 250,
    });
    await aiRecordSpend(result.costUsd);
    const parsed = JSON.parse(result.text) as AiCoinFilter;
    return NextResponse.json({ filter: parsed });
  } catch (err) {
    const message = err instanceof AiError ? err.message : "Couldn't work out a search from that right now.";
    return NextResponse.json({ error: message }, { status: err instanceof AiError && err.status ? 502 : 500 });
  }
}
