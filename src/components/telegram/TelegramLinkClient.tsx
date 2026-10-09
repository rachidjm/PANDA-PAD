"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

type Phase = "idle" | "signing" | "done" | "confirm_replace";

const ERRORS: Record<string, DictKey> = {
  invalid: "tg.link.err.invalid",
  code_used_or_expired: "tg.link.err.expired",
  bad_signature: "tg.link.err.signature",
};

/**
 * Links the connected wallet to the Telegram account that asked for this /link code: the server hands back the exact message
 * (domain, wallet, Telegram id, code, dates), the wallet signs it (free, moves nothing), the server checks it and burns the code.
 */
export default function TelegramLinkClient() {
  const { t } = useLanguage();
  const code = useSearchParams().get("code") ?? "";
  const { publicKey, signMessage, connected } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function link(replace: boolean) {
    if (!publicKey || !signMessage) return;
    setError(null);
    setPhase("signing");
    try {
      const wallet = publicKey.toBase58();
      const m = await fetch("/api/telegram/link/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, wallet, replace }) });
      const md = await m.json().catch(() => ({}));
      if (!m.ok) throw new Error(md.code ?? "invalid");
      let signature: Uint8Array;
      try {
        signature = await signMessage(new TextEncoder().encode(md.message));
      } catch {
        throw new Error("rejected");
      }
      const r = await fetch("/api/telegram/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, wallet, signature: bs58.encode(signature), replace }) });
      const rd = await r.json().catch(() => ({}));
      if (r.status === 409 && rd.code === "linked_elsewhere") {
        setPhase("confirm_replace");
        return;
      }
      if (!r.ok) throw new Error(rd.code ?? "invalid");
      setPhase("done");
    } catch (err) {
      const c = err instanceof Error ? err.message : "invalid";
      setError(c === "rejected" ? t("tg.link.err.rejected") : t(ERRORS[c] ?? "tg.link.err.invalid"));
      setPhase("idle");
    }
  }

  return (
    <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h1 className="font-display text-2xl font-bold">{t("tg.link.title")}</h1>
      <p className="mt-2 text-sm leading-relaxed text-panda-grey">{t("tg.link.body")}</p>
      <p className="mt-3 rounded-xl bg-clay-red/10 px-3.5 py-2.5 text-xs leading-relaxed text-clay-red">{t("tg.link.never")}</p>

      {!/^[A-Za-z0-9_-]{24}$/.test(code) ? (
        <p className="mt-5 text-sm text-clay-red">{t("tg.link.err.invalid")}</p>
      ) : phase === "done" ? (
        <p className="mt-5 text-sm font-semibold text-bamboo">{t("tg.link.done")}</p>
      ) : !connected ? (
        <p className="mt-5 text-sm text-paper/80">{t("tg.link.connect")}</p>
      ) : phase === "confirm_replace" ? (
        <div className="mt-5">
          <p className="text-sm text-sun">{t("tg.link.replaceWarn")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => link(true)} className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90">
              {t("tg.link.replace")}
            </button>
            <button type="button" onClick={() => setPhase("idle")} className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40">
              {t("tg.link.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => link(false)}
          disabled={phase === "signing" || !signMessage}
          className="mt-5 w-full rounded-full bg-paper py-3 text-sm font-bold text-ink transition hover:brightness-90 disabled:opacity-50"
        >
          {phase === "signing" ? t("tg.link.signing") : t("tg.link.sign")}
        </button>
      )}
      {connected && !signMessage && <p className="mt-3 text-xs text-clay-red">{t("auth.noSign")}</p>}
      {error && (
        <p className="mt-3 text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
