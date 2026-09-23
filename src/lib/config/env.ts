import { PublicKey } from "@solana/web3.js";
import { isEnabled } from "./flags";
import { needsDatabase, parseStorageModes } from "@/lib/db/mode";

/**
 * Every environment variable PANDA reads, validated by a small schema (no new dependency): for each one, whether it is
 * `present`, `absent` or `invalid` — never its value — whether it is required for THIS deployment, and what stops
 * working without it. "Core" variables are required for the launch scope (Discover, trade, Create, Portfolio);
 * the rest are required only when the feature they belong to is switched on.
 */

export type Env = Record<string, string | undefined>;
export type EnvStatus = "present" | "absent" | "invalid";
export type EnvGroup = "core" | "storage" | "strategies" | "rewards" | "airdrops" | "market" | "alerts" | "limits";

export type EnvSpec = {
  /** Accepted names, first is canonical (Vercel's Blob integration names its token in more than one way). */
  names: string[];
  group: EnvGroup;
  required: (env: Env) => boolean;
  valid: (value: string, env: Env) => boolean;
  /** What stops working when it is missing or invalid. */
  affects: string;
};

const nonEmpty = (v: string) => v.trim().length > 0;
const isPubkey = (v: string) => {
  try {
    new PublicKey(v.trim());
    return true;
  } catch {
    return false;
  }
};
const isPostgresUrl = (v: string) => /^postgres(ql)?:\/\/\S+$/.test(v.trim());
const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
};
/** A base58 secret key or a JSON byte array — shape only; the value is never inspected further or printed. */
const looksLikeSecretKey = (v: string) => /^\[\s*\d+(\s*,\s*\d+){31,}\s*\]$/.test(v.trim()) || /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(v.trim());
const isPositiveNumber = (v: string) => Number.isFinite(Number(v)) && Number(v) > 0;

const always = () => true;
const never = () => false;

export const ENV_SPECS: EnvSpec[] = [
  // ── core: the launch scope needs all of these ─────────────────────────────────────────────────────────────
  { names: ["SOLANA_RPC_URL"], group: "core", required: always, valid: isHttpUrl, affects: "every trade, launch and read of the chain (a dedicated provider; the public RPC drops trades)" },
  { names: ["NETWORK"], group: "core", required: always, valid: (v) => v === "mainnet" || v === "devnet", affects: "the network guard: without it no money-moving flow is allowed" },
  { names: ["NEXT_PUBLIC_PANDA_TREASURY"], group: "core", required: always, valid: isPubkey, affects: "where PANDA's 0.5% trading fee is paid (unset, a built-in default address would receive it)" },
  { names: ["AUTH_SESSION_SECRET"], group: "core", required: always, valid: (v) => v.length >= 32, affects: "wallet sign-in: without it nobody can sign in or claim rewards" },
  { names: ["ADMIN_WALLETS"], group: "core", required: always, valid: (v) => v.split(",").map((s) => s.trim()).filter(Boolean).length > 0 && v.split(",").map((s) => s.trim()).filter(Boolean).every(isPubkey), affects: "/admin and the pause switches: without it nobody is admin" },
  { names: ["CRON_SECRET"], group: "core", required: always, valid: (v) => v.length >= 16, affects: "the daily fee-collection cron: without it the cron refuses to run" },
  { names: ["TREASURY_IS_MULTISIG"], group: "core", required: (e) => e.NETWORK === "mainnet", valid: (v) => v === "true" || v === "false", affects: "coin creation on mainnet: blocked unless this is \"true\" (your declaration that the treasury is a multisig); trading is not affected" },
  { names: ["PANDA_LOOKUP_TABLE"], group: "core", required: never, valid: isPubkey, affects: "one-signature launches: unset, a launch takes two transactions (the coin, then its fee split) and the coin stays out of PANDA's lists until the second is confirmed" },
  { names: ["BLOB_READ_WRITE_TOKEN", "BLOB_READ_WRITE_TOKEN_READ_WRITE_TOKEN", "PANDA_PAD_BLOB_READ_WRITE_TOKEN"], group: "storage", required: always, valid: nonEmpty, affects: "Create (the coin's image and metadata are hosted there) and every ledger PANDA keeps" },

  { names: ["PANDA_STORAGE_MODES"], group: "storage", required: never, valid: (v) => parseStorageModes(v).problems.length === 0, affects: "where each domain lives during the Blob → Postgres migration (rewards, trades, activity, pause = blob | dual | postgres); an entry it can't read leaves that domain on Blob" },
  { names: ["DATABASE_URL"], group: "storage", required: (e) => needsDatabase(e), valid: isPostgresUrl, affects: "Postgres (Neon): required as soon as PANDA_STORAGE_MODES puts any domain in dual or postgres; a domain in postgres mode fails closed without it" },
  { names: ["DATABASE_URL_UNPOOLED"], group: "storage", required: never, valid: isPostgresUrl, affects: "only `npm run db:migrate` (schema migrations); the running app uses DATABASE_URL" },

  // ── optional, required only when the feature is on ────────────────────────────────────────────────────────
  { names: ["JUPITER_API_KEY"], group: "strategies", required: (e) => isEnabled("STRATEGIES", e), valid: nonEmpty, affects: "Draw Your Trade and Stop Loss / Take Profit (FEATURE_STRATEGIES)" },
  { names: ["NEXT_PUBLIC_PANDA_REWARDS_POOL"], group: "rewards", required: never, valid: isPubkey, affects: "the \"Holders\" share of a coin's creator fees and the Rewards page (unset: holders routing is shown as not configured)" },
  { names: ["PANDA_REWARDS_POOL_SECRET_KEY"], group: "rewards", required: (e) => !!e.NEXT_PUBLIC_PANDA_REWARDS_POOL, valid: looksLikeSecretKey, affects: "collecting fees and paying holder claims" },
  { names: ["PANDA_AIRDROP_POOL_SECRET_KEY"], group: "airdrops", required: (e) => isEnabled("PANDA_AIRDROPS", e), valid: looksLikeSecretKey, affects: "airdrop claims (FEATURE_PANDA_AIRDROPS)" },
  { names: ["NEXT_PUBLIC_PANDA_TOKEN_MINT"], group: "airdrops", required: (e) => isEnabled("PANDA_AIRDROPS", e), valid: isPubkey, affects: "airdrops and the $PANDA widgets" },
  { names: ["PANDA_MARKET_AUTHORITY_SECRET_KEY"], group: "market", required: (e) => isEnabled("NFT_MARKET", e), valid: looksLikeSecretKey, affects: "the NFT marketplace (FEATURE_NFT_MARKET)" },
  { names: ["ALERT_WEBHOOK_URL"], group: "alerts", required: never, valid: isHttpUrl, affects: "operator alerts (failed payouts, low pool, cron failures); alerts still go to the logs" },
  { names: ["REWARDS_MAX_CLAIM_SOL"], group: "limits", required: never, valid: isPositiveNumber, affects: "the per-claim payout cap (default applies)" },
  { names: ["REWARDS_DAILY_CAP_SOL"], group: "limits", required: never, valid: isPositiveNumber, affects: "the daily payout cap (default applies)" },
];

export type EnvItem = { name: string; group: EnvGroup; required: boolean; status: EnvStatus; affects: string };

export function statusOf(spec: EnvSpec, env: Env): EnvStatus {
  const raw = spec.names.map((n) => env[n]).find((v) => v !== undefined && v.trim() !== "");
  if (raw === undefined) return "absent";
  return spec.valid(raw.trim(), env) ? "present" : "invalid";
}

/** One row per variable: present / absent / invalid — never the value. */
export function envReport(env: Env = process.env): EnvItem[] {
  return ENV_SPECS.map((s) => ({ name: s.names[0], group: s.group, required: s.required(env), status: statusOf(s, env), affects: s.affects }));
}

/** Names of the required variables that are absent or invalid. */
export function envProblems(env: Env = process.env, groups?: EnvGroup[]): string[] {
  return envReport(env)
    .filter((i) => i.required && i.status !== "present" && (!groups || groups.includes(i.group)))
    .map((i) => i.name);
}

/** The variables without which no money-moving flow may run: where it runs (RPC, network) and who is paid (treasury). */
export const MONEY_FLOW_ENV = ["SOLANA_RPC_URL", "NETWORK", "NEXT_PUBLIC_PANDA_TREASURY"] as const;

export function moneyFlowEnvProblems(env: Env = process.env): string[] {
  const report = envReport(env);
  return MONEY_FLOW_ENV.filter((n) => report.find((i) => i.name === n)?.status !== "present");
}

/** True for Solana's free public endpoints, which drop and rate-limit trades and refuse wallet-scanning queries. */
export function isPublicSolanaRpc(url: string | undefined): boolean {
  if (!url) return true; // nothing configured: serverRpcUrl() falls back to the public one
  try {
    const host = new URL(url).hostname;
    return host === "api.mainnet-beta.solana.com" || host === "api.devnet.solana.com" || host === "api.testnet.solana.com" || host === "solana-api.projectserum.com";
  } catch {
    return false;
  }
}
