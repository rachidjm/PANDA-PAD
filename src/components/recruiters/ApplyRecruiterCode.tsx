"use client";

import { useEffect, useState } from "react";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

type Eligibility = "checking" | "eligible" | "ineligible";
type Outcome = "bound" | "already_bound" | "rejected" | "retry_later" | "invalid_code" | "already_traded";

const OUTCOME_KEY: Partial<Record<Outcome, DictKey>> = {
  already_bound: "rec.applyCodeAlreadyBound",
  already_traded: "rec.applyCodeAlreadyTraded",
  invalid_code: "rec.applyCodeInvalid",
  rejected: "rec.applyCodeRejected",
  retry_later: "rec.applyCodeRetry",
};

const dismissKey = (wallet: string) => `panda:code-nudge-dismissed:${wallet}`;

/**
 * A plain "have a code?" field — no mention of what it does for the price, by design (the real fee a wallet
 * pays already reflects it, see useFeeBps; this field is just the mechanism, not a pitch). Self-hides once the
 * wallet is no longer eligible (already has a referrer, already traded, or the program is off), and — when
 * `dismissible` — once the person dismisses it, remembered per wallet in this browser.
 */
export default function ApplyRecruiterCode({
  wallet,
  onApplied,
  className = "",
  dismissible = false,
}: {
  wallet: string;
  onApplied?: () => void;
  className?: string;
  dismissible?: boolean;
}) {
  const { t } = useLanguage();
  const { ensureSession } = useWalletSession();
  const [eligibility, setEligibility] = useState<Eligibility>("checking");
  const [dismissed, setDismissed] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/referrals/apply-code?wallet=${wallet}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { eligible?: boolean } | null) => !cancelled && setEligibility(d?.eligible ? "eligible" : "ineligible"))
      .catch(() => !cancelled && setEligibility("ineligible"));
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    if (!dismissible) return;
    try {
      if (window.localStorage.getItem(dismissKey(wallet)) === "1") Promise.resolve().then(() => setDismissed(true));
    } catch {
      // Private window / blocked storage — worst case the nudge reappears next time, harmless.
    }
  }, [wallet, dismissible]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey(wallet), "1");
    } catch {
      // Nothing to recover — the nudge may just reappear next connect.
    }
  }

  async function submit() {
    if (!input.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      await ensureSession();
      const res = await fetch("/api/referrals/apply-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, code: input.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      const outcome: Outcome | undefined = data.outcome;
      if (res.ok && outcome === "bound") {
        setMessage({ text: t("rec.applyCodeSuccess"), ok: true });
        setEligibility("ineligible");
        onApplied?.();
        return;
      }
      const key = outcome ? OUTCOME_KEY[outcome] : undefined;
      setMessage({ text: key ? t(key) : t("rec.applyCodeRejected"), ok: false });
    } catch {
      setMessage({ text: t("rec.applyCodeRejected"), ok: false });
    } finally {
      setBusy(false);
    }
  }

  if (eligibility !== "eligible" || dismissed) return null;

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-panda-grey">{t("rec.haveCode")}</p>
        {dismissible && (
          <button type="button" onClick={dismiss} className="text-[11px] text-panda-grey underline-offset-2 hover:underline">
            {t("rec.dismiss")}
          </button>
        )}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setMessage(null);
          }}
          placeholder={t("rec.applyCodePlaceholder")}
          disabled={busy}
          maxLength={20}
          className="min-w-0 flex-1 rounded-2xl border border-paper/15 bg-ink px-3.5 py-2.5 text-sm outline-none placeholder:text-panda-grey focus:border-bamboo/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-2xl bg-paper px-4 py-2.5 text-xs font-semibold text-ink transition hover:brightness-90 disabled:opacity-50"
        >
          {busy ? t("rec.applyCodeApplying") : t("rec.applyCodeCta")}
        </button>
      </div>
      {message && (
        <p className={`mt-1 text-xs ${message.ok ? "text-bamboo" : "text-clay-red"}`} role={message.ok ? "status" : "alert"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
