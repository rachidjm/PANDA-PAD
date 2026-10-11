"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import bs58 from "bs58";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState, type Adapter, type WalletName } from "@solana/wallet-adapter-base";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { BACK_TO_TELEGRAM, browseUrl, isPhone, LINK_WALLET_APPS, linkPageAddress, type LinkCodeState } from "@/lib/telegram/link-page";

type Phase = "idle" | "signing" | "done" | "confirm_replace";

const ERRORS: Record<string, DictKey> = {
  invalid: "tg.link.err.invalid",
  code_used_or_expired: "tg.link.err.expired",
  bad_signature: "tg.link.err.signature",
  no_sign: "auth.noSign",
  no_wallet: "tg.link.err.connect",
};

/**
 * Links a wallet to the Telegram account that asked for this one-time code (the bot's /link, or the Mini App's "Link my
 * wallet"): the server hands back the exact message (domain, wallet, Telegram id, code, dates), the wallet signs it
 * (free, moves nothing), the server checks it and burns the code.
 *
 * Telegram opens this page in the phone's own browser, where there is NO wallet. So the page looks first: a wallet
 * here (the wallet app's own browser, or a computer with the extension) gets one big "Connect and sign" button; a phone
 * without one gets "Open in Phantom" / "Open in Solflare", which open this same page inside that wallet app.
 */
export default function TelegramLinkClient({ botUsername }: { botUsername: string | null }) {
  const { t } = useLanguage();
  const code = useSearchParams().get("code") ?? "";
  const validShape = /^[A-Za-z0-9_-]{24}$/.test(code);
  const { wallets, select } = useWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<string | null>(null);
  const [replaceWith, setReplaceWith] = useState<Adapter | null>(null);
  // What the server says about the code before anyone signs (so nobody opens their wallet for a link that is over).
  const [codeState, setCodeState] = useState<LinkCodeState | "checking">(validShape ? "checking" : "invalid");
  // Wallets announce themselves a moment after the page loads: the choice of buttons waits for that moment.
  const [looked, setLooked] = useState(false);
  const [phone, setPhone] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setLooked(true), 700);
    Promise.resolve().then(() => setPhone(isPhone(navigator.userAgent)));
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!validShape) return;
    let cancelled = false;
    fetch(`/api/telegram/link?code=${encodeURIComponent(code)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { state?: LinkCodeState }) => !cancelled && setCodeState(d.state === "expired" || d.state === "invalid" ? d.state : "ok"))
      .catch(() => !cancelled && setCodeState("ok")); // not being able to ask is not a reason to stop: signing checks it again
    return () => {
      cancelled = true;
    };
  }, [code, validShape]);

  const here = wallets.filter((w) => w.readyState === WalletReadyState.Installed);

  /** "Connect and sign", in one go: the wallet is asked to connect and, straight after, to sign the link's message. */
  async function connectAndSign(adapter: Adapter, replace: boolean) {
    setError(null);
    setPhase("signing");
    try {
      try {
        if (!adapter.connected) await adapter.connect();
        select(adapter.name as WalletName);
      } catch {
        throw new Error("no_wallet");
      }
      const key = adapter.publicKey;
      if (!key) throw new Error("no_wallet");
      if (!("signMessage" in adapter) || typeof adapter.signMessage !== "function") throw new Error("no_sign");
      const wallet = key.toBase58();
      const m = await fetch("/api/telegram/link/message", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, wallet, replace }) });
      const md = await m.json().catch(() => ({}));
      if (!m.ok) throw new Error(md.code ?? "invalid");
      let signature: Uint8Array;
      try {
        signature = await adapter.signMessage(new TextEncoder().encode(md.message));
      } catch {
        throw new Error("rejected");
      }
      const r = await fetch("/api/telegram/link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, wallet, signature: bs58.encode(signature), replace }) });
      const rd = await r.json().catch(() => ({}));
      if (r.status === 409 && rd.code === "linked_elsewhere") {
        setReplaceWith(adapter);
        setPhase("confirm_replace");
        return;
      }
      if (!r.ok) throw new Error(rd.code ?? "invalid");
      setLinked(wallet);
      setPhase("done");
    } catch (err) {
      const c = err instanceof Error ? err.message : "invalid";
      if (c === "code_used_or_expired") setCodeState("expired");
      setError(c === "rejected" ? t("tg.link.err.rejected") : t(ERRORS[c] ?? "tg.link.err.invalid"));
      setPhase("idle");
    }
  }

  const big = "flex min-h-14 w-full items-center justify-center rounded-2xl px-5 text-base font-bold transition disabled:opacity-50";
  const newLink = botUsername ? `https://t.me/${botUsername}?start=link` : BACK_TO_TELEGRAM;

  // ── linked: nothing left to do here but go back ───────────────────────────────────────────────────────────────────
  if (phase === "done" && linked) {
    return (
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6 text-center">
        <p className="text-4xl" aria-hidden>
          ✅
        </p>
        <h1 className="mt-3 font-display text-2xl font-bold" role="status">
          {t("tg.link.doneTitle")}
        </h1>
        <p className="mt-2 font-mono text-sm text-paper/80">{truncateAddress(linked)}</p>
        <p className="mt-3 text-sm leading-relaxed text-panda-grey">{t("tg.link.doneBody")}</p>
        <a href={BACK_TO_TELEGRAM} className={`${big} mt-6 bg-bamboo text-ink hover:brightness-95`}>
          {t("tg.cb.back")}
        </a>
        <p className="mt-3 text-xs leading-snug text-panda-grey">{t("tg.link.doneNote")}</p>
      </div>
    );
  }

  // ── a link that is over: say so, and where a new one comes from ───────────────────────────────────────────────────
  if (codeState === "expired" || codeState === "invalid") {
    return (
      <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6 text-center">
        <h1 className="font-display text-2xl font-bold">{t(codeState === "expired" ? "tg.link.expiredTitle" : "tg.link.invalidTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-panda-grey" role="alert">
          {t("tg.link.expiredBody")}
        </p>
        <a href={newLink} className={`${big} mt-6 bg-paper text-ink hover:brightness-90`}>
          {t("tg.link.newLink")}
        </a>
      </div>
    );
  }

  const page = typeof window === "undefined" ? "" : linkPageAddress(window.location.origin, code);
  return (
    <div className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h1 className="text-center font-display text-2xl font-bold">{t("tg.link.title")}</h1>
      <p className="mt-2 text-center text-sm leading-relaxed text-panda-grey">{t("tg.link.body")}</p>

      <div className="mt-6 grid gap-3">
        {phase === "confirm_replace" && replaceWith ? (
          <>
            <p className="text-center text-sm leading-relaxed text-sun">{t("tg.link.replaceWarn")}</p>
            <button type="button" onClick={() => connectAndSign(replaceWith, true)} className={`${big} bg-paper text-ink hover:brightness-90`}>
              {t("tg.link.replace")}
            </button>
            <button type="button" onClick={() => setPhase("idle")} className={`${big} border border-paper/20 text-paper/90 hover:border-paper/40`}>
              {t("tg.link.cancel")}
            </button>
          </>
        ) : !looked || codeState === "checking" ? (
          <div className="h-14 w-full animate-pulse rounded-2xl bg-paper/10" role="status" aria-label={t("tg.loading")} />
        ) : here.length > 0 ? (
          // A wallet is available to this page (the wallet app's own browser, or a computer with the extension).
          here.map((w, i) => (
            <button key={w.adapter.name} type="button" onClick={() => connectAndSign(w.adapter, false)} disabled={phase === "signing"} className={`${big} ${i === 0 ? "bg-bamboo text-ink hover:brightness-95" : "bg-paper text-ink hover:brightness-90"}`}>
              {phase === "signing" ? t("tg.link.signing") : here.length > 1 ? t("tg.link.connectSignWith", { wallet: w.adapter.name }) : t("tg.link.connectSign")}
            </button>
          ))
        ) : phone ? (
          // The phone's own browser: no wallet lives here. The same page, opened inside the wallet app.
          <>
            <p className="text-center text-sm leading-relaxed text-paper/80">{t("tg.link.openIn")}</p>
            {LINK_WALLET_APPS.map((a, i) => (
              <a key={a.id} href={browseUrl(a.id, page, window.location.origin)} className={`${big} ${i === 0 ? "bg-bamboo text-ink hover:brightness-95" : "bg-paper text-ink hover:brightness-90"}`}>
                {t("tg.link.openInWallet", { wallet: a.label })}
              </a>
            ))}
          </>
        ) : (
          <p className="text-center text-sm leading-relaxed text-paper/80">{t("tg.link.noWalletDesktop")}</p>
        )}
      </div>

      {error && (
        <p className="mt-3 text-center text-sm text-clay-red" role="alert">
          {error}
        </p>
      )}
      <p className="mt-5 text-center text-[11px] leading-snug text-panda-grey">{t("tg.link.never")}</p>
    </div>
  );
}
