/**
 * The only place that talks to Telegram's Bot API. The token is read from the server environment here and nowhere else; it
 * is never logged, never returned and never put in an error message (Telegram's own errors don't contain it, and ours strip
 * the URL).
 */

export type TelegramResult<T = unknown> = {
  ok: boolean;
  result?: T;
  /** Telegram's error code (400, 403, 429…) or 0 for a network failure / timeout. */
  errorCode: number;
  description?: string;
  /** Seconds to wait, on a 429. */
  retryAfter?: number;
};

export type TelegramCall = <T = unknown>(method: string, payload: Record<string, unknown>) => Promise<TelegramResult<T>>;

const TIMEOUT_MS = 10_000;

export function makeTelegramCall(token: string | undefined = process.env.TELEGRAM_BOT_TOKEN, fetchImpl: typeof fetch = fetch): TelegramCall {
  return async <T,>(method: string, payload: Record<string, unknown>): Promise<TelegramResult<T>> => {
    const t = token?.trim();
    if (!t) return { ok: false, errorCode: 0, description: "TELEGRAM_BOT_TOKEN is not set" };
    if (!/^[A-Za-z]{3,40}$/.test(method)) return { ok: false, errorCode: 0, description: "invalid method" };
    try {
      const res = await fetchImpl(`https://api.telegram.org/bot${t}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null;
      if (data?.ok) return { ok: true, result: data.result, errorCode: 0 };
      return {
        ok: false,
        errorCode: data?.error_code ?? res.status ?? 0,
        description: (data?.description ?? `HTTP ${res.status}`).slice(0, 300),
        retryAfter: data?.parameters?.retry_after,
      };
    } catch (err) {
      // Never echo the error's own text verbatim: a fetch error can contain the URL, and the URL contains the token.
      const name = err instanceof Error ? err.name : "Error";
      return { ok: false, errorCode: 0, description: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error" };
    }
  };
}
