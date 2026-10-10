/**
 * Sends a changelog DRAFT to PANDA's bot:  npm run changelog -- path/to/draft.md
 *
 * The draft has THREE versions, each followed by an explanation in plain Spanish — NOT a translation: what each point
 * means and, in brackets, which real change it is about; plus "Tono: …" when the English is colloquial. The Spanish part
 * is shown only to the admins, never published:
 *
 *   # Version 1
 *   ## New
 *   - …
 *   ## Fixed
 *   - …
 *   ### ES
 *   ## Nuevo
 *   - …
 *   ## Corregido
 *   - …
 *   Tono: cercano y con humor
 *   # Version 2
 *   …
 *
 * It is checked here first (same rules as the server), then POSTed with CHANGELOG_PUBLISH_SECRET (from .env.local).
 * Nothing is published by this: the bot sends the draft to the admins in private, and one of them presses "Publicar".
 */
import { readFileSync } from "node:fs";
import { buildChangelogText, buildExplanationText, checkDraft, ES_LABEL, parseDraftMarkdown } from "../src/lib/telegram/changelog-format";
import { xLength } from "../src/lib/x/text";

const NL = String.fromCharCode(10);

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run changelog -- <draft.md>");
  const secret = process.env.CHANGELOG_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("CHANGELOG_PUBLISH_SECRET is missing from .env.local.");
  const base = (process.env.CHANGELOG_URL?.trim() || "https://launchonpanda.app").replace(/\/$/, "");
  // Whether PANDA orders are open to everyone is the deployment's setting, not this computer's: the server decides that rule.
  process.env.PANDA_ORDERS_ALLOWLIST = "*";
  const input = parseDraftMarkdown(readFileSync(file, "utf8"));
  const checked = checkDraft(input);
  if (!checked.ok) {
    console.error("This draft can't be sent:\n" + checked.problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  checked.versions.forEach((v, k) => console.log(`── Telegram ${k + 1} ──
${buildChangelogText(v.sections, Date.now())}

   (${ES_LABEL} not published)
${buildExplanationText(v.summary, v.tone)}
`));
  (input.x ?? []).forEach((v, k) => console.log(`── X ${k + 1} (${xLength(v.text ?? "")}/280) ──
${v.text}
`));
  const res = await fetch(`${base}/api/telegram/changelog`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(input) });
  const data = (await res.json().catch(() => ({}))) as { id?: string; xId?: string | null; deferred?: boolean; sentTo?: number; error?: string; problems?: string[] };
  if (!res.ok) {
    console.error(`Not accepted (HTTP ${res.status})${data.error ? `: ${data.error}` : ""}${data.problems ? NL + data.problems.map((p) => `  - ${p}`).join(NL) : ""}`);
    process.exit(1);
  }
  if (data.deferred) console.log(`Small update ${data.id} kept for Monday's weekly summary. Nothing was sent as a draft, nothing is published.`);
  else console.log(`Drafts sent to ${data.sentTo} admin(s) in private: Telegram ${data.id}${data.xId ? ` and X ${data.xId}` : ""}. Nothing is published until one presses "Publicar".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Failed.");
  process.exit(1);
});
