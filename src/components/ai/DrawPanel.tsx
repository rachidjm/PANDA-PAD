"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAiCall } from "./useAiCall";
import { useDrawTradeAIBridge } from "./DrawTradeAIBridge";
import { useAIAssistant } from "./AIAssistantProvider";

type AiDrawTradeResult = { buyPrice: number; sellPrice: number; stopPrice: number; note: string };

/** "Ayuda con Draw Your Trade": turns a plain-language strategy into a DRAFT on the current coin's chart —
 *  never confirms it. Only usable from an actual coin page (the bridge is null everywhere else). */
export default function DrawPanel() {
  const { t } = useLanguage();
  const { draw, coin } = useDrawTradeAIBridge();
  const { close } = useAIAssistant();
  const [description, setDescription] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const { call, loading, error } = useAiCall<AiDrawTradeResult>("/api/ai/draw-trade");

  if (!draw || !coin) {
    return <p className="rounded-2xl border border-paper/10 bg-ink px-4 py-3 text-sm text-panda-grey">{t("ai.draw.needCoin")}</p>;
  }

  async function submit() {
    if (!description.trim() || loading || !coin || coin.currentPriceUsd === null) return;
    setApplied(null);
    const res = await call({ description: description.trim(), mint: coin.mint, ticker: coin.ticker, currentPriceUsd: coin.currentPriceUsd });
    if (res && draw) {
      draw.applyAiDraft({ buy: res.buyPrice, sell: res.sellPrice, stop: res.stopPrice });
      setApplied(res.note);
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t("ai.draw.placeholder")}
        rows={3}
        disabled={loading}
        className="w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={loading || !description.trim()}
        className="w-full rounded-full bg-paper py-2.5 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? t("ai.draw.loading") : t("ai.draw.submit")}
      </button>
      {error && (
        <p className="text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {applied && (
        <div className="rounded-2xl border border-bamboo/40 bg-bamboo/10 px-4 py-3 text-sm">
          <p className="font-semibold text-bamboo">{applied}</p>
          <p className="mt-1 text-xs text-panda-grey">{t("ai.draw.applied")}</p>
          <button type="button" onClick={close} className="mt-2.5 rounded-full bg-paper px-3.5 py-1.5 text-xs font-bold text-ink transition hover:brightness-90">
            {t("ai.menu.close")}
          </button>
        </div>
      )}
    </div>
  );
}
