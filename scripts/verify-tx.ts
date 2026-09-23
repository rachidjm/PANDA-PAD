/**
 * verify-tx — a READ-ONLY report on one transaction signature: the accounts involved, how much SOL reached PANDA's
 * treasury, and whether that is the expected 0.5% fee on the trade.
 *
 *   npm run verify-tx -- <signature> [--treasury <address>] [--wallet <address>] [--bps 50] [--rpc <url>] [--json]
 *
 * It uses no private key and cannot send anything: it only calls getGenesisHash and getParsedTransaction on the RPC.
 * Defaults: the RPC is SOLANA_RPC_URL (else Solana's public one), the treasury is NEXT_PUBLIC_PANDA_TREASURY (else PANDA's
 * built-in default), the wallet is the transaction's fee payer, the fee rate is PANDA_FEE_BPS.
 * Exit code: 0 = fee matches (or nothing to check), 1 = the fee is missing/wrong or the transaction failed, 2 = bad usage.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { PANDA_FEE_BPS, PANDA_TREASURY } from "../src/lib/pump/constants";
import { networkFromGenesis } from "../src/lib/config/network";
import { buildReport, type TxReport } from "../src/lib/verify/tx-report";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const sol = (lamports: number | null) => (lamports === null ? "—" : `${(lamports / 1e9).toFixed(9)} SOL (${lamports.toLocaleString("en-US")} lamports)`);
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function print(r: TxReport, network: string) {
  const line = (s = "") => console.log(s);
  line(`Transaction   ${r.signature}`);
  line(`Network       ${network}    Slot ${r.slot}    ${r.blockTime ?? "(no block time)"}`);
  line(`Status        ${r.status.toUpperCase()}${r.status === "failed" ? `  ${JSON.stringify(r.error)}` : ""}`);
  line(`Fee payer     ${r.feePayer}`);
  line(`Network fee   ${sol(r.networkFeeLamports)}${r.computeUnits !== null ? `    compute units ${r.computeUnits.toLocaleString("en-US")}` : ""}`);
  line();
  line("Programs called");
  for (const p of r.programs) line(`  ${p.programId}  ${p.label ?? ""}`);
  line();
  line("Accounts (SOL balance change)");
  for (const a of r.accounts) {
    const flags = `${a.signer ? "S" : "-"}${a.writable ? "W" : "-"}`;
    const delta = a.deltaLamports === 0 ? "" : `${a.deltaLamports > 0 ? "+" : ""}${a.deltaLamports.toLocaleString("en-US")}`;
    line(`  #${String(a.index).padStart(2)} ${flags} ${short(a.pubkey).padEnd(11)} ${(a.label ?? "").padEnd(24)} ${delta}`);
  }
  line();
  line(`Treasury      ${r.treasury.address}`);
  line(`  transfers from the wallet in this transaction: ${r.treasury.feeTransfers.length ? r.treasury.feeTransfers.map((t) => `ix#${t.instructionIndex} ${t.lamports.toLocaleString("en-US")}`).join(", ") : "none"}`);
  line(`  paid to treasury:  ${sol(r.treasury.transferredLamports)}`);
  line(`  treasury balance:  ${sol(r.treasury.preLamports)}  →  ${sol(r.treasury.postLamports)}   (change ${sol(r.treasury.balanceDeltaLamports)})`);
  line();
  if (r.trade) {
    line(`Trade         ${r.trade.side.toUpperCase()} of ${r.trade.mint}`);
    line(`  tokens moved:      ${r.trade.tokenAmount.toLocaleString("en-US")}`);
    line(`  estimated base:    ${sol(r.trade.baseLamports)}   (from balance changes, without PANDA's fee or new-account rent)`);
  } else {
    line("Trade         (not recognised as a clean coin-for-SOL swap)");
  }
  line(`Expected fee  ${r.fee.expectedBps / 100}% → ${sol(r.fee.expectedLamports)}`);
  line(`Actual fee    ${sol(r.fee.actualLamports)}${r.fee.diffLamports !== null ? `   difference ${r.fee.diffLamports > 0 ? "+" : ""}${r.fee.diffLamports.toLocaleString("en-US")} lamports` : ""}`);
  line();
  line(`VERDICT: ${r.fee.verdict.toUpperCase()} — ${r.fee.note}`);
}

async function main() {
  const signature = process.argv[2];
  if (!signature || signature.startsWith("--") || !/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(signature)) {
    console.error("Usage: npm run verify-tx -- <signature> [--treasury <address>] [--wallet <address>] [--bps 50] [--rpc <url>] [--json]");
    process.exit(2);
  }
  let treasury = PANDA_TREASURY.toBase58();
  let wallet: string | undefined;
  try {
    if (arg("treasury")) treasury = new PublicKey(arg("treasury")!).toBase58();
    if (arg("wallet")) wallet = new PublicKey(arg("wallet")!).toBase58();
  } catch {
    console.error("--treasury / --wallet must be valid Solana addresses.");
    process.exit(2);
  }
  const bps = arg("bps") ? Number(arg("bps")) : PANDA_FEE_BPS;
  if (!Number.isFinite(bps) || bps <= 0 || bps > 10_000) {
    console.error("--bps must be between 1 and 10000.");
    process.exit(2);
  }

  const connection = new Connection(arg("rpc") || process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com", "confirmed");
  const network = networkFromGenesis(await connection.getGenesisHash());
  const tx = await connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) {
    console.error(`Transaction not found on ${network} (not confirmed yet, or the RPC has pruned it). Nothing to report.`);
    process.exit(1);
  }
  const report = buildReport(tx, signature, { treasury, feeBps: bps, wallet });
  if (process.argv.includes("--json")) console.log(JSON.stringify({ network, ...report }, null, 2));
  else print(report, network);
  process.exit(report.fee.verdict === "match" || report.fee.verdict === "not_a_trade" ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-tx failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
