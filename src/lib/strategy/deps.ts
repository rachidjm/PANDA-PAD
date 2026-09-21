import { Connection } from "@solana/web3.js";
import { craftDeposit, createOrder, listOrders } from "@/lib/jupiter/trigger";
import { serverRpcUrl } from "@/lib/solana/rpc";
import { strategyQuote } from "./market";
import type { Deps } from "./service";

/** The real dependencies: live prices, Jupiter's Trigger API, and the chain. Server-only. */
export function realDeps(): Deps {
  return {
    now: () => Date.now(),
    engineConfigured: () => !!process.env.JUPITER_API_KEY,
    quote: strategyQuote,
    jupiter: { craftDeposit, createOrder, listOrders },
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
