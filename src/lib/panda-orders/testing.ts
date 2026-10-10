/**
 * TEST-ONLY helpers for PANDA orders (never imported by app code): a fake chain (nonce accounts, a venue whose quote is a
 * plain number), fake deps for the service and the watcher, all on top of the real PGlite database.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Keypair, PublicKey, SystemProgram, TransactionInstruction, type AccountInfo } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import bs58 from "bs58";
import type { Db } from "@/lib/db/client";
import { openTx, sealTx } from "./crypto";
import type { Deps } from "./service";
import type { WatchDeps } from "./watcher";
import type { VenueState } from "./market";

export const TEST_ENV = { PANDA_ORDERS_KEY: randomBytes(32).toString("base64") };
export const TREASURY = Keypair.generate().publicKey;

/** An 80-byte initialised nonce account with this authority and nonce value. */
export function nonceInfo(authority: PublicKey, nonce: string, lamports = 1_056_640): AccountInfo<Buffer> {
  const data = Buffer.alloc(80);
  data.writeUInt32LE(1, 0);
  data.writeUInt32LE(1, 4);
  authority.toBuffer().copy(data, 8);
  new PublicKey(nonce).toBuffer().copy(data, 40);
  data.writeBigUInt64LE(BigInt(5000), 72);
  return { data, owner: SystemProgram.programId, lamports, executable: false, rentEpoch: 0 };
}

export const randomNonceValue = () => bs58.encode(randomBytes(32));

/** A fake venue: selling N raw tokens pays N × `lamportsPerToken` (mutable, to move the price in a test). */
export type FakeVenue = VenueState & { fake: { lamportsPerToken: number; migrated?: boolean } };
export function fakeVenue(venue: "curve" | "amm" = "curve", lamportsPerToken = 1): FakeVenue {
  return { venue, mint: Keypair.generate().publicKey, tokenProgram: TOKEN_PROGRAM_ID, pool: Keypair.generate().publicKey, fake: { lamportsPerToken } } as unknown as FakeVenue;
}

export type Chain = {
  accounts: Map<string, AccountInfo<Buffer> | null>;
  balances: Map<string, bigint>; // wallet → raw balance of the coin
  landed: Map<string, boolean>; // signature → ok
  sol: Map<string, number>; // wallet → lamports (missing = plenty)
  sim: (bytes: Uint8Array, opts: { replaceBlockhash: boolean }) => { err: unknown; logs: string[] | null };
  simulated: number;
  venue: FakeVenue | "unsupported";
  tokenUsd: number;
};

export function newChain(venue: FakeVenue | "unsupported" = fakeVenue()): Chain {
  return { accounts: new Map(), balances: new Map(), landed: new Map(), sol: new Map(), sim: () => ({ err: null, logs: [] }), simulated: 0, venue, tokenUsd: 1 };
}

export function serviceDeps(db: Db, chain: Chain, over: Partial<Deps> = {}): Deps & { clock: { t: number }; audits: string[] } {
  const clock = { t: 1_000_000 };
  const audits: string[] = [];
  const deps: Deps = {
    now: () => clock.t,
    db: () => db,
    newId: () => randomUUID(),
    quoteUsd: async () => ({ tokenUsd: chain.tokenUsd, solUsd: 150 }),
    loadVenue: async () => chain.venue,
    quoteOut: (v, amount) => (amount * BigInt((v as FakeVenue).fake.lamportsPerToken * 1000)) / BigInt(1000),
    saleInstructions: async (_v, user, amount, minOut) => [
      new TransactionInstruction({ programId: new PublicKey("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P"), keys: [{ pubkey: user, isSigner: false, isWritable: true }], data: Buffer.from(`${amount}:${minOut}`) }),
    ],
    tokenBalance: async (wallet) => ({ raw: chain.balances.get(wallet.toBase58()) ?? BigInt(0), decimals: 6 }),
    accounts: async (keys) => keys.map((k) => chain.accounts.get(k.toBase58()) ?? null),
    rentLamports: async () => 1_056_640,
    latestBlockhash: async () => randomNonceValue(),
    lookupTable: async () => null,
    feeBps: async () => 100,
    feeInstructions: async (wallet, fee) => (fee > BigInt(0) ? [SystemProgram.transfer({ fromPubkey: wallet, toPubkey: TREASURY, lamports: fee })] : []),
    signatureStatuses: async (sigs) => sigs.map((s) => (chain.landed.has(s) ? { ok: chain.landed.get(s)! } : null)),
    solBalance: async (wallet) => chain.sol.get(wallet.toBase58()) ?? 1_000_000_000,
    simulate: async (bytes, opts) => {
      chain.simulated++;
      return chain.sim(bytes, opts);
    },
    hasKey: () => true,
    seal: (id, bytes) => sealTx(id, bytes, TEST_ENV),
    open: (id, sealed) => openTx(id, sealed, TEST_ENV),
    audit: async (e) => {
      audits.push(e.action);
    },
    ...over,
  };
  return Object.assign(deps, { clock, audits });
}

export type SimResult = { err: unknown; logs: string[] | null };

export function watchDeps(
  db: Db,
  chain: Chain,
  sim: (bytes: Uint8Array) => SimResult,
  over: Partial<WatchDeps> = {}
): WatchDeps & { clock: { t: number }; sent: Uint8Array[]; alerts: string[] } {
  const clock = { t: 5_000_000 };
  const sent: Uint8Array[] = [];
  const alerts: string[] = [];
  const deps: WatchDeps = {
    now: () => clock.t,
    sleep: async (ms) => {
      clock.t += ms;
    },
    db: () => db,
    loadVenue: async () => chain.venue,
    priceAccounts: () => [],
    refreshVenue: (v) => ((v as FakeVenue).fake.migrated ? "migrated" : v),
    quoteOut: (v, amount) => (amount * BigInt(Math.round((v as FakeVenue).fake.lamportsPerToken * 1000))) / BigInt(1000),
    accounts: async (keys) => keys.map((k) => chain.accounts.get(k.toBase58()) ?? null),
    open: (id, sealed) => openTx(id, sealed, TEST_ENV),
    simulate: async (bytes) => sim(bytes),
    send: async (bytes) => {
      sent.push(bytes);
    },
    statuses: async (sigs) => sigs.map((s) => (chain.landed.has(s) ? { ok: chain.landed.get(s)! } : null)),
    audit: async () => {},
    alert: async (m) => {
      alerts.push(m);
    },
    ...over,
  };
  return Object.assign(deps, { clock, sent, alerts });
}
