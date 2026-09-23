import { test } from "node:test";
import assert from "node:assert/strict";
import { Keypair } from "@solana/web3.js";
import { decideMoneyFlow, evaluateNetwork, GENESIS_HASH, networkFromGenesis, parseNetwork } from "./network";
import { envProblems, envReport, isPublicSolanaRpc, moneyFlowEnvProblems, type Env } from "./env";

const key = () => Keypair.generate().publicKey.toBase58();
const GOOD: Env = {
  SOLANA_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=SUPERSECRET",
  NETWORK: "mainnet",
  NEXT_PUBLIC_PANDA_TREASURY: key(),
  AUTH_SESSION_SECRET: "x".repeat(40),
  ADMIN_WALLETS: `${key()},${key()}`,
  CRON_SECRET: "c".repeat(24),
  BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_token",
};

test("the genesis hashes are the two clusters' (read from their public RPCs) and tell them apart", () => {
  assert.equal(networkFromGenesis(GENESIS_HASH.mainnet), "mainnet");
  assert.equal(networkFromGenesis(GENESIS_HASH.devnet), "devnet");
  assert.equal(networkFromGenesis("4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY"), "other"); // testnet
  assert.equal(parseNetwork("mainnet"), "mainnet");
  assert.equal(parseNetwork("Mainnet"), null);
  assert.equal(parseNetwork(undefined), null);
});

test("evaluateNetwork: match, mismatch (devnet RPC on a mainnet deployment), unreachable, unconfigured", async () => {
  assert.deepEqual(await evaluateNetwork("mainnet", async () => GENESIS_HASH.mainnet), { state: "ok", expected: "mainnet", detected: "mainnet" });
  assert.deepEqual(await evaluateNetwork("mainnet", async () => GENESIS_HASH.devnet), { state: "mismatch", expected: "mainnet", detected: "devnet" });
  assert.deepEqual(await evaluateNetwork("devnet", async () => GENESIS_HASH.mainnet), { state: "mismatch", expected: "devnet", detected: "mainnet" });
  assert.equal((await evaluateNetwork("mainnet", async () => "some-private-cluster")).state, "mismatch");
  assert.equal((await evaluateNetwork("mainnet", async () => { throw new Error("rpc down"); })).state, "unverified");
  let asked = false;
  assert.equal((await evaluateNetwork(null, async () => { asked = true; return ""; })).state, "not_configured");
  assert.equal(asked, false, "no RPC call when there is nothing to compare with");
});

test("ACCEPTANCE: a devnet RPC with NETWORK=mainnet blocks every money flow, in production and outside it", async () => {
  const status = await evaluateNetwork("mainnet", async () => GENESIS_HASH.devnet);
  for (const NODE_ENV of ["production", "development", "test"]) {
    const d = decideMoneyFlow(status, { ...GOOD, NODE_ENV });
    assert.equal(d.blocking, true, NODE_ENV);
    assert.equal(d.blocking && d.reason, "network_mismatch");
  }
  // an unreachable RPC blocks too (fail closed)
  assert.equal(decideMoneyFlow(await evaluateNetwork("mainnet", async () => { throw new Error("x"); }), { ...GOOD, NODE_ENV: "production" }).blocking, true);
});

test("a correct network passes; in production an incomplete core configuration still blocks, outside it only warns", async () => {
  const ok = await evaluateNetwork("mainnet", async () => GENESIS_HASH.mainnet);
  assert.equal(decideMoneyFlow(ok, { ...GOOD, NODE_ENV: "production" }).blocking, false);

  const noTreasury: Env = { ...GOOD, NODE_ENV: "production" };
  delete noTreasury.NEXT_PUBLIC_PANDA_TREASURY;
  const d = decideMoneyFlow(ok, noTreasury);
  assert.equal(d.blocking && d.reason, "env_missing");
  assert.equal(decideMoneyFlow(ok, { ...noTreasury, NODE_ENV: "development" }).blocking, false);

  const unconfigured = await evaluateNetwork(null, async () => "");
  assert.equal(decideMoneyFlow(unconfigured, { ...GOOD, NETWORK: undefined, NODE_ENV: "production" }).blocking, true);
  assert.equal(decideMoneyFlow(unconfigured, { NODE_ENV: "development" }).blocking, false, "local dev without any .env keeps working");
});

test("envReport says present / absent / invalid and NEVER contains a value", () => {
  const env: Env = { ...GOOD, AUTH_SESSION_SECRET: "too-short", NEXT_PUBLIC_PANDA_TREASURY: "not-a-key" };
  delete env.CRON_SECRET;
  const report = envReport(env);
  const by = (n: string) => report.find((i) => i.name === n)!;
  assert.equal(by("SOLANA_RPC_URL").status, "present");
  assert.equal(by("AUTH_SESSION_SECRET").status, "invalid");
  assert.equal(by("NEXT_PUBLIC_PANDA_TREASURY").status, "invalid");
  assert.equal(by("CRON_SECRET").status, "absent");
  const dump = JSON.stringify(report);
  for (const secret of ["SUPERSECRET", "vercel_blob_rw_token", "too-short", "not-a-key", env.ADMIN_WALLETS!.split(",")[0]]) assert.equal(dump.includes(secret), false, `leaked ${secret}`);
  assert.deepEqual(envProblems(env).sort(), ["AUTH_SESSION_SECRET", "CRON_SECRET", "NEXT_PUBLIC_PANDA_TREASURY"]);
  assert.deepEqual(moneyFlowEnvProblems(env), ["NEXT_PUBLIC_PANDA_TREASURY"]);
});

test("feature-dependent variables are required only when their flag is on", () => {
  assert.deepEqual(envProblems(GOOD), []);
  assert.deepEqual(envProblems({ ...GOOD, FEATURE_STRATEGIES: "true" }), ["JUPITER_API_KEY"]);
  assert.deepEqual(envProblems({ ...GOOD, FEATURE_STRATEGIES: "true", JUPITER_API_KEY: "k" }), []);
  assert.deepEqual(envProblems({ ...GOOD, NEXT_PUBLIC_PANDA_REWARDS_POOL: key() }), ["PANDA_REWARDS_POOL_SECRET_KEY"]);
  assert.deepEqual(envProblems({ ...GOOD, FEATURE_PANDA_AIRDROPS: "true" }).sort(), ["NEXT_PUBLIC_PANDA_TOKEN_MINT", "PANDA_AIRDROP_POOL_SECRET_KEY"]);
  assert.deepEqual(envProblems({ ...GOOD, FEATURE_NFT_MARKET: "true" }), ["PANDA_MARKET_AUTHORITY_SECRET_KEY"]);
});

test("ADMIN_WALLETS must be a list of real wallet addresses; the Blob token accepts Vercel's alternative names", () => {
  assert.equal(envReport({ ...GOOD, ADMIN_WALLETS: "nope" }).find((i) => i.name === "ADMIN_WALLETS")!.status, "invalid");
  assert.equal(envReport({ ...GOOD, ADMIN_WALLETS: "" }).find((i) => i.name === "ADMIN_WALLETS")!.status, "absent");
  const { BLOB_READ_WRITE_TOKEN: _drop, ...rest } = GOOD;
  void _drop;
  assert.equal(envReport({ ...rest, PANDA_PAD_BLOB_READ_WRITE_TOKEN: "t" }).find((i) => i.name === "BLOB_READ_WRITE_TOKEN")!.status, "present");
});

test("isPublicSolanaRpc: Solana's free endpoints and 'nothing configured' count as public; a provider does not", () => {
  assert.equal(isPublicSolanaRpc(undefined), true);
  assert.equal(isPublicSolanaRpc("https://api.mainnet-beta.solana.com"), true);
  assert.equal(isPublicSolanaRpc("https://api.devnet.solana.com/"), true);
  assert.equal(isPublicSolanaRpc("https://mainnet.helius-rpc.com/?api-key=abc"), false);
  assert.equal(isPublicSolanaRpc("https://example.quiknode.pro/abc/"), false);
});
