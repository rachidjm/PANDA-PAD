"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { setPendingCode } from "@/lib/referrals/client";
import { DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD } from "@/lib/referrals/tiers-config";

/** Stroke icons in the same hand-drawn style as the rest of the app (no icon library in this codebase). */
function PercentIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className="h-4 w-4 shrink-0 text-bamboo" aria-hidden>
      <line x1="19" y1="5" x2="5" y2="19" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
    </svg>
  );
}
function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-bamboo" aria-hidden>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17.5" cy="7.5" r="2.5" />
      <path d="M15.5 14.2c2.7.5 4.5 2.7 4.5 5.8" />
    </svg>
  );
}
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-bamboo" aria-hidden>
      <path d="M12 3.5l2.47 5.18 5.53.68-4.08 3.93 1.1 5.6L12 16.1l-4.02 2.79 1.1-5.6-4.08-3.93 5.53-.68L12 3.5z" />
    </svg>
  );
}

/**
 * "¿Tienes un código de referido?" — asked before the wallet connects. A valid code is saved (setPendingCode) and
 * the flow continues; an invalid one stops here with an error and never continues. "No tengo código" continues
 * without saving anything. Closing with the X, a tap outside, or Escape connects nothing.
 *
 * `installNeeded`: the continue step found no wallet on a desktop — the modal stays open and shows the install link.
 * `appliedLabel`: a recruiter's code or link was already found (before this click even happened) — the install
 *  dead-end then says so instead of asking the question again, since the answer is already known.
 */
export default function ConnectModal({
  installNeeded,
  appliedLabel,
  onClose,
  onContinue,
}: {
  installNeeded: boolean;
  appliedLabel?: string | null;
  onClose: () => void;
  onContinue: (code: string | null) => void;
}) {
  const { t } = useLanguage();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function applyAndConnect() {
    const code = input.trim();
    if (!code || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/referrals/check-code?code=${encodeURIComponent(code)}`, { cache: "no-store" });
      if (!res.ok) {
        setError(t("wallet.codeCheckError"));
        return;
      }
      const data = (await res.json()) as { valid?: boolean };
      if (!data.valid) {
        setError(t("wallet.codeInvalid"));
        return;
      }
      setPendingCode(code);
      onContinue(code);
    } catch {
      setError(t("wallet.codeCheckError"));
    } finally {
      setBusy(false);
    }
  }

  const primary =
    "flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-gradient-to-b from-[#d7e56a] to-bamboo px-4 py-3.5 text-sm font-bold text-ink shadow-[0_6px_18px_-6px_rgba(201,217,76,0.7),inset_0_1px_0_rgba(255,255,255,0.45)] ring-1 ring-inset ring-white/25 transition active:translate-y-px active:scale-[0.98] disabled:opacity-50";

  // A portal to <body>: the header it lives in is backdrop-blurred, and that makes `fixed` children position
  // against the header instead of the window.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="connect-modal-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/70 p-5 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-sm rounded-3xl border border-paper/15 bg-ink-raised p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label={t("wallet.closeModal")}
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-panda-grey transition hover:text-paper"
        >
          <span aria-hidden className="text-xl leading-none">
            ×
          </span>
        </button>

        <h2 id="connect-modal-title" className="pr-10 font-display text-lg font-bold leading-tight">
          {appliedLabel || (installNeeded ? t("wallet.installPhantomToConnect") : t("wallet.refCodeTitle"))}
        </h2>
        <p className="mt-1 text-xs text-panda-grey">
          {installNeeded ? (appliedLabel ? t("wallet.installToFinish") : t("wallet.installHint")) : t("wallet.connectModalHint")}
        </p>

        {installNeeded ? (
          <a href="https://phantom.app/" target="_blank" rel="noreferrer" className={`${primary} mt-5`}>
            {t("wallet.installPhantomToConnect")}
          </a>
        ) : (
          <>
            <form
              className="mt-5"
              onSubmit={(e) => {
                e.preventDefault();
                applyAndConnect();
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setError("");
                }}
                placeholder={t("rec.applyCodePlaceholder")}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                aria-label={t("wallet.refCodeTitle")}
                aria-invalid={error ? true : undefined}
                className="min-h-11 w-full rounded-xl border border-paper/15 bg-ink px-3.5 text-sm outline-none placeholder:text-panda-grey focus:border-bamboo/60"
              />
              {error && (
                <p role="alert" className="mt-2 text-xs font-medium text-clay-red">
                  {error}
                </p>
              )}
              <button type="submit" disabled={!input.trim() || busy} className={`${primary} mt-3`}>
                {busy ? "…" : t("wallet.applyAndConnect")}
              </button>
            </form>
            <button
              type="button"
              onClick={() => onContinue(null)}
              className="mt-1 flex min-h-11 w-full items-center justify-center rounded-xl text-sm font-semibold text-paper/70 transition hover:text-paper"
            >
              {t("wallet.noCode")}
            </button>
          </>
        )}

        <ul className="mt-5 space-y-2">
          <li className="flex items-start gap-2 text-[11px] leading-snug text-panda-grey">
            <PercentIcon />
            {t("wallet.refBenefitHalfPrice", { min: DEFAULT_REFERRED_DISCOUNT_MIN_VOLUME_USD })}
          </li>
          <li className="flex items-start gap-2 text-[11px] leading-snug text-panda-grey">
            <PeopleIcon />
            {t("wallet.refBenefitRecruiter")}
          </li>
          <li className="flex items-start gap-2 text-[11px] leading-snug text-panda-grey">
            <StarIcon />
            {t("wallet.refBenefitFounder")}
          </li>
        </ul>
        <p className="mt-4 border-t border-paper/10 pt-3 text-[11px] leading-snug text-panda-grey">{t("wallet.neverSeeKeys")}</p>
      </div>
    </div>
  , document.body);
}
