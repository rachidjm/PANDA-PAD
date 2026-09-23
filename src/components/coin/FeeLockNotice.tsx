"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { applyFeeSplit } from "@/lib/pump/fee-split-client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Waiting = { creator: string; shareholders: { address: string; shareBps: number }[] | null };

async function fetchWaiting(mint: string): Promise<Waiting | null> {
  const d = await fetch(`/api/pump/fee-lock?mint=${mint}`, { cache: "no-store" }).then((r) => r.json());
  return d?.state === "waiting" && d.created ? { creator: d.creator, shareholders: d.shareholders } : null;
}

/**
 * Shown ONLY to the coin's creator, on every visit, while a coin PANDA launched in two transactions still has no fee split
 * on-chain (see src/lib/pump/fee-lock.ts): the coin is hidden from PANDA's lists until they set it. Anyone else sees nothing.
 * The server re-reads the chain for the answer; this component never decides on its own that a split is set.
 */
export default function FeeLockNotice({ mint }: { mint: string }) {
  const { t } = useLanguage();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const me = publicKey?.toBase58();

  useEffect(() => {
    // Nothing is shown without a connected wallet (the render below requires it to be the creator), so there is nothing to reset here.
    if (!me) return;
    let cancelled = false;
    fetchWaiting(mint)
      .then((w) => !cancelled && setWaiting(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [me, mint]);

  if (!waiting || !me || waiting.creator !== me) return null;

  async function set() {
    if (!waiting?.shareholders) return;
    setBusy(true);
    setError("");
    try {
      await applyFeeSplit({ connection, publicKey, sendTransaction, mint, shareholders: waiting.shareholders, errors: { noWallet: t("cr.err.buyWallet"), build: t("cr.err.build") } });
      setWaiting(await fetchWaiting(mint));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cr.err.build"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-clay-red/40 bg-clay-red/10 px-4 py-3 text-sm" role="alert">
      <p className="font-semibold text-clay-red">{t("cr.feesPendingTitle")}</p>
      <p className="mt-1 text-paper/80">{t("cr.feesPendingBody")}</p>
      <p className="mt-1 text-paper/80">{t("coin.feeLock.hidden")}</p>
      {error && <p className="mt-1 text-xs text-clay-red">{error}</p>}
      <button
        type="button"
        onClick={set}
        disabled={busy || !waiting.shareholders}
        className="mt-3 w-full rounded-full bg-paper py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:opacity-50 sm:w-auto sm:px-6"
      >
        {busy ? t("cr.stageFees") : t("cr.feesRetry")}
      </button>
    </div>
  );
}
