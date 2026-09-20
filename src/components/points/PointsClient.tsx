"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import PointsView, { EpochRules, Load, MyPoints, PublicEpoch } from "./PointsView";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Loads the public epoch data, and — when the wallet asks — its own points (one free signature proves the wallet is yours). */
/** Another wallet, another answer: the inner component starts fresh whenever the connected wallet changes. */
export default function PointsClient() {
  const { publicKey } = useWallet();
  return <PointsInner key={publicKey?.toBase58() ?? "none"} />;
}

function PointsInner() {
  const { t } = useLanguage();
  const { connected } = useWallet();
  const { ensureSession } = useWalletSession();

  const [rules, setRules] = useState<EpochRules | null>(null);
  const [current, setCurrent] = useState<PublicEpoch | null>(null);
  const [epochsState, setEpochsState] = useState<Load>("loading");
  const [mine, setMine] = useState<MyPoints | null>(null);
  const [mineState, setMineState] = useState<Load>("idle");
  const [appealText, setAppealText] = useState("");
  const [appealBusy, setAppealBusy] = useState(false);
  const [appealError, setAppealError] = useState("");
  const [appealSent, setAppealSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/points/epochs")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("epochs"))))
      .then((d: { epochs: PublicEpoch[]; rules: EpochRules }) => {
        if (cancelled) return;
        setRules(d.rules);
        setCurrent(d.epochs.find((e) => e.status === "ACTIVE") ?? null);
        setEpochsState("ready");
      })
      .catch(() => !cancelled && setEpochsState("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMine() {
    setMineState("loading");
    try {
      await ensureSession();
      const r = await fetch("/api/points/me", { cache: "no-store" });
      if (!r.ok) throw new Error("me");
      setMine((await r.json()) as MyPoints);
      setMineState("ready");
    } catch {
      setMineState("error");
    }
  }

  async function sendAppeal() {
    setAppealBusy(true);
    setAppealError("");
    try {
      const r = await fetch("/api/abuse/appeal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: appealText }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || t("pt.appeal.error"));
      setAppealSent(true);
    } catch (e) {
      setAppealError(e instanceof Error ? e.message : t("pt.appeal.error"));
    } finally {
      setAppealBusy(false);
    }
  }

  return (
    <PointsView
      connected={connected}
      rules={rules}
      current={current}
      epochsState={epochsState}
      mine={mine}
      mineState={mineState}
      onShow={() => void loadMine()}
      appeal={{ text: appealText, setText: setAppealText, send: () => void sendAppeal(), busy: appealBusy, error: appealError, sent: appealSent }}
    />
  );
}
