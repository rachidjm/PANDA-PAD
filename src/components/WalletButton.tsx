"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import WalletPanel from "@/components/portfolio/WalletPanel";
import ConnectModal from "@/components/wallet/ConnectModal";
import { truncateAddress } from "@/lib/format";
import { pendingCode, pendingReferrer } from "@/lib/referrals/client";
import { phantomBrowseUrl } from "@/lib/wallet/phantom-link";
import { afterAnswer, connectStep, hasAnsweredConnectModal, markConnectModalAnswered, type ConnectStep } from "@/lib/wallet/connect-flow";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

const PHANTOM = "Phantom";

/**
 * The wallet button. Disconnected: one click opens the "¿Tienes un código de referido?" window (or connects straight
 * away when that question was already answered, or a recruiter's link/code is already here — see connectStep).
 * Connected: the wallet's own dropdown (WalletPanel), with "Cambiar de cuenta" and disconnect.
 */
export default function WalletButton() {
  const { wallets, select, connect, disconnect, connected, connecting, publicKey, wallet } = useWallet();
  const { t } = useLanguage();
  const { referrals } = useFeatures();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [installNeeded, setInstallNeeded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  // The "code applied" notice is small and self-clearing.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const phantom = wallets.find((w) => w.adapter.name === PHANTOM);
  const installed = phantom?.readyState === "Installed";

  /** Connects Phantom. Once it's the selected wallet, `connect()` runs on it; otherwise selecting it makes the
   *  provider's autoConnect do the connection. Only ever called from a click (or the modal's click). */
  const connectPhantom = useCallback(async () => {
    if (wallet?.adapter.name === PHANTOM) {
      await connect().catch(() => {});
      return;
    }
    select(PHANTOM as WalletName);
  }, [wallet, connect, select]);

  /** Runs the chosen step. The phone redirect is a plain navigation in the same click, so it isn't blocked. */
  const run = useCallback(
    (step: Exclude<ConnectStep, "modal">) => {
      if (step === "connect") {
        connectPhantom();
        return;
      }
      if (step === "redirect") {
        window.location.href = phantomBrowseUrl(window.location.href, window.location.origin, { code: pendingCode(), ref: pendingReferrer() });
        return;
      }
      setInstallNeeded(true);
      setModalOpen(true);
    },
    [connectPhantom]
  );

  /** The decision on click (also used by "Cambiar de cuenta"). */
  const startConnect = useCallback(async () => {
    const input = {
      referralsOn: referrals,
      hasPendingLink: !!pendingReferrer(),
      hasPendingCode: !!pendingCode(),
      answeredBefore: hasAnsweredConnectModal(),
      walletInstalled: installed,
      mobile,
    };
    const step = connectStep(input);
    if (step === "modal") {
      setInstallNeeded(false);
      setModalOpen(true);
      return;
    }
    // A recruiter's link or code is already here: say so briefly before connecting.
    if (referrals && (input.hasPendingCode || input.hasPendingLink)) {
      const code = pendingCode();
      if (code) {
        setNotice(t("wallet.refCodeApplied", { code }));
      } else {
        const owner = pendingReferrer();
        const ownerCode = owner
          ? await fetch(`/api/referrals/code?wallet=${owner}`, { cache: "no-store" })
              .then((r) => (r.ok ? r.json() : null))
              .then((d: { code?: string | null } | null) => d?.code ?? null)
              .catch(() => null)
          : null;
        setNotice(ownerCode ? t("wallet.refCodeApplied", { code: ownerCode }) : t("wallet.refLinkApplied"));
      }
    }
    run(step);
  }, [referrals, installed, mobile, t, run]);

  /** The modal's answer: a valid code (already saved by the modal) or "No tengo código". */
  function onModalContinue() {
    markConnectModalAnswered();
    const step = afterAnswer({ walletInstalled: installed, mobile });
    if (step === "install") {
      setInstallNeeded(true);
      return;
    }
    setModalOpen(false);
    run(step);
  }

  async function switchAccount() {
    setOpen(false);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    await disconnect().catch(() => {});
    startConnect();
  }

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
              onSwitch={switchAccount}
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

  return (
    <div className="relative">
      <button
        onClick={startConnect}
        disabled={connecting}
        className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition disabled:opacity-60"
      >
        {connecting ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      {notice && (
        <p role="status" className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-xl border border-bamboo/30 bg-ink-raised px-3 py-1.5 text-xs font-medium text-bamboo shadow-lg">
          {notice}
        </p>
      )}
      {modalOpen && (
        <ConnectModal
          installNeeded={installNeeded}
          onClose={() => {
            setModalOpen(false);
            setInstallNeeded(false);
          }}
          onContinue={onModalContinue}
        />
      )}
    </div>
  );
}
