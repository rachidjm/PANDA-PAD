import bs58 from "bs58";
import type { OpStep, PendingOp } from "@/lib/wallet/deeplink/ops";

/**
 * Finishing, in a copy of the Mini App that Telegram opened anew, an operation that another copy started
 * (src/lib/wallet/deeplink/ops.ts). The wallet has already done its part — signed, and for a buy, a sell or a launch
 * also SENT the transaction. What is left are the calls the website's own code makes afterwards, which that code wrote
 * down before the wallet opened. Nothing here can move money: it only delivers what the wallet signed, to the same
 * routes, which check it exactly as they always do.
 */

export type WalletAnswer = { signature?: unknown; transaction?: unknown; transactions?: unknown };
/** working: the answer is being collected · sent: the wallet sent the transaction · done: the signed operation was delivered · repeat: signed, but it can't be finished from here · error. */
export type Resumed = { phase: "working" | "sent" | "done" | "repeat" | "error"; signature?: string; message?: string };

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const post = (fetcher: Fetcher, step: OpStep, extra: Record<string, unknown>) => fetcher(step.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...step.body, ...extra }) });
const toBase64 = (b58: string) => btoa(String.fromCharCode(...bs58.decode(b58)));

/** True once the chain has confirmed the signature (asked through PANDA's own RPC proxy), false if it failed or didn't show in time. */
export async function waitConfirmed(fetcher: Fetcher, signature: string, timeoutMs = 45_000, everyMs = 2_000): Promise<boolean> {
  const started = Date.now();
  for (;;) {
    try {
      const res = await fetcher("/api/rpc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses", params: [[signature], { searchTransactionHistory: true }] }) });
      const status = ((await res.json().catch(() => null)) as { result?: { value?: ({ err: unknown; confirmationStatus?: string } | null)[] } } | null)?.result?.value?.[0];
      if (status?.err) return false;
      if (status && (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized")) return true;
    } catch {}
    if (Date.now() - started >= timeoutMs) return false;
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** Hands one signed transaction to the network. Its signature, or "" when the network refused it. */
async function relaySigned(fetcher: Fetcher, url: string, base64: string): Promise<string> {
  try {
    const res = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params: [base64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 }] }) });
    const data = (await res.json().catch(() => null)) as { result?: unknown } | null;
    return typeof data?.result === "string" ? data.result : "";
  } catch {
    return "";
  }
}

export async function completeOp(op: PendingOp, answer: WalletAnswer, fetcher: Fetcher, confirmed: (signature: string) => Promise<boolean> = (s) => waitConfirmed(fetcher, s)): Promise<Resumed> {
  if (op.method === "signAndSendTransaction") {
    const signature = typeof answer.signature === "string" ? answer.signature : "";
    if (!signature) return { phase: "error" };
    // The transaction is already on its way: whatever happens to the calls below, that is what the user is told.
    for (const step of op.then) {
      if (step.confirmed && !(await confirmed(signature))) continue;
      await post(fetcher, step, step.put === "signature" ? { signature } : {}).catch(() => undefined);
    }
    return { phase: "sent", signature };
  }
  if (op.method === "signAllTransactions" || op.method === "signTransaction") {
    const signed = Array.isArray(answer.transactions) ? answer.transactions : typeof answer.transaction === "string" ? [answer.transaction] : [];
    const relay = op.then.find((s) => s.put === "send");
    if (relay) {
      // A launch and its first buy, approved together: delivered to the network as they are, in order. The network
      // simulates each before accepting it (preflight), so one that would fail is not sent.
      if (signed.length === 0 || signed.some((s) => typeof s !== "string")) return { phase: "error" };
      let first = "";
      let last = "";
      for (const tx of signed as string[]) {
        const signature = await relaySigned(fetcher, relay.url, toBase64(tx));
        if (!signature || !(await confirmed(signature))) break;
        first ||= signature;
        last = signature;
      }
      // Nothing landed: it can be done again. The first landed: the coin exists, whatever happened to its buy.
      if (!first) return { phase: "error" };
      if (last !== first) for (const step of op.then) if (step.put === "signature") await post(fetcher, step, { signature: last }).catch(() => undefined);
      return { phase: "sent", signature: first };
    }
    const steps = op.then.filter((s) => s.put === "orders");
    // Signed, but the rest of that operation lived only in the copy of the app that is gone: nothing is delivered, and the screen says so.
    if (steps.length === 0) return { phase: "repeat" };
    for (const step of steps) {
      const ids = step.ids ?? [];
      if (ids.length === 0 || ids.length !== signed.length || signed.some((s) => typeof s !== "string")) return { phase: "error" };
      const res = await post(fetcher, step, { signed: ids.map((id, i) => ({ id, transaction: toBase64(signed[i] as string) })) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        return { phase: "error", message: data?.error };
      }
    }
    return { phase: "done" };
  }
  return { phase: "repeat" };
}
