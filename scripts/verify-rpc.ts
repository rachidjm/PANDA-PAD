/**
 * verify-rpc — is the production RPC a dedicated provider? Prints only the host name (never the URL's path or api key), whether it is one of
 * Solana's free public endpoints, the network (genesis hash) and the latency of a few calls. Read-only. Runs where SOLANA_RPC_URL exists
 * (the Vercel build: `--build-env PANDA_BUILD_TASKS=verify-rpc`), because "Sensitive" variables never reach a laptop.
 */
import { Connection } from "@solana/web3.js";
import { isPublicSolanaRpc } from "../src/lib/config/env";
import { networkFromGenesis } from "../src/lib/config/network";
import { serverRpcUrl } from "../src/lib/solana/rpc";

async function main() {
  const raw = process.env.SOLANA_RPC_URL?.trim();
  console.log(`SOLANA_RPC_URL ${raw ? "is set" : "is NOT set (the app would fall back to Solana's public endpoint)"}`);
  const url = serverRpcUrl();
  let host = "invalid URL";
  try {
    host = new URL(url).hostname;
  } catch {}
  const publicRpc = isPublicSolanaRpc(raw);
  console.log(`${publicRpc ? "FAIL" : "OK  "} host ${host} — ${publicRpc ? "Solana's free public endpoint (drops and rate-limits trades)" : "not a Solana public endpoint (a dedicated provider)"}`);
  const c = new Connection(url, "confirmed");
  const times: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t = performance.now();
    await c.getLatestBlockhash("confirmed");
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(`OK   getLatestBlockhash x8: median ${times[4].toFixed(0)} ms, max ${times[7].toFixed(0)} ms (no 429s)`);
  const network = networkFromGenesis(await c.getGenesisHash());
  console.log(`${network === "mainnet" ? "OK  " : "FAIL"} network by genesis hash: ${network}`);
  process.exit(publicRpc || network !== "mainnet" ? 1 : 0);
}
main().catch((e) => {
  console.error("FAIL", e instanceof Error ? e.message : e);
  process.exit(1);
});
