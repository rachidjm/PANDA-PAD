"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** /admin: end every live session of a (suspicious) wallet. The server checks admin rights, audits and alerts. */
export default function SessionsPanel() {
  const { t } = useLanguage();
  const [wallet, setWallet] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function revoke() {
    if (!window.confirm(`${t("admin.sessions.revoke")}: ${wallet.trim()}?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/admin/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet: wallet.trim(), reason }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Failed.");
      setError(false);
      setMessage(t("admin.sessions.done", { n: d.revoked }));
      setReason("");
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.sessions.title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.sessions.help")}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={wallet} onChange={(e) => setWallet(e.target.value)} placeholder={t("admin.sessions.wallet")} className="min-w-0 rounded-xl bg-ink px-3 py-2 font-mono text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("admin.sessions.reason")} className="min-w-0 rounded-xl bg-ink px-3 py-2 text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30" />
        <button onClick={revoke} disabled={busy || !wallet.trim() || reason.trim().length < 3} className="rounded-full bg-clay-red px-4 py-2 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50">
          {t("admin.sessions.revoke")}
        </button>
      </div>
      {message && <p className={`mt-3 text-xs ${error ? "text-clay-red" : "text-bamboo"}`}>{message}</p>}
    </section>
  );
}
