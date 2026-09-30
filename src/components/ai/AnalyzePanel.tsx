"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAiCall } from "./useAiCall";
import { useDrawTradeAIBridge } from "./DrawTradeAIBridge";

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** "Analizar moneda": a plain-language summary built from real, already-fetched data — never a buy/sell
 *  recommendation (the server appends the fixed disclaimer, see src/app/api/ai/analyze/route.ts). Works from
 *  a coin's own page (one tap) or by pasting any address. */
export default function AnalyzePanel() {
  const { t } = useLanguage();
  const { coin } = useDrawTradeAIBridge();
  const [mint, setMint] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const { call, loading, error, setError } = useAiCall<{ summary: string }>("/api/ai/analyze");

  async function run(m: string) {
    if (loading) return;
    if (!ADDRESS.test(m)) {
      setError(t("ai.analyze.invalidMint"));
      return;
    }
    setSummary(null);
    const res = await call({ mint: m });
    if (res) setSummary(res.summary);
  }

  return (
    <div className="space-y-3">
      {coin && (
        <button
          type="button"
          onClick={() => run(coin.mint)}
          disabled={loading}
          className="w-full rounded-full border border-paper/20 py-2 text-sm font-semibold transition hover:border-paper/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t("ai.analyze.useCurrent", { ticker: coin.ticker })}
        </button>
      )}
      <input
        value={mint}
        onChange={(e) => setMint(e.target.value.trim())}
        placeholder={t("ai.analyze.placeholder")}
        disabled={loading}
        className="w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={() => run(mint)}
        disabled={loading || !mint}
        className="w-full rounded-full bg-paper py-2.5 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? t("ai.analyze.loading") : t("ai.analyze.submit")}
      </button>
      {error && (
        <p className="text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {summary && <p className="whitespace-pre-line rounded-2xl border border-paper/10 bg-ink px-4 py-3 text-sm leading-relaxed">{summary}</p>}
    </div>
  );
}
