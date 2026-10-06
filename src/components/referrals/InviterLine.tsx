"use client";

import { useEffect, useState } from "react";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { pendingCode, pendingReferrer } from "@/lib/referrals/client";
import { PANDA_REFERRED_FEE_BPS } from "@/lib/pump/constants";

type Status =
  | { state: "bound"; referrer: string; source: "link" | "code"; code: string | null }
  | { state: "pending" }
  | { state: "none" };

/**
 * The invitee's own referral line: "Te invitó @<código> (wallet)" + "Pagas 0,5% de comisión" once bound, or
 * "Código aplicado, verificando…" while the check is still pending (also while the wallet hasn't signed yet and
 * the code is still only remembered in this browser). Renders nothing for a wallet that was never referred —
 * a rejection is shown as nothing too, the same as never referred.
 */
export default function InviterLine({ wallet, className = "" }: { wallet: string; className?: string }) {
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

  const pct = (PANDA_REFERRED_FEE_BPS / 100).toLocaleString(lang, { maximumFractionDigits: 2 });

  if (status?.state === "bound") {
    return (
      <div className={className}>
        <p className="text-xs font-medium text-paper/90">
          {status.source === "code" && status.code
            ? t("inv.invitedByCode", { code: status.code, wallet: truncateAddress(status.referrer) })
            : t("inv.invitedByLink", { wallet: truncateAddress(status.referrer) })}
        </p>
        <p className="mt-0.5 text-[11px] text-panda-grey">{t("inv.feeLine", { pct })}</p>
      </div>
    );
  }
  // Still verifying: the server has it pending, or the code is only remembered in this browser (not yet sent).
  if (status?.state === "pending" || localPending) {
    return <p className={`text-xs font-medium text-meme-orange ${className}`}>{t("inv.verifying")}</p>;
  }
  return null;
}
