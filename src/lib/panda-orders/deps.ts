import { Connection, NONCE_ACCOUNT_LENGTH, PublicKey, VersionedTransaction, type AccountInfo } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { getDb } from "@/lib/db/client";
import { strategyQuote } from "@/lib/strategy/market";
import { feeBpsForWallet } from "@/lib/pump/fee-tier";
import { feeTransferInstructions } from "@/lib/pump/fee-transfer";
import { recordAudit } from "@/lib/audit/log";
import { alertOps } from "@/lib/alerts";
import { hasOrdersKey, openTx, sealTx } from "./crypto";
import { getOrdersLookupTable } from "./alt";
import { loadVenue, priceAccounts, quoteOut, refreshVenue, saleInstructions } from "./market";
import { newOrderId, type Deps } from "./service";
import type { WatchDeps } from "./watcher";

/** The real dependencies of PANDA orders: the chain (PANDA's own RPC), Postgres, prices, fees, audit. Server-only. */

const connection = () => new Connection(serverRpcUrl(), "confirmed");

async function accounts(c: Connection, addresses: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
  const out: (AccountInfo<Buffer> | null)[] = [];
  for (let k = 0; k < addresses.length; k += 100) out.push(...(await c.getMultipleAccountsInfo(addresses.slice(k, k + 100), "confirmed")));
  return out;
}

async function statuses(c: Connection, signatures: string[]): Promise<({ ok: boolean } | null)[]> {
  const res = await c.getSignatureStatuses(signatures, { searchTransactionHistory: true });
  return res.value.map((s) => {
    if (!s || !(s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return null;
    return { ok: !s.err };
  });
}

const audit = (e: { actor: string; action: string; object: string; newState?: unknown; reason?: string }) => recordAudit(e);

export function realDeps(): Deps {
  const c = connection();
  return {
    now: () => Date.now(),
    db: getDb,
    newId: newOrderId,
    quoteUsd: async (mint) => {
      const q = await strategyQuote(mint);
      return { tokenUsd: q.tokenUsd, solUsd: q.solUsd };
    },
    loadVenue: (mint, user, pool) => loadVenue(c, mint, user, pool),
    quoteOut,
    saleInstructions,
    tokenBalance: async (wallet, mint, tokenProgram) => {
      const ata = getAssociatedTokenAddressSync(mint, wallet, true, tokenProgram);
      try {
        const b = await c.getTokenAccountBalance(ata, "confirmed");
        return { raw: BigInt(b.value.amount), decimals: b.value.decimals };
      } catch {
        return { raw: BigInt(0), decimals: 0 }; // no token account = nothing to sell
      }
    },
    accounts: (a) => accounts(c, a),
    rentLamports: () => c.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH),
    latestBlockhash: async () => (await c.getLatestBlockhash("confirmed")).blockhash,
    lookupTable: () => getOrdersLookupTable(c),
    feeBps: feeBpsForWallet,
    feeInstructions: (wallet, fee) => feeTransferInstructions(c, wallet, fee),
    signatureStatuses: (s) => statuses(c, s),
    solBalance: (wallet) => c.getBalance(wallet, "confirmed"),
    simulate: async (bytes, opts) => {
      const r = await c.simulateTransaction(VersionedTransaction.deserialize(bytes), { sigVerify: false, replaceRecentBlockhash: opts.replaceBlockhash, commitment: "confirmed" });
      return { err: r.value.err, logs: r.value.logs };
    },
    hasKey: () => hasOrdersKey(),
    seal: (id, bytes) => sealTx(id, bytes),
    open: (id, sealed) => openTx(id, sealed),
    audit,
  };
}

export function realWatchDeps(): WatchDeps {
  const c = connection();
  return {
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    db: getDb,
    loadVenue: (mint, user, pool) => loadVenue(c, mint, user, pool),
    priceAccounts,
    refreshVenue,
    quoteOut,
    accounts: (a) => accounts(c, a),
    open: (id, sealed) => openTx(id, sealed),
    simulate: async (bytes) => {
      const tx = VersionedTransaction.deserialize(bytes);
      const r = await c.simulateTransaction(tx, { sigVerify: true, replaceRecentBlockhash: false, commitment: "confirmed" });
      return { err: r.value.err, logs: r.value.logs };
    },
    send: async (bytes) => {
      await c.sendRawTransaction(bytes, { skipPreflight: true, maxRetries: 0 });
    },
    statuses: (s) => statuses(c, s),
    audit,
    alert: (message, detail) => alertOps(message, detail ?? {}),
  };
}
