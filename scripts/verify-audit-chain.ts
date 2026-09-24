/**
 * verify-audit-chain — READ-ONLY: re-derives the audit trail's hash chain in Postgres and checks every anchor published on Solana.
 * Writes nothing. Exit 0 = the chain is intact; 1 = broken (says at which event and why).
 *
 *   npm run verify-audit-chain
 *
 * Needs DATABASE_URL (`vercel env pull` can't fetch Sensitive values: run it from the Vercel build with PANDA_BUILD_TASKS=verify-audit,
 * or copy the connection string into .env.local yourself).
 */
import { getDb } from "../src/lib/db/client";
import { pgAuditHead, pgListAnchors, pgVerifyChain } from "../src/lib/db/audit";

async function main() {
  const db = getDb();
  const v = await pgVerifyChain(db);
  const head = await pgAuditHead(db);
  const anchors = await pgListAnchors(db, 5);
  console.log(`events: ${head?.length ?? 0}   verified: ${v.checked}   head: ${v.head ? `#${v.head.seq} ${v.head.hash.slice(0, 16)}…` : "(empty)"}   anchors: ${anchors.length}${anchors[0] ? ` (latest at #${anchors[0].headSeq}, tx ${anchors[0].signature.slice(0, 12)}…)` : ""}`);
  if (v.ok) {
    console.log("CHAIN OK");
    return;
  }
  console.log(`CHAIN BROKEN at seq ${v.problem?.seq}: ${v.problem?.reason}`);
  process.exit(1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
