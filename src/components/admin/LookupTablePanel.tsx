"use client";

import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { buildCreateTableTx, buildFreezeTx } from "@/lib/pump/alt-admin";
import { confirmSignature } from "@/lib/solana/confirm";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { TableCheck } from "@/lib/pump/launch-alt-check";

type Plan = { addresses: string[]; rentLamports: number; configured: string | null; current: TableCheck | null };
type Busy = null | "create" | "freeze" | "verify";

/**
 * /admin: creates PANDA's launch Address Lookup Table with the connected wallet (Phantom signs; no key file). Two transactions:
 * create+fill, then freeze. Afterwards the server re-reads the table from the chain and says whether a launch fits; only then is the
 * address shown for PANDA_LOOKUP_TABLE. Everything the server says is a fresh on-chain read, never this component's own opinion.
 */
export default function LookupTablePanel({ sessionTick = 0 }: { sessionTick?: number }) {
  const { t } = useLanguage();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [table, setTable] = useState("");
  const [existing, setExisting] = useState("");
  const [check, setCheck] = useState<TableCheck | null>(null);
  const [copied, setCopied] = useState(false);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/lookup-table", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? t("admin.alt.needSession") : data.error || "Failed.");
    return data;
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    post({ action: "plan" })
      .then((p) => !cancelled && setPlan(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [post, sessionTick]);

  async function verify(address: string) {
    setBusy("verify");
    setStep(t("admin.alt.step.verify"));
    try {
      const d = await post({ action: "verify", address });
      setCheck(d.check);
      setTable(address);
      return d.check as TableCheck;
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  async function create() {
    if (!publicKey || !window.confirm(t("admin.alt.confirm"))) return;
    setError("");
    setCheck(null);
    try {
      const addresses = (plan?.addresses ?? (await post({ action: "plan" })).addresses).map((a: string) => new PublicKey(a));
      setBusy("create");
      setStep(t("admin.alt.step.create"));
      // The slot must be recent: the context slot of a fresh blockhash is.
      const { context } = await connection.getLatestBlockhashAndContext("confirmed");
      const { tx, table: address } = buildCreateTableTx({ authority: publicKey, recentSlot: context.slot, addresses });
      const sig1 = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await confirmSignature(connection, sig1);
      setTable(address.toBase58());
      setStep(t("admin.alt.step.freeze"));
      setBusy("freeze");
      const sig2 = await sendTransaction(buildFreezeTx({ authority: publicKey, table: address }), connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await confirmSignature(connection, sig2);
      await post({ action: "record", address: address.toBase58(), signatures: [sig1, sig2] }).catch(() => {});
      await verify(address.toBase58());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  async function freezeExisting() {
    if (!publicKey || !table) return;
    setError("");
    try {
      setBusy("freeze");
      setStep(t("admin.alt.step.freeze"));
      const address = new PublicKey(table);
      const sig = await sendTransaction(buildFreezeTx({ authority: publicKey, table: address }), connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await confirmSignature(connection, sig);
      await verify(table);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  async function checkExisting() {
    setError("");
    try {
      await verify(existing.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    }
  }

  const sol = plan ? (plan.rentLamports / 1e9).toFixed(4) : "…";
  const ready = check?.ok === true;
  const authorityIsMe = !!check && !check.frozen && check.authority === publicKey?.toBase58();

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.alt.title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.alt.intro")}</p>

      {plan && (
        <p className={`mt-3 text-xs ${plan.current?.ok ? "text-bamboo" : "text-panda-grey"}`}>
          {!plan.configured ? t("admin.alt.state.none") : plan.current?.ok ? t("admin.alt.state.ok") : `${t("admin.alt.state.bad")} ${plan.configured}`}
        </p>
      )}
      {plan && <p className="mt-1 text-xs text-panda-grey">{t("admin.alt.cost", { sol, n: plan.addresses.length })}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={create}
          disabled={busy !== null || !publicKey || !plan}
          className="rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {t("admin.alt.create")}
        </button>
        {step && <span className="text-xs text-panda-grey">{step}</span>}
      </div>

      <div className="mt-5">
        <label className="text-xs text-panda-grey">{t("admin.alt.existing")}</label>
        <div className="mt-1.5 flex flex-wrap gap-2">
          <input
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
            placeholder="…"
            className="min-w-0 flex-1 rounded-xl bg-ink px-3 py-2 font-mono text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30"
          />
          <button onClick={checkExisting} disabled={busy !== null || !existing.trim()} className="rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold hover:border-paper/40 disabled:opacity-50">
            {t("admin.alt.verify")}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-clay-red">{error}</p>}

      {check && (
        <ul className="mt-4 space-y-1 text-xs">
          {!check.exists ? (
            <li className="text-clay-red">{t("admin.alt.check.notExists")}</li>
          ) : (
            <>
              {!check.active && <li className="text-clay-red">{t("admin.alt.check.inactive")}</li>}
              <li className={check.frozen ? "text-bamboo" : "text-clay-red"}>{check.frozen ? t("admin.alt.check.frozen") : t("admin.alt.check.notFrozen")}</li>
              <li className={check.missing.length === 0 ? "text-bamboo" : "text-clay-red"}>{check.missing.length === 0 ? t("admin.alt.check.complete") : t("admin.alt.check.missing", { n: check.missing.length })}</li>
              {check.fits.map((f) => (
                <li key={f.shareholders} className={f.bytes !== null && f.bytes <= 1232 ? "text-bamboo" : "text-clay-red"}>
                  {t("admin.alt.check.fits", { n: f.shareholders, bytes: f.bytes ?? t("admin.alt.check.notFit") })}
                </li>
              ))}
            </>
          )}
        </ul>
      )}

      {check && check.exists && !check.frozen && (
        <div className="mt-3">
          {authorityIsMe ? (
            <button onClick={freezeExisting} disabled={busy !== null} className="rounded-full bg-clay-red px-4 py-1.5 text-xs font-semibold text-paper hover:opacity-90 disabled:opacity-50">
              {t("admin.alt.freezeOnly")}
            </button>
          ) : (
            <p className="text-xs text-panda-grey">{t("admin.alt.notAuthority")}</p>
          )}
        </div>
      )}

      {ready && (
        <div className="mt-4 rounded-2xl border border-bamboo/40 bg-bamboo/10 p-4">
          <p className="text-xs font-semibold text-bamboo">{t("admin.alt.done")}</p>
          <p className="mt-2 break-all font-mono text-xs">PANDA_LOOKUP_TABLE={table}</p>
          <button
            onClick={() => {
              navigator.clipboard?.writeText(table).then(() => setCopied(true));
            }}
            className="mt-2 rounded-full border border-paper/20 px-3 py-1 text-xs font-semibold hover:border-paper/40"
          >
            {copied ? t("admin.alt.copied") : t("admin.alt.copy")}
          </button>
        </div>
      )}
    </section>
  );
}
