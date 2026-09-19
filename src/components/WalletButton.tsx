"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import WalletPanel from "@/components/portfolio/WalletPanel";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function WalletButton() {
  const { wallets, select, disconnect, connected, connecting, publicKey } = useWallet();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (connected && publicKey) {
    return (
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-full border border-paper/20 bg-ink-raised px-4 py-2 text-sm font-medium hover:border-paper/40 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-bamboo" />
          {truncateAddress(publicKey.toBase58())}
          <span className="text-panda-grey">▾</span>
        </button>
        {open && (
          <div className="absolute right-0 mt-2">
            <WalletPanel
              publicKey={publicKey}
              onDisconnect={() => {
                disconnect();
                setOpen(false);
              }}
            />
          </div>
        )}
      </div>
    );
  }

  const detected = wallets.filter((w) => w.readyState === "Installed" || w.readyState === "Loadable");

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={connecting}
        className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition disabled:opacity-60"
      >
        {connecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-paper/15 bg-ink-raised p-1.5 shadow-xl">
          {detected.length === 0 ? (
            <div className="space-y-0.5">
              <a
                href="https://phantom.app/"
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl px-3 py-2.5 text-sm text-paper/80 hover:bg-paper/10 hover:text-paper transition-colors"
              >
                {t("wallet.installPhantom")}
              </a>
              <a
                href="https://solflare.com/"
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl px-3 py-2.5 text-sm text-paper/80 hover:bg-paper/10 hover:text-paper transition-colors"
              >
                {t("wallet.installSolflare")}
              </a>
            </div>
          ) : (
            detected.map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => {
                  select(w.adapter.name as WalletName);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm text-paper/90 hover:bg-paper/10 transition-colors"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.adapter.icon} alt="" className="h-5 w-5 rounded" />
                {w.adapter.name}
              </button>
            ))
          )}
          <p className="px-3 pb-1.5 pt-2 text-[11px] leading-snug text-panda-grey">{t("wallet.neverSeeKeys")}</p>
        </div>
      )}
    </div>
  );
}
