"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { parseReturnAnswer, parseReturnPath } from "@/lib/wallet/deeplink/protocol";

type State = "sending" | "done" | "rejected" | "error";

export default function TgWalletReturn({ botUsername }: { botUsername: string | null }) {
  const { t } = useLanguage();
  const [state, setState] = useState<State>("sending");
  const [back, setBack] = useState<string | null>(null);

  useEffect(() => {
    const where = parseReturnPath(window.location.pathname);
    // An address from before the slot moved into the path still works.
    const id = where?.relayId ?? new URLSearchParams(window.location.search.replace(/\?/g, "&")).get("r");
    const answer = parseReturnAnswer(window.location.search, window.location.hash);
    // The answer leaves the address bar and the history at once: it is only useful to the Mini App.
    window.history.replaceState(null, "", window.location.pathname);
    let cancelled = false;
    (async () => {
      let ok = false;
      // The phone has just switched apps: one failed attempt is not the end.
      for (let attempt = 0; attempt < 3 && !ok && !cancelled; attempt++) {
        try {
          const res = await fetch("/api/tg/relay", { method: "PUT", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, answer }) });
          ok = res.ok;
          if (!ok && res.status < 500 && res.status !== 429) break;
        } catch {
          // offline for a moment
        }
        if (!ok) await new Promise((r) => setTimeout(r, 1200));
      }
      if (cancelled) return;
      setBack(where?.back ?? null);
      setState(!ok ? "error" : answer.errorCode ? "rejected" : "done");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const text = { sending: "tg.cb.sending", done: "tg.cb.done", rejected: "tg.cb.rejected", error: "tg.cb.error" } as const;
  // The bot's own link opens its Mini App again — on the coin the user was looking at, when the address says which.
  const link = botUsername ? `https://t.me/${botUsername}?startapp=${back ? `c_${back}` : "back"}` : null;
  return (
    <div className="mx-auto max-w-sm px-6 py-20 text-center">
      <p className="font-display text-3xl font-bold" aria-hidden>
        {state === "done" ? "\u2713" : state === "sending" ? "\u2026" : "!"}
      </p>
      <h1 className="mt-3 text-sm leading-relaxed text-paper/90" role="status">
        {t(text[state])}
      </h1>
      {state !== "sending" && link && (
        <a href={link} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-bamboo px-6 text-sm font-bold text-ink">
          {t("tg.cb.back")}
        </a>
      )}
      <p className="mt-6 text-xs leading-snug text-panda-grey">{t("tg.cb.note")}</p>
    </div>
  );
}
