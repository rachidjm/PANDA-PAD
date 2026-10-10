"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { WalletName } from "@solana/wallet-adapter-base";
import WalletPanel from "@/components/portfolio/WalletPanel";
import ConnectModal from "@/components/wallet/ConnectModal";
import { truncateAddress } from "@/lib/format";
import { pendingCode, pendingReferrer } from "@/lib/referrals/client";
import { phantomBrowseUrl } from "@/lib/wallet/phantom-link";
import { afterAnswer, connectPlan, connectStep, hasAnsweredConnectModal, markConnectModalAnswered, readyToReconnect, type ConnectStep } from "@/lib/wallet/connect-flow";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

const PHANTOM = "Phantom";

/**
 * The wallet button. Disconnected: one click opens the "¿Tienes un código de referido?" window (or connects straight
 * away when that question was already answered, or a recruiter's link/code is already here — see connectStep).
 * Connected: the wallet's own dropdown (WalletPanel), with "Cambiar de cuenta" and disconnect.
 */
export default function WalletButton() {
  const { wallets, select, connect, disconnect, connected, connecting, disconnecting, publicKey, wallet } = useWallet();
  const { t } = useLanguage();
  const { referrals } = useFeatures();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [installNeeded, setInstallNeeded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Set only when a recruiter's link or code was already found (localStorage) at the moment of the click — shown
  // inside the install dead-end (see run()) so that screen reads "your code is applied, install Phantom to finish"
  // instead of looking like the ordinary "have a code?" ask, which it must never show again once one is known.
  const [appliedLabel, setAppliedLabel] = useState<string | null>(null);
  // "Cambiar de cuenta" in progress: the wallet is being disconnected; it is asked to connect again only afterwards.
  const [switching, setSwitching] = useState(false);
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

  const phantom = wallets.find((w) => w.adapter.name === PHANTOM);
  const installed = phantom?.readyState === "Installed";

  // The "code applied" notice is small and self-clearing.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  /** Connects Phantom, from wherever things really are (connectPlan): if the adapter was left connected behind the
   *  library's back it is disconnected first; then `connect()` on the selected wallet, or selecting it (which makes the
   *  provider connect). A connect the user closes leaves everything ready for the next click. */
  const connectPhantom = useCallback(async () => {
    const adapter = phantom?.adapter;
    const plan = connectPlan({ walletSelected: wallet?.adapter.name === PHANTOM, libraryConnected: connected, adapterConnected: !!adapter?.connected });
    if (plan.resetAdapter) {
      await adapter!.disconnect().catch(() => {});
      // Let the library finish letting go of the wallet before it is selected again (otherwise it sees no change).
      await new Promise((r) => setTimeout(r, 60));
    }
    if (plan.how === "connect") {
      await connect().catch(() => {});
      return;
    }
    select(PHANTOM as WalletName);
  }, [phantom, wallet, connected, connect, select]);

  /** Runs the chosen step. The phone redirect is a plain navigation in the same click, so it isn't blocked.
   *  `applied`: the recruiter label already resolved for this click (see startConnect) — carried into the
   *  install dead-end so that screen never looks like the ordinary "have a code?" ask once one is known. */
  const run = useCallback(
    (step: Exclude<ConnectStep, "modal">, applied: string | null) => {
      if (step === "connect") {
        connectPhantom();
        return;
      }
      if (step === "redirect") {
        window.location.href = phantomBrowseUrl(window.location.href, window.location.origin, { code: pendingCode(), ref: pendingReferrer() });
        return;
      }
      setAppliedLabel(applied);
      setInstallNeeded(true);
      setModalOpen(true);
    },
    [connectPhantom]
  );

  /** What to say when a recruiter's link or code is already here — a code by preference (it names the
   *  recruiter directly), else the code behind the stored wallet if one exists, else a generic "link applied". */
  async function resolveAppliedLabel(): Promise<string | null> {
    const code = pendingCode();
    if (code) return t("wallet.refCodeApplied", { code });
    const owner = pendingReferrer();
    if (!owner) return null;
    const ownerCode = await fetch(`/api/referrals/code?wallet=${owner}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => d?.code ?? null)
      .catch(() => null);
    return ownerCode ? t("wallet.refCodeApplied", { code: ownerCode }) : t("wallet.refLinkApplied");
  }

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
      setAppliedLabel(null);
      setInstallNeeded(false);
      setModalOpen(true);
      return;
    }
    // A recruiter's link or code is already here: say so — as a toast before connecting straight away, or
    // (when there's no wallet to connect to yet) inside the install dead-end itself, where it's actually seen.
    const applied = referrals && (input.hasPendingCode || input.hasPendingLink) ? await resolveAppliedLabel() : null;
    if (applied && step === "connect") setNotice(applied);
    run(step, applied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referrals, installed, mobile, t, run]);

  /** The modal's answer: a valid code (already saved by the modal, by setPendingCode) or "No tengo código". */
  function onModalContinue(code: string | null) {
    markConnectModalAnswered();
    const step = afterAnswer({ walletInstalled: installed, mobile });
    const applied = code ? t("wallet.refCodeApplied", { code }) : null;
    if (step === "install") {
      setAppliedLabel(applied);
      setInstallNeeded(true);
      return;
    }
    setModalOpen(false);
    run(step, applied);
  }

  /** "Cambiar de cuenta": close the PANDA session, disconnect — and only when that is really done (the effect below)
   *  ask the wallet to connect again, so the user picks the account there. */
  async function switchAccount() {
    setOpen(false);
    setSwitching(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    try {
      await disconnect();
    } catch {
      setSwitching(false); // it didn't disconnect: nothing to reconnect, and a later disconnect must not reconnect by itself
    }
  }
  useEffect(() => {
    if (!readyToReconnect({ switching, libraryConnected: connected, connecting, disconnecting })) return;
    // Two frames later: the library has dropped the old wallet, and this connect starts from a clean state.
    const timer = setTimeout(() => {
      setSwitching(false);
      startConnect();
    }, 120);
    return () => clearTimeout(timer);
  }, [switching, connected, connecting, disconnecting, startConnect]);

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
        disabled={connecting || switching}
        className="rounded-full bg-paper px-4 py-2 text-sm font-semibold text-ink hover:brightness-90 transition disabled:opacity-60"
      >
        {connecting || switching ? t("wallet.connecting") : t("wallet.connect")}
      </button>
      {notice && (
        <p role="status" className="absolute right-0 top-full z-50 mt-2 whitespace-nowrap rounded-xl border border-bamboo/30 bg-ink-raised px-3 py-1.5 text-xs font-medium text-bamboo shadow-lg">
          {notice}
        </p>
      )}
      {modalOpen && (
        <ConnectModal
          installNeeded={installNeeded}
          appliedLabel={appliedLabel}
          onClose={() => {
            setModalOpen(false);
            setInstallNeeded(false);
            setAppliedLabel(null);
          }}
          onContinue={onModalContinue}
        />
      )}
    </div>
  );
}
