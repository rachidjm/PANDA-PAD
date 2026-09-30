"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

/** One POST to an /api/ai/* route, with the connected wallet (or null) and the current UI language attached
 *  automatically — every AI route uses these the same way (quota + reply language). Loading/error state is
 *  shared so every panel (Create/Analyze/Draw/Search) looks and behaves the same. */
export function useAiCall<TResult>(endpoint: string) {
  const { publicKey } = useWallet();
  const { lang, t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<TResult | null> {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, wallet: publicKey ? publicKey.toBase58() : null, lang }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let key: DictKey = "ai.genericError";
        if (res.status === 429 && data.code === "wallet_limit") key = "ai.quotaWallet";
        else if (res.status === 429 && data.code === "ip_limit") key = "ai.quotaIp";
        else if (res.status === 503 && data.code === "budget") key = "ai.budgetExceeded";
        else if (res.status === 503) key = "ai.unavailable";
        setError(t(key));
        return null;
      }
      return data as TResult;
    } catch {
      setError(t("ai.genericError"));
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { call, loading, error, setError };
}
