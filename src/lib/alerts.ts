/**
 * Server-side ops alerting. Always logs a structured line (visible in Vercel
 * logs); if ALERT_WEBHOOK_URL is set (a Discord or Slack incoming-webhook),
 * it also posts there. Never throws — an alert failing must not break the
 * request that raised it.
 */
export async function alertOps(event: string, details: Record<string, unknown> = {}): Promise<void> {
  console.error(`[PANDA ALERT] ${event}`, JSON.stringify(details));

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const text = `PANDA alert: ${event}\n${JSON.stringify(details, null, 2)}`.slice(0, 1800);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `content` is Discord's field, `text` is Slack's — each ignores the other.
      body: JSON.stringify({ content: text, text }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Logged above already.
  }
}
