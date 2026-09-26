"use client";

import { useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";
import { truncateAddress } from "@/lib/format";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

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

/**
 * "Copy CA" (contract address). The button shows a check (and says "Copied!") for a moment so you can see it worked.
 *   icon  a small round button for a coin card (the parent positions it; it must NOT sit inside a link).
 *   pill  the coin page: the shortened address and "Copy CA".
 */
export default function CopyCa({ mint, variant = "pill", className = "" }: { mint: string; variant?: "icon" | "pill"; className?: string }) {
  const { t } = useLanguage();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function onCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const ok = await copyText(mint);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  const copied = state === "copied";
  const label = copied ? t("ca.copied") : state === "failed" ? t("ca.failed") : t("ca.copy");
  const aria = t("ca.aria", { addr: mint });

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={onCopy}
        title={`${t("ca.copy")} · ${truncateAddress(mint)}`}
        aria-label={aria}
        className={`flex h-6 items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold backdrop-blur transition-colors sm:h-7 sm:px-2 ${
          copied ? "bg-bamboo text-ink" : state === "failed" ? "bg-clay-red text-ink" : "bg-ink/75 text-paper/80 hover:text-paper"
        } ${className}`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        {(copied || state === "failed") && <span aria-live="polite">{label}</span>}
      </button>
    );
  }
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-mono text-xs text-panda-grey" title={mint}>
        CA {truncateAddress(mint)}
      </span>
      <button
        type="button"
        onClick={onCopy}
        aria-label={aria}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
          copied ? "bg-bamboo text-ink" : state === "failed" ? "bg-clay-red text-ink" : "bg-paper/10 text-paper/80 hover:bg-paper/15 hover:text-paper"
        }`}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span aria-live="polite">{label}</span>
      </button>
    </span>
  );
}
