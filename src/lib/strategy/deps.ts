import { Connection, Transaction } from "@solana/web3.js";
import { craftDeposit, createOrder, listOrders } from "@/lib/jupiter/trigger";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { PANDA_TREASURY } from "@/lib/pump/constants";
import { buildFeeTransaction, checkSignedFeeTx } from "./fee";
import { strategyQuote } from "./market";
import type { Deps } from "./service";

/** The real dependencies: live prices, Jupiter's Trigger API, and the chain. Server-only. */
export function realDeps(): Deps {
  return {
    now: () => Date.now(),
    engineConfigured: () => !!process.env.JUPITER_API_KEY,
    quote: strategyQuote,
    jupiter: { craftDeposit, createOrder, listOrders },
    fee: {
      treasury: PANDA_TREASURY.toBase58(),
      build: async (wallet, lamports) => {
        const connection = new Connection(serverRpcUrl(), "confirmed");
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = buildFeeTransaction({ wallet, treasury: PANDA_TREASURY.toBase58(), lamports, blockhash, lastValidBlockHeight });
        return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
      },
      check: checkSignedFeeTx,
      send: async (signedBase64) => {
        const connection = new Connection(serverRpcUrl(), "confirmed");
        const raw = Buffer.from(signedBase64, "base64");
        Transaction.from(raw); // readable, or this throws before anything is sent
        const signature = await connection.sendRawTransaction(raw, { maxRetries: 3 });
        // Wait for it to land (about 12 s: the whole request must fit in a serverless function), so "paid" only ever means paid.
        for (let i = 0; i < 6; i++) {
          const status = (await connection.getSignatureStatuses([signature])).value[0];
          if (status?.err) throw new Error("The fee transaction failed on-chain.");
          if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return signature;
          await new Promise((r) => setTimeout(r, 2000));
        }
        throw new Error("The fee transaction did not confirm in time.");
      },
    },
    verifyTx: async (signature) => {
      try {
        const res = await new Connection(serverRpcUrl(), "confirmed").getSignatureStatuses([signature], { searchTransactionHistory: true });
        const status = res.value[0];
        return !!status && !status.err && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized");
      } catch {
        return false;
      }
    },
  };
}
