/**
 * Thin, server-only client for OpenAI's Responses API (developers.openai.com/api/docs) — the model, endpoint
 * and request shape below were verified directly against OpenAI's own docs at implementation time, not
 * invented: `POST https://api.openai.com/v1/responses`, `{ model, instructions?, input, text?: { format } }`
 * for structured (JSON-schema) output, `Authorization: Bearer <key>`.
 *
 * `OPENAI_API_KEY` never leaves this file — every AI route calls through here, never straight to OpenAI from
 * the browser. Every call is capped short (`max_output_tokens`) on purpose: PANDA's assistant answers in a
 * few sentences or a small JSON object, never an essay — see the per-feature callers in src/app/api/ai/*.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";

/** The exact API model id, confirmed against OpenAI's own docs (developers.openai.com/api/docs/models/gpt-6-luna):
 *  GPT-6 Luna, $0.10 / 1M input tokens, $0.50 / 1M output tokens, $0.01 / 1M cached input tokens. */
export const AI_MODEL = "gpt-6-luna";
export const AI_PRICE_PER_1M_INPUT_USD = 0.1;
export const AI_PRICE_PER_1M_OUTPUT_USD = 0.5;
export const AI_PRICE_PER_1M_CACHED_INPUT_USD = 0.01;

export function openAiKey(): string | null {
  const k = process.env.OPENAI_API_KEY;
  return k && k.trim() ? k.trim() : null;
}

export type JsonSchema = Record<string, unknown>;

export type AiCallResult = {
  text: string;
  /** Real usage as OpenAI reports it, when it reports it — used only to estimate cost for the daily budget
   *  (src/lib/ai/limits.ts); a call this can't read from the response counts as 0, never a guess. */
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export class AiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/**
 * One Responses API call. `schema`, when given, asks for strict JSON matching it (OpenAI's own structured
 * outputs — `text.format.type: "json_schema"`); otherwise the reply is plain text. `maxOutputTokens` keeps
 * every answer short, both for cost and so the assistant never reads as a wall of text.
 */
export async function callOpenAi({
  instructions,
  input,
  schema,
  schemaName,
  maxOutputTokens = 500,
}: {
  instructions: string;
  input: string;
  schema?: JsonSchema;
  schemaName?: string;
  maxOutputTokens?: number;
}): Promise<AiCallResult> {
  const key = openAiKey();
  if (!key) throw new AiError("The AI Assistant isn't configured on this deployment.");

  const body: Record<string, unknown> = {
    model: AI_MODEL,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
  };
  if (schema) {
    body.text = { format: { type: "json_schema", name: schemaName || "panda_ai_output", schema, strict: true } };
  }

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new AiError(`Couldn't reach OpenAI: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AiError(`OpenAI ${res.status}: ${detail.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as {
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const text = (data.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" && typeof c.text === "string")
    .map((c) => c.text as string)
    .join("")
    .trim();
  if (!text) throw new AiError("OpenAI returned no text.");

  const inputTokens = data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.output_tokens ?? 0;
  const costUsd = (inputTokens / 1_000_000) * AI_PRICE_PER_1M_INPUT_USD + (outputTokens / 1_000_000) * AI_PRICE_PER_1M_OUTPUT_USD;

  return { text, inputTokens, outputTokens, costUsd };
}
