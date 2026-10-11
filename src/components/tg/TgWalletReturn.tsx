"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type State = "sending" | "done" | "rejected" | "error";
const FIELDS = ["phantom_encryption_public_key", "solflare_encryption_public_key", "nonce", "data", "errorCode", "errorMessage"];

export default function TgWalletReturn({ botUsername }: { botUsername: string | null }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>("sending");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("r");
    const answer: Record<string, string> = {};
    for (const k of FIELDS) {
      const v = params.get(k);
      if (v) answer[k] = v;
    }
    // The answer leaves the address bar and the history at once: it is only useful to the Mini App.
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/tg/relay", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer }) });
        if (cancelled) return;
        setState(!res.ok ? "error" : answer.errorCode ? "rejected" : "done");
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const text = { sending: "tg.cb.sending", done: "tg.cb.done", rejected: "tg.cb.rejected", error: "tg.cb.error" } as const;
  return (
    <div className="mx-auto max-w-sm px-6 py-20 text-center">
      <p className="font-display text-3xl font-bold" aria-hidden>
        {state === "done" ? "\u2713" : state === "sending" ? "\u2026" : "!"}
      </p>
      <h1 className="mt-3 text-sm leading-relaxed text-paper/90" role="status">
        {t(text[state])}
      </h1>
      {state !== "sending" && botUsername && (
        <a href={`https://t.me/${botUsername}`} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-bamboo px-6 text-sm font-bold text-ink">
          {t("tg.cb.back")}
        </a>
      )}
      <p className="mt-6 text-xs leading-snug text-panda-grey">{t("tg.cb.note")}</p>
    </div>
  );
}
