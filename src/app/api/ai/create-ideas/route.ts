import { NextResponse } from "next/server";
import { clientIp, rateLimited } from "@/lib/rate-limit";
import { isEnabled } from "@/lib/config/flags";
import { callOpenAi, AiError } from "@/lib/ai/openai";
import { aiBudgetCheck, aiQuotaCheck, aiRecordSpend } from "@/lib/ai/limits";

const SCHEMA = {
  type: "object",
  properties: {
    proposals: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          ticker: { type: "string" },
          description: { type: "string" },
        },
        required: ["name", "ticker", "description"],
        additionalProperties: false,
      },
    },
  },
  required: ["proposals"],
  additionalProperties: false,
} as const;

export type CreateIdeaProposal = { name: string; ticker: string; description: string };

/** "Crear moneda con IA": 3 name/ticker/description proposals from a free-text idea. Never uploads or picks an
 *  image — the user still does that themselves on /create, same as any other launch. */
export async function POST(req: Request) {
  if (!isEnabled("AI_ASSISTANT")) return NextResponse.json({ error: "The AI Assistant isn't enabled on this deployment." }, { status: 503 });
  if (await rateLimited(`ai-ideas:ip:${clientIp(req)}`, 30, 60_000)) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const body = await req.json().catch(() => ({}));
  const idea = typeof body.idea === "string" ? body.idea.trim().slice(0, 500) : "";
  const wallet = typeof body.wallet === "string" ? body.wallet : null;
  const lang: "es" | "en" = body.lang === "es" ? "es" : "en";
  if (!idea) return NextResponse.json({ error: "Describe your coin idea first." }, { status: 400 });

  const quota = await aiQuotaCheck(wallet, clientIp(req));
  if (!quota.ok) return NextResponse.json({ error: "Too many AI questions today.", code: quota.reason }, { status: 429 });
  const budget = await aiBudgetCheck();
  if (!budget.ok) return NextResponse.json({ error: "budget_exhausted", code: budget.reason }, { status: 503 });

  const instructions =
    lang === "es"
      ? "Eres el asistente de PANDA, una plataforma de lanzamiento de memecoins en Solana. El usuario te describe una idea; propón EXACTAMENTE 3 opciones distintas y creativas de moneda, cada una con: name (máx. 32 caracteres), ticker (2-10 letras/números en mayúsculas, sin '$'), description (máx. 180 caracteres, tono divertido/meme). Nunca contenido de odio, ilegal, ni que suplante marcas reales. Responde solo en español."
      : "You are PANDA's assistant, a memecoin launchpad on Solana. The user describes an idea; propose EXACTLY 3 distinct, creative coin options, each with: name (max 32 chars), ticker (2-10 uppercase letters/digits, no '$'), description (max 180 chars, fun/meme tone). Never hateful, illegal, or brand-impersonating content. Reply only in English.";

  try {
    const result = await callOpenAi({
      instructions,
      input: idea,
      schema: SCHEMA,
      schemaName: "coin_proposals",
      maxOutputTokens: 500,
    });
    await aiRecordSpend(result.costUsd);
    const parsed = JSON.parse(result.text) as { proposals: CreateIdeaProposal[] };
    return NextResponse.json({ proposals: parsed.proposals });
  } catch (err) {
    const message = err instanceof AiError ? err.message : "Couldn't come up with proposals right now.";
    return NextResponse.json({ error: message }, { status: err instanceof AiError && err.status ? 502 : 500 });
  }
}
