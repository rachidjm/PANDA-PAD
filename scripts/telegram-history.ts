/**
 * ONE-OFF: posts to the Telegram group's topics what happened before the bot existed (src/lib/telegram/history.ts).
 *   npx tsx --env-file-if-exists=.env.local scripts/telegram-history.ts            → dry run: only says what it would post
 *   npx tsx --env-file-if-exists=.env.local scripts/telegram-history.ts --publish  → queues it, once
 */
async function main() {
  const secret = process.env.CHANGELOG_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("CHANGELOG_PUBLISH_SECRET is missing from .env.local.");
  const base = (process.env.CHANGELOG_URL?.trim() || "https://launchonpanda.app").replace(/\/$/, "");
  const dryRun = !process.argv.includes("--publish");
  const res = await fetch(`${base}/api/telegram/history`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ dryRun }) });
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2));
  } catch {
    console.log(text.slice(0, 300));
  }
  if (!res.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Failed.");
  process.exit(1);
});
