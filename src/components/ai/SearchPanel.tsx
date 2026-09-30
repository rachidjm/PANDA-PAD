"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAiCall } from "./useAiCall";
import { useAIAssistant } from "./AIAssistantProvider";
import type { AiCoinFilter } from "@/lib/ai/coin-filter";

/** Handed off to DiscoverClient.tsx via localStorage — see that file's own AI_FILTER_KEY. */
const STORAGE_KEY = "panda.ai.filter";

/** "Buscar monedas": free-text filters, applied on Discover. */
export default function SearchPanel() {
  const { t } = useLanguage();
  const router = useRouter();
  const { close } = useAIAssistant();
  const [query, setQuery] = useState("");
  const { call, loading, error } = useAiCall<{ filter: AiCoinFilter }>("/api/ai/search-filters");

  async function submit() {
    if (!query.trim() || loading) return;
    const res = await call({ query: query.trim() });
    if (res) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(res.filter));
      } catch {}
      close();
      router.push("/discover");
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("ai.search.placeholder")}
        rows={2}
        disabled={loading}
        className="w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={loading || !query.trim()}
        className="w-full rounded-full bg-paper py-2.5 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? t("ai.search.loading") : t("ai.search.submit")}
      </button>
      {error && (
        <p className="text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
