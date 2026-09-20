"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import AirdropsView, { EpochInfo, Load, MyAirdrop } from "./AirdropsView";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** Another wallet, another answer: the inner component starts fresh whenever the connected wallet changes. */
export default function AirdropsClient() {
  const { publicKey } = useWallet();
  return <AirdropsInner key={publicKey?.toBase58() ?? "none"} />;
}

function AirdropsInner() {
  const { t } = useLanguage();
  const { connected } = useWallet();
  const { claims } = useFeatures();
  const { ensureSession } = useWalletSession();

  const [epochs, setEpochs] = useState<EpochInfo[]>([]);
  const [epochsState, setEpochsState] = useState<Load>("loading");
  const [mine, setMine] = useState<MyAirdrop[] | null>(null);
  const [mineState, setMineState] = useState<Load>("idle");
  const [claiming, setClaiming] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<{ epoch: number; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/points/epochs");
        if (!r.ok) throw new Error("epochs");
        const list = ((await r.json()) as { epochs: { id: number; airdropPublished: boolean }[] }).epochs.filter((e) => e.airdropPublished).slice(-5);
        const infos = await Promise.all(
          list.map(async (e): Promise<EpochInfo> => {
            const res = await fetch(`/api/airdrop/epoch?id=${e.id}`);
            return res.ok ? ((await res.json()) as EpochInfo) : { epoch: e.id, status: "PAUSED", verified: false };
          })
        );
        if (!cancelled) {
          setEpochs(infos);
          setEpochsState("ready");
        }
      } catch {
        if (!cancelled) setEpochsState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadMine() {
    setMineState("loading");
    try {
      await ensureSession();
      const r = await fetch("/api/airdrop/me", { cache: "no-store" });
      if (!r.ok) throw new Error("me");
      setMine(((await r.json()) as { airdrops: MyAirdrop[] }).airdrops);
      setMineState("ready");
    } catch {
      setMineState("error");
    }
  }

  async function claim(epoch: number) {
    setClaiming(epoch);
    setClaimError(null);
    try {
      const r = await fetch("/api/airdrop/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ epochId: epoch }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setClaimError({ epoch, message: d.error || t("ad.loadError") });
      await loadMine(); // the chain decides: show what the record says now, whatever happened
    } catch {
      setClaimError({ epoch, message: t("ad.loadError") });
    } finally {
      setClaiming(null);
    }
  }

  return <AirdropsView connected={connected} claimsOpen={claims} epochs={epochs} epochsState={epochsState} mine={mine} mineState={mineState} onShow={() => void loadMine()} claiming={claiming} claimError={claimError} onClaim={(e) => void claim(e)} />;
}
