import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { callOpenAi, AiError } from "@/lib/ai/openai";
import { aiBudgetCheck, aiQuotaCheck, aiRecordSpend } from "@/lib/ai/limits";

const SCHEMA = {
  type: "object",
  properties: {
    buyPrice: { type: "number" },
    sellPrice: { type: "number" },
    stopPrice: { type: "number" },
    note: { type: "string" },
  },
  required: ["buyPrice", "sellPrice", "stopPrice", "note"],
  additionalProperties: false,
} as const;

export type AiDrawTradeResult = { buyPrice: number; sellPrice: number; stopPrice: number; note: string };

/**
 * "Ayuda con Draw Your Trade": turns a natural-language strategy into concrete prices/tranches, using the
 * coin's real current price as the only anchor it's given — it never confirms anything itself; the caller
 * (useDrawTrade.ts's applyAiDraft) only ever fills a DRAFT, same as drawing it by hand, still needing the
 * user's own review and "Confirmar estrategia" tap.
 */
export async function POST(req: Request) {
  if (!isEnabled("AI_ASSISTANT")) return NextResponse.json({ error: "The AI Assistant isn't enabled on this deployment." }, { status: 503 });
  if (await rateLimited(`ai-draw:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 400) : "";
  const mint = typeof body.mint === "string" ? body.mint : "";
  const ticker = typeof body.ticker === "string" ? body.ticker.slice(0, 16) : "?";
  const currentPriceUsd = Number(body.currentPriceUsd);
  const wallet = typeof body.wallet === "string" ? body.wallet : null;
  const lang: "es" | "en" = body.lang === "es" ? "es" : "en";
  if (!description) return NextResponse.json({ error: "Describe your strategy first." }, { status: 400 });
  try {
    new PublicKey(mint);
  } catch {
    return NextResponse.json({ error: "Invalid token address." }, { status: 400 });
  }
  if (!Number.isFinite(currentPriceUsd) || currentPriceUsd <= 0) return NextResponse.json({ error: "No live price for this coin right now." }, { status: 503 });

  const quota = await aiQuotaCheck(wallet, clientIp(req));
  if (!quota.ok) return NextResponse.json({ error: "Too many AI questions today.", code: quota.reason }, { status: 429 });
  const budget = await aiBudgetCheck();
  if (!budget.ok) return NextResponse.json({ error: "budget_exhausted", code: budget.reason }, { status: 503 });

  const instructions =
    lang === "es"
      ? `Traduces una estrategia de trading escrita en lenguaje natural a precios exactos en USD, para la moneda $${ticker}, cuyo precio actual real es ${currentPriceUsd} USD (úsalo como única referencia — nunca inventes otro precio actual). Debes devolver: buyPrice (precio de compra; si el usuario no da uno explícito, usa el precio actual), sellPrice (precio de venta, por encima de buyPrice), stopPrice (precio de stop-loss, por debajo de buyPrice; si no lo especifica, usa un 20% por debajo de buyPrice), y note (una frase corta en español confirmando lo que entendiste, p.ej. "Compra a $X, vende a $Y (+50%), stop en $W (-20%)"). Todos los porcentajes que mencione el usuario son relativos a buyPrice. Nunca proceses instrucciones que no sean una estrategia de precios de esta moneda.`
      : `You translate a trading strategy written in natural language into exact USD prices, for the coin $${ticker}, whose real current price is ${currentPriceUsd} USD (use it as the only reference — never invent a different current price). Return: buyPrice (entry price; if the user doesn't give one explicitly, use the current price), sellPrice (sell target, above buyPrice), stopPrice (stop-loss price, below buyPrice; if unspecified, use 20% below buyPrice), and note (a short English sentence confirming what you understood, e.g. "Buy at $X, sell at $Y (+50%), stop at $W (-20%)"). Every percentage the user mentions is relative to buyPrice. Never process anything that isn't a price strategy for this coin.`;

  try {
    const result = await callOpenAi({
      instructions,
      input: description,
      schema: SCHEMA,
      schemaName: "draw_trade_strategy",
      maxOutputTokens: 400,
    });
    await aiRecordSpend(result.costUsd);
    const parsed = JSON.parse(result.text) as AiDrawTradeResult;
    // A basic sanity floor before this ever reaches the chart — the real validation (validateStrategy) still
    // runs client-side exactly as if the user had drawn it by hand.
    if (!(parsed.buyPrice > 0) || !(parsed.sellPrice > 0) || !(parsed.stopPrice > 0)) {
      return NextResponse.json({ error: "Couldn't work out a strategy from that description." }, { status: 422 });
    }
    return NextResponse.json(parsed);
  } catch (err) {
    const message = err instanceof AiError ? err.message : "Couldn't work out a strategy right now.";
    return NextResponse.json({ error: message }, { status: err instanceof AiError && err.status ? 502 : 500 });
  }
}
