/**
 * Sends a changelog DRAFT to PANDA's bot:  npm run changelog -- path/to/draft.md
 *
 * The draft is Markdown: a line naming each section ("## New", "## Improved", "## Fixed") followed by "- " lines.
 * It is checked here first (same rules as the server), then POSTed with CHANGELOG_PUBLISH_SECRET (from .env.local).
 * Nothing is published by this: the bot sends the draft to the admins in private, and one of them presses "Publicar".
 */
import { readFileSync } from "node:fs";
import { buildChangelogText, checkChangelog, parseChangelogMarkdown } from "../src/lib/telegram/changelog-format";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run changelog -- <draft.md>");
  const secret = process.env.CHANGELOG_PUBLISH_SECRET?.trim();
  if (!secret) throw new Error("CHANGELOG_PUBLISH_SECRET is missing from .env.local.");
  const base = (process.env.CHANGELOG_URL?.trim() || "https://launchonpanda.app").replace(/\/$/, "");
  const input = parseChangelogMarkdown(readFileSync(file, "utf8"));
  const checked = checkChangelog(input);
  if (!checked.ok) {
    console.error("This draft can't be sent:\n" + checked.problems.map((p) => `  - ${p}`).join("\n"));
    process.exit(1);
  }
  console.log(buildChangelogText(checked.sections, Date.now()) + "\n");
  const res = await fetch(`${base}/api/telegram/changelog`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify(input) });
  const data = (await res.json().catch(() => ({}))) as { id?: string; sentTo?: number; error?: string; problems?: string[] };
  if (!res.ok) {
    console.error(`Not accepted (HTTP ${res.status})${data.error ? `: ${data.error}` : ""}${data.problems ? "\n" + data.problems.map((p) => `  - ${p}`).join("\n") : ""}`);
    process.exit(1);
  }
  console.log(`Draft ${data.id} sent to ${data.sentTo} admin(s) in private. Nothing is published until one presses "Publicar".`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : "Failed.");
  process.exit(1);
});
