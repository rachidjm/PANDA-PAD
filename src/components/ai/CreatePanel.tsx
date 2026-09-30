"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useAiCall } from "./useAiCall";
import { useAIAssistant } from "./AIAssistantProvider";

export type CreateIdeaProposal = { name: string; ticker: string; description: string };

/** "Crear moneda con IA": describe an idea, get 3 proposals, pick one → /create is pre-filled with it (the
 *  image is still uploaded by hand there — never generated or picked here). */
export default function CreatePanel() {
  const { t } = useLanguage();
  const router = useRouter();
  const { close } = useAIAssistant();
  const [idea, setIdea] = useState("");
  const [proposals, setProposals] = useState<CreateIdeaProposal[] | null>(null);
  const { call, loading, error } = useAiCall<{ proposals: CreateIdeaProposal[] }>("/api/ai/create-ideas");

  async function submit() {
    if (!idea.trim() || loading) return;
    setProposals(null);
    const res = await call({ idea: idea.trim() });
    if (res) setProposals(res.proposals);
  }

  function pick(p: CreateIdeaProposal) {
    const params = new URLSearchParams({ aiName: p.name, aiTicker: p.ticker, aiDescription: p.description });
    close();
    router.push(`/create?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <textarea
        value={idea}
        onChange={(e) => setIdea(e.target.value)}
        placeholder={t("ai.create.placeholder")}
        rows={3}
        disabled={loading}
        className="w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40 disabled:opacity-60"
      />
      <button
        type="button"
        onClick={submit}
        disabled={loading || !idea.trim()}
        className="w-full rounded-full bg-paper py-2.5 text-sm font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {loading ? t("ai.create.loading") : t("ai.create.submit")}
      </button>
      {error && (
        <p className="text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
      {proposals && proposals.length > 0 && (
        <div className="space-y-2">
          {proposals.map((p, i) => (
            <div key={i} className="rounded-2xl border border-paper/10 bg-ink px-4 py-3">
              <p className="font-display text-sm font-bold">
                {p.name} <span className="font-medium text-panda-grey">${p.ticker}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-panda-grey">{p.description}</p>
              <button
                type="button"
                onClick={() => pick(p)}
                className="mt-2.5 rounded-full bg-meme-orange px-3.5 py-1.5 text-xs font-bold text-ink transition hover:brightness-110"
              >
                {t("ai.create.use")}
              </button>
            </div>
          ))}
          <p className="text-[11px] text-panda-grey">{t("ai.create.hint")}</p>
        </div>
      )}
    </div>
  );
}
