/**
 * READ-ONLY check of PANDA's credentials on X:  npm run x:check
 *
 * Asks the deployment (which holds the credentials) to read the signed-in account from X. Nothing is posted, and no
 * credential is printed — only the account's username, or the reason X gave. Uses CHANGELOG_PUBLISH_SECRET (.env.local).
 */
async function main() {
  const secret = process.env.CHANGELOG_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("CHANGELOG_PUBLISH_SECRET is missing from .env.local.");
  const base = (process.env.CHANGELOG_URL?.trim() || "https://launchonpanda.app").replace(/\/$/, "");
  const res = await fetch(`${base}/api/x/check`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  if (res.status === 404) throw new Error("The check isn't available on that deployment (not deployed yet, or the secret doesn't match).");
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  console.log(JSON.stringify(body, null, 2));
  if (!body.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
