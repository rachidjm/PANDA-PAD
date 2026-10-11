"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { parseReturnAnswer, parseReturnPath } from "@/lib/wallet/deeplink/protocol";

type State = "sending" | "done" | "rejected" | "error";

/**
 * Only brings the Telegram APP back to the front — it opens nothing in it. The Mini App is still open there, as the
 * user left it, and is the one that collects the wallet's answer and carries on. ("tg://resolve" with no account is a
 * Telegram address that names nothing to open.)
 */
export const BACK_TO_TELEGRAM = "tg://resolve";

/**
 * The page the wallet app comes back to (src/app/telegram/wallet). `stored` is what the SERVER already did with the
 * wallet's answer while building this page: when it is there, nothing is left to send and the page goes straight back
 * to Telegram by itself; the button is for a browser that asks before leaving. When it isn't (an answer that arrived
 * in a form the server doesn't see), the page delivers it itself first.
 */
export default function TgWalletReturn({ stored = null }: { stored?: "done" | "rejected" | null }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>(stored ?? "sending");

  useEffect(() => {
    const where = parseReturnPath(window.location.pathname);
    // An address from before the slot moved into the path still works.
    const id = where?.relayId ?? new URLSearchParams(window.location.search.replace(/\?/g, "&")).get("r");
    const answer = parseReturnAnswer(window.location.search, window.location.hash);
    // The answer leaves the address bar and the history at once: it is only useful to the Mini App.
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    const goBack = () => {
      try {
        window.location.href = BACK_TO_TELEGRAM;
      } catch {}
    };
    if (stored) {
      goBack();
      return;
    }
    (async () => {
      let ok = false;
      // The phone has just switched apps: one failed attempt is not the end.
      for (let attempt = 0; attempt < 3 && !ok && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/tg/relay", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer }) });
          ok = res.ok || res.status === 410; // 410: it was already delivered
          if (!ok && res.status < 500 && res.status !== 429) break;
        } catch {
          // offline for a moment
        }
        if (!ok) await new Promise((r) => setTimeout(r, 1200));
      }
      if (cancelled) return;
      setState(!ok ? "error" : answer.errorCode ? "rejected" : "done");
      if (ok) goBack();
    })();
    return () => {
      cancelled = true;
    };
  }, [stored]);

  const text = { sending: "tg.cb.sending", done: "tg.cb.done", rejected: "tg.cb.rejected", error: "tg.cb.error" } as const;
  return (
    <div className="mx-auto max-w-sm px-6 py-20 text-center">
      <p className="font-display text-3xl font-bold" aria-hidden>
        {state === "done" ? "✓" : state === "sending" ? "…" : "!"}
      </p>
      <h1 className="mt-3 text-sm leading-relaxed text-paper/90" role="status">
        {t(text[state])}
      </h1>
      {state !== "sending" && (
        <a href={BACK_TO_TELEGRAM} className="mt-6 inline-flex min-h-12 items-center rounded-full bg-bamboo px-7 text-sm font-bold text-ink">
          {t("tg.cb.back")}
        </a>
      )}
      <p className="mt-6 text-xs leading-snug text-panda-grey">{t("tg.cb.note")}</p>
    </div>
  );
}
