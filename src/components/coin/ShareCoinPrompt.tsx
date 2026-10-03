"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import CopyReferralLink from "@/components/recruiters/CopyReferralLink";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** On a coin's own page, its creator's recruiter link — only shown to the connected wallet that actually created it, and only while the Recruiters program is switched on. */
export default function ShareCoinPrompt({ creator }: { creator: string }) {
  const { publicKey } = useWallet();
  const { referrals } = useFeatures();
  const { t } = useLanguage();

  if (!referrals || publicKey?.toBase58() !== creator) return null;

  return (
    <div className="mt-4 rounded-2xl border border-meme-orange/30 bg-meme-orange/10 p-4">
      <p className="text-sm font-semibold text-paper">{t("rec.shareCoin")}</p>
      <CopyReferralLink wallet={creator} className="mt-2" />
      <Link href="/recruiters" className="mt-2 inline-block text-xs font-medium text-meme-orange hover:underline">
        {t("rec.shareCoinLink")}
      </Link>
    </div>
  );
}
