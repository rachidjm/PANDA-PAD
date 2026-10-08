"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { siteUrl } from "@/lib/config/site";

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h9" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

/** A wallet's recruiter link, shown and copyable — used on the Recruiters page and on a creator's own coin
 *  page. Always the canonical domain (`siteUrl()`), never `window.location.origin` — a link copied from an old-domain tab must still read
 *  the same everywhere it's shared, not whichever host 301-redirected the visitor there. With a `code` (the
 *  wallet's own short recruiter code, when it has set one), shows the short `/r/<code>` form instead of the
 *  long `/?ref=<wallet>` one — shorter to read and to paste, same destination either way. */
export default function CopyReferralLink({ wallet, code, className = "" }: { wallet: string; code?: string | null; className?: string }) {
  const { t } = useLanguage();
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    Promise.resolve().then(() => setLink(code ? `${siteUrl()}/r/${code}` : `${siteUrl()}/?ref=${wallet}`));
    return () => void (timer.current && clearTimeout(timer.current));
  }, [wallet, code]);

  async function onCopy() {
    if (!link) return;
    const ok = await copyText(link);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  const copied = state === "copied";
  const label = copied ? t("rec.copied") : state === "failed" ? t("rec.copyFailed") : t("rec.copy");

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl border border-paper/10 bg-paper/[0.04] p-3 ${className}`}>
      <code className="min-w-0 flex-1 truncate text-xs text-panda-grey sm:text-sm">{link ?? "…"}</code>
      <button
        type="button"
        onClick={onCopy}
        disabled={!link}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60 ${
          copied ? "bg-bamboo text-ink" : state === "failed" ? "bg-clay-red text-ink" : "bg-paper text-ink hover:brightness-90"
        }`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span aria-live="polite">{label}</span>
      </button>
    </div>
  );
}
