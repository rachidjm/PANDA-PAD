"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { pendingCode, pendingReferrer } from "@/lib/referrals/client";
import { PANDA_FEE_BPS, PANDA_REFERRED_FEE_BPS } from "@/lib/pump/constants";

type Status =
  | {
      state: "bound";
      referrer: string;
      source: "link" | "code";
      code: string | null;
      discountActive: boolean;
      ownVolumeUsd: number;
      discountMinVolumeUsd: number;
      active: boolean;
      streakDays: number;
    }
  | { state: "pending" }
  | { state: "none" };

/**
 * The invitee's own referral line: "Te invitó @<código> (wallet)" + the fee it ACTUALLY pays right now (1%
 * until its own volume reaches the threshold, 0.5% from then on — see src/lib/pump/fee-tier.ts; never a flat
 * assumption), or "Código aplicado, verificando…" while the check is still pending (also while the wallet
 * hasn't signed yet and the code is still only remembered in this browser). Renders nothing for a wallet that
 * was never referred — a rejection is shown as nothing too, the same as never referred.
 *
 * `detailed` (the Recruiters page's own compact card at the top) adds: the discount's progress bar (or
 * "Descuento activado" once it's on), the trader-active streak, and a short "you can earn too" invite to
 * become a recruiter — the wallet menu's one-liner (WalletPanel.tsx) stays plain.
 */
export default function InviterLine({ wallet, className = "", detailed = false }: { wallet: string; className?: string; detailed?: boolean }) {
  const { t, lang } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [localPending, setLocalPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) setLocalPending(!!(pendingReferrer() || pendingCode()));
    });
    fetch(`/api/referrals/status?wallet=${wallet}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Status | null) => !cancelled && d && setStatus(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  if (status?.state === "bound") {
    const pct = ((status.discountActive ? PANDA_REFERRED_FEE_BPS : PANDA_FEE_BPS) / 100).toLocaleString(lang, { maximumFractionDigits: 2 });
    return (
      <div className={className}>
        <p className="text-xs font-medium text-paper/90">
          {status.source === "code" && status.code
            ? t("inv.invitedByCode", { code: status.code, wallet: truncateAddress(status.referrer) })
            : t("inv.invitedByLink", { wallet: truncateAddress(status.referrer) })}
        </p>
        <p className="mt-0.5 text-[11px] text-panda-grey">{t("inv.feeLine", { pct })}</p>
        {detailed && (
          <div className="mt-2.5 space-y-2">
            {status.discountActive ? (
              <p className="text-[11px] font-semibold text-bamboo">{t("inv.discountActive")}</p>
            ) : (
              <MiniBar label={t("inv.discountBar")} value={`${status.ownVolumeUsd.toLocaleString(lang, { maximumFractionDigits: 0 })} $ / ${status.discountMinVolumeUsd.toLocaleString(lang, { maximumFractionDigits: 0 })} $`} fraction={status.ownVolumeUsd / status.discountMinVolumeUsd} />
            )}
            <MiniBar label={t("rec.barActive")} value={t("rec.barActiveValue", { n: status.streakDays })} fraction={status.streakDays / 3} />
            <p className="text-[11px] text-panda-grey">{t("inv.volume", { amount: status.ownVolumeUsd.toLocaleString(lang, { maximumFractionDigits: 0 }) })}</p>
            <p className="rounded-xl bg-paper/[0.04] px-3 py-2 text-[11px] text-panda-grey">
              {t("inv.becomeRecruiter")}{" "}
              <Link href="/recruiters" className="font-semibold text-meme-orange hover:brightness-110">
                {t("inv.becomeRecruiterCta")}
              </Link>
            </p>
          </div>
        )}
      </div>
    );
  }
  // Still verifying: the server has it pending, or the code is only remembered in this browser (not yet sent).
  if (status?.state === "pending" || localPending) {
    return <p className={`text-xs font-medium text-meme-orange ${className}`}>{t("inv.verifying")}</p>;
  }
  return null;
}

function MiniBar({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-[11px] text-panda-grey">
        <span>{label}</span>
        <span className="font-medium text-paper/80">{value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paper/10">
        <div className="h-full rounded-full bg-bamboo transition-all" style={{ width: `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%` }} />
      </div>
    </div>
  );
}
