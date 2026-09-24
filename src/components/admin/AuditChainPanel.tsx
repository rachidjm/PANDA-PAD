"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildAnchorTx } from "@/lib/audit/anchor";
import { confirmSignature } from "@/lib/solana/confirm";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Chain = { ok: boolean; checked: number; length: number; head: { seq: number; hash: string } | null; problem?: { seq: number | null; reason: string } };

/** /admin: verify the audit hash chain and anchor its head on Solana (the admin's wallet signs a memo). The server re-checks everything. */
export default function AuditChainPanel({ mode }: { mode: string }) {
  const { t } = useLanguage();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [chain, setChain] = useState<Chain | null>(null);
  const [anchors, setAnchors] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function verify() {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/audit?limit=1&verify=1", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed.");
      setChain(d.chain);
      const a = await fetch("/api/admin/audit/anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "list" }) }).then((r) => r.json());
      setAnchors(Array.isArray(a.anchors) ? a.anchors.length : null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  async function anchor() {
    if (!publicKey) return;
    setBusy(true);
    setMessage("");
    try {
      const post = async (body: Record<string, unknown>) => {
        const res = await fetch("/api/admin/audit/anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || "Failed.");
        return d;
      };
      const head = await post({ action: "head" }); // the server verifies the chain first: a broken chain is never anchored
      const signature = await sendTransaction(buildAnchorTx(publicKey, head.seq, head.hash), connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await confirmSignature(connection, signature);
      await post({ action: "record", signature });
      setMessage(t("admin.audit.anchored"));
      await verify();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-5 rounded-2xl border border-paper/10 bg-ink p-4">
      <h3 className="text-xs font-medium">{t("admin.audit.chain")}</h3>
      {mode === "blob" ? (
        <p className="mt-2 text-xs text-panda-grey">{t("admin.audit.blobOnly")}</p>
      ) : (
        <>
          <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.audit.chainHelp")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={verify} disabled={busy} className="rounded-full bg-paper px-4 py-1.5 text-xs font-semibold text-ink hover:opacity-90 disabled:opacity-50">
              {t("admin.audit.verify")}
            </button>
            <button onClick={anchor} disabled={busy || !publicKey || chain?.ok === false} className="rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold hover:border-paper/40 disabled:opacity-50">
              {t("admin.audit.anchor")}
            </button>
            <span className="text-[11px] text-panda-grey">{t("admin.audit.anchorHelp")}</span>
          </div>
          {chain && (
            <p className={`mt-3 text-xs ${chain.ok ? "text-bamboo" : "text-clay-red"}`}>
              {chain.ok
                ? t("admin.audit.ok", { n: chain.checked, seq: chain.head?.seq ?? 0, hash: chain.head?.hash.slice(0, 12) ?? "" })
                : t("admin.audit.broken", { seq: chain.problem?.seq ?? "?", reason: chain.problem?.reason ?? "" })}
              {anchors !== null && <span className="ml-2 text-panda-grey">{t("admin.audit.anchors", { n: anchors })}</span>}
            </p>
          )}
        </>
      )}
      {message && <p className="mt-2 text-xs text-panda-grey">{message}</p>}
    </div>
  );
}
