"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import WalletPanel from "@/components/portfolio/WalletPanel";
import WalletConnectReferralCode from "@/components/WalletConnectReferralCode";
import { truncateAddress } from "@/lib/format";
import { pendingCode } from "@/lib/referrals/client";
import { phantomBrowseUrl } from "@/lib/wallet/phantom-link";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const PRIMARY_CLASS =
  "flex min-h-[52px] w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-b from-[#d7e56a] to-bamboo px-4 py-3.5 text-sm font-bold text-ink shadow-[0_6px_18px_-6px_rgba(201,217,76,0.7),inset_0_1px_0_rgba(255,255,255,0.45)] ring-1 ring-inset ring-white/25 transition active:translate-y-px active:scale-[0.98]";

export default function WalletButton() {
  const { wallets, select, disconnect, connected, connecting, publicKey } = useWallet();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.resolve().then(() => setMobile(/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)));
  }, []);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (connected && publicKey) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="true"
          className="flex items-center gap-2 rounded-full border border-paper/20 bg-ink-raised px-4 py-2 text-sm font-medium hover:border-paper/40 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-bamboo" aria-hidden />
          {truncateAddress(publicKey.toBase58())}
          <span className="text-panda-grey" aria-hidden>▾</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2">
            <WalletPanel
              publicKey={publicKey}
              onDisconnect={() => {
                // Also ends the session on the server (a copied cookie stops working at once when sessions are revocable).
                fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
                disconnect();
                setOpen(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  const phantom = wallets.find((w) => w.adapter.name === "Phantom");
  const installed = wallets.filter((w) => w.readyState === "Installed");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        aria-expanded={open}
        aria-haspopup="true"
        className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition disabled:opacity-60"
      >
        {connecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-paper/15 bg-ink-raised p-1.5 shadow-xl">
          {installed.length > 0 ? (
            installed.map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => {
                  select(w.adapter.name as WalletName);
                  setOpen(false);
                }}
                className={w.adapter.name === "Phantom" ? PRIMARY_CLASS : "flex min-h-11 w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-paper/90 hover:bg-paper/10 transition-colors"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded-md" />
                {w.adapter.name === "Phantom" ? t("wallet.connectPhantom") : w.adapter.name}
              </button>
            ))
          ) : mobile && phantom ? (
            // Phone without the Phantom app's own browser: open PANDA inside the Phantom app. The click itself does
            // the redirect (no effect, no second tap), and the URL carries any typed recruiter code along.
            <button type="button" onClick={() => { window.location.href = phantomBrowseUrl(window.location.href, window.location.origin, pendingCode()); }} className={PRIMARY_CLASS}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={phantom.adapter.icon} alt="" className="h-6 w-6 rounded-md" />
              {t("wallet.connectPhantom")}
            </button>
          ) : (
            <div className="space-y-0.5">
              <a href="https://phantom.app/" target="_blank" rel="noreferrer" className={PRIMARY_CLASS}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {phantom && <img src={phantom.adapter.icon} alt="" className="h-6 w-6 rounded-md" />}
                {t("wallet.installPhantomToConnect")}
              </a>
              <a
                href="https://solflare.com/"
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 items-center rounded-xl px-3 py-2.5 text-sm text-paper/70 hover:bg-paper/10 hover:text-paper transition-colors"
              >
                {t("wallet.installSolflare")}
              </a>
            </div>
          )}
          <WalletConnectReferralCode />
          <p className="px-3 pb-1.5 pt-2 text-[11px] leading-snug text-panda-grey">{t("wallet.neverSeeKeys")}</p>
        </div>
      )}
    </div>
  );
}
