"use client";

import { useState } from "react";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { pendingCode, pendingReferrer, setPendingCode } from "@/lib/referrals/client";

/** Three small stroke icons, same hand-drawn style as CopyCa.tsx — no icon library in this codebase. */
function PercentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-4 w-4 shrink-0" aria-hidden>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17.5" cy="7.5" r="2.5" />
      <path d="M15.5 14.2c2.7.5 4.5 2.7 4.5 5.8" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0" aria-hidden>
      <path d="M12 3.5l2.47 5.18 5.53.68-4.08 3.93 1.1 5.6L12 16.1l-4.02 2.79 1.1-5.6-4.08-3.93 5.53-.68L12 3.5z" />
    </svg>
  );
}

/**
 * "¿Tienes un código de referido?" — shown below the wallet list in the DISCONNECTED "Connect wallet" menu
 * (src/components/WalletButton.tsx), so a code can be typed in before a wallet is even picked. Only ever
 * SAVES the code locally (setPendingCode) — same contract as a `?ref=` link's pendingReferrer: the actual
 * bind happens server-side, the next time this wallet signs in (see useWalletSession.ts / /api/auth/verify),
 * never here. Self-hides once something is already pending (a link OR a code), and entirely when the
 * Recruiters program itself is off.
 */
export default function WalletConnectReferralCode() {
  const { t } = useLanguage();
  const { referrals } = useFeatures();
  const [input, setInput] = useState("");
  const [saved, setSaved] = useState<string | null>(() => pendingCode());
  const hasPendingLink = !saved && !!pendingReferrer();

  if (!referrals) return null;

  function apply() {
    const code = input.trim();
    if (!code) return;
    setPendingCode(code);
    setSaved(code);
  }

  return (
    <div className="border-t border-paper/10 px-3 py-2.5">
      {saved ? (
        <p className="text-xs text-bamboo">{t("wallet.refCodeApplied", { code: saved })}</p>
      ) : hasPendingLink ? (
        <p className="text-xs text-bamboo">{t("wallet.refLinkApplied")}</p>
      ) : (
        <>
          <p className="text-xs font-medium text-paper/80">{t("wallet.refCodeTitle")}</p>
          <div className="mt-1.5 flex gap-1.5">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply();
              }}
              placeholder={t("rec.applyCodePlaceholder")}
              maxLength={20}
              className="min-w-0 flex-1 rounded-full border border-paper/15 bg-ink px-3 py-1.5 text-xs outline-none placeholder:text-panda-grey focus:border-bamboo/50"
            />
            <button
              type="button"
              onClick={apply}
              disabled={!input.trim()}
              className="shrink-0 rounded-full bg-paper px-3 py-1.5 text-xs font-semibold text-ink transition hover:brightness-90 disabled:opacity-50"
            >
              {t("rec.applyCodeCta")}
            </button>
          </div>
        </>
      )}
      <ul className="mt-3.5 space-y-1.5">
        <li className="flex items-start gap-1.5 text-[11px] leading-snug text-panda-grey">
          <PercentIcon />
          {t("wallet.refBenefitHalfPrice")}
        </li>
        <li className="flex items-start gap-1.5 text-[11px] leading-snug text-panda-grey">
          <PeopleIcon />
          {t("wallet.refBenefitRecruiter")}
        </li>
        <li className="flex items-start gap-1.5 text-[11px] leading-snug text-panda-grey">
          <StarIcon />
          {t("wallet.refBenefitFounder")}
        </li>
      </ul>
    </div>
  );
}
