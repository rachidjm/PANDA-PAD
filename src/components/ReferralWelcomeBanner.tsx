"use client";

import { useEffect, useState } from "react";
import { consumePendingWelcome } from "@/lib/referrals/client";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { useFeatures } from "@/components/providers/FeaturesProvider";

/**
 * A one-time "you came in through a recruiter" toast — the ONLY place outside the Recruiters pages and the
 * legal texts that mentions the half-price rate to a trader who didn't go looking for it. Shown once, ever,
 * per browser, right after a referral capture (a `?ref=` link, a `/r/<code>` redirect, or a PANDA-launched
 * coin's own page as its creator's link — see src/lib/referrals/client.ts).
 *
 * Deferred to a macrotask (setTimeout 0) so it always runs AFTER every mount-time capture call this page load,
 * no matter where in the component tree that capture happened (root layout's ReferralCapture for a `?ref=`
 * link, or a coin page's own capturePandaLaunchReferral) — React commits and runs all of those synchronous
 * effects before any setTimeout callback from this same render fires.
 */
export default function ReferralWelcomeBanner() {
  const { t } = useLanguage();
  const { referrals } = useFeatures();
  const [wallet, setWallet] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!referrals) return;
    const timer = setTimeout(() => {
      const pending = consumePendingWelcome();
      if (pending) {
        setWallet(pending);
        setVisible(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [referrals]);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    fetch(`/api/referrals/code?wallet=${wallet}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => !cancelled && setCode(d?.code ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (!visible || !wallet) return null;

  return (
    <div className="fixed inset-x-4 bottom-20 z-[60] mx-auto flex max-w-sm items-start gap-3 rounded-2xl border border-bamboo/30 bg-ink-raised p-4 shadow-2xl sm:bottom-6">
      <p className="flex-1 text-sm">{code ? t("ref.welcomeWithCode", { code }) : t("ref.welcomeNoCode")}</p>
      <button type="button" onClick={() => setVisible(false)} className="shrink-0 text-panda-grey transition-colors hover:text-paper" aria-label={t("bp.close")}>
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}
