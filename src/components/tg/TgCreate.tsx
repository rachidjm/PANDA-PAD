"use client";

import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { clearPendingLaunch, notePendingLaunch } from "./launch";
import { holdSession } from "./session";
import { useTg } from "./TgShell";
import { ScreenSkeleton } from "./TgSkeleton";

// The website's own create form — the very same code: image, name, ticker, description, website and X, the first buy
// in SOL / $ / €, the fee split and its rules, and the same signatures. Downloaded when this screen is opened.
const CreateClient = dynamic(() => import("@/app/create/CreateClient"), { ssr: false, loading: () => <ScreenSkeleton /> });

/**
 * Creating a coin inside the Mini App. Nothing about a launch is decided here: this screen only gives the website's
 * form its place in the app — signed in (the session the first screen asked for), signing with the user's own wallet
 * app, and with "View coin page" opening the new coin inside the app.
 */
export default function TgCreate({ minFirstBuySol }: { minFirstBuySol: number }) {
  const { t } = useLanguage();
  const { authed, phone, wallet: linked, askLogin, openExternal } = useTg();
  const { connected, publicKey } = useWallet();
  const ready = phone && authed && connected && !!linked && publicKey?.toBase58() === linked;

  if (!ready) {
    return (
      <div>
        <h1 className="font-display text-xl font-bold">{t("tg.create.title")}</h1>
        <div className="mt-3 rounded-2xl border border-paper/10 bg-ink-raised p-4">
          <p className="text-sm leading-relaxed text-paper/80">{t(phone ? "tg.create.login" : "tg.create.desktop")}</p>
          {phone ? (
            <button type="button" onClick={askLogin} className="mt-3 min-h-12 w-full rounded-xl bg-bamboo px-4 text-sm font-bold text-ink">
              {t("tg.create.loginButton")}
            </button>
          ) : (
            <button type="button" onClick={() => openExternal(`${window.location.origin}/create`)} className="mt-3 min-h-12 w-full rounded-xl bg-paper px-4 text-sm font-bold text-ink">
              {t("tg.wallet.browser")}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      // "Launch" stays above the app's own bottom bar and the phone's home bar.
      style={{ "--create-bar-bottom": "calc(61px + var(--safe-bottom))" } as React.CSSProperties}
      // Choosing the picture hands the screen to the phone's gallery or camera for a moment: that is not leaving the app.
      onClickCapture={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type === "file") holdSession();
      }}
    >
      <CreateClient minFirstBuySol={minFirstBuySol} coinHref={(mint) => `/tg/coin/${mint}`} onSigning={notePendingLaunch} onLaunched={clearPendingLaunch} />
      <p className="mt-3 text-center text-[11px] leading-snug text-panda-grey">{t("tg.create.signNote")}</p>
    </div>
  );
}
