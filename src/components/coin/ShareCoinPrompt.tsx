"use client";

import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import CopyReferralLink from "@/components/recruiters/CopyReferralLink";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** On a coin's own page, its creator's recruiter link — only shown to the connected wallet that actually created it, and only while the Recruiters program is switched on. Shows the creator's short `/r/<code>` link once they've set one, the long `?ref=` one until then. */
export default function ShareCoinPrompt({ creator }: { creator: string }) {
  const { publicKey } = useWallet();
  const { referrals } = useFeatures();
  const { t } = useLanguage();
  const [code, setCode] = useState<string | null>(null);

  const isCreator = referrals && publicKey?.toBase58() === creator;

  useEffect(() => {
    if (!isCreator) return;
    let cancelled = false;
    fetch(`/api/referrals/code?wallet=${creator}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => !cancelled && setCode(d?.code ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCreator, creator]);

  if (!isCreator) return null;

  return (
    <div className="mt-4 rounded-2xl border border-meme-orange/30 bg-meme-orange/10 p-4">
      <p className="text-sm font-semibold text-paper">{t("rec.shareCoin")}</p>
      <CopyReferralLink wallet={creator} code={code} className="mt-2" />
      <Link href="/recruiters" className="mt-2 inline-block text-xs font-medium text-meme-orange hover:underline">
        {t("rec.shareCoinLink")}
      </Link>
    </div>
  );
}
