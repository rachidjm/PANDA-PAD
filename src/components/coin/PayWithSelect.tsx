"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

export type PayOption = {
  mint: string;
  symbol: string;
  image?: string;
  /** What the wallet holds of it, in whole units; null while unknown. */
  balance: number | null;
  decimals: number;
  /** Its real USD price; null when unknown (the $/€ views are then unavailable for it). */
  priceUsd: number | null;
};

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 2 : 4 });

/**
 * "Pay with": a small arrow that opens the list of what the wallet actually holds (SOL first, then each token that has
 * a live market). Picking one changes what a buy is paid in. When the coin can only be bought with SOL (still on its
 * bonding curve) the other tokens are listed but locked, with the reason.
 */
export default function PayWithSelect({
  options,
  value,
  onChange,
  disabled,
  loading,
  onlySol,
}: {
  options: PayOption[];
  value: string;
  onChange: (mint: string) => void;
  disabled?: boolean;
  loading?: boolean;
  onlySol?: boolean;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.mint === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t("trading.payWith")}
        className="flex items-center gap-1.5 rounded-full bg-ink-raised py-1 pl-2 pr-2.5 text-sm font-semibold transition-colors hover:bg-paper/10 disabled:opacity-50"
      >
        <TokenBadge option={selected} />
        {selected.symbol}
        <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`text-panda-grey transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open && (
        <div role="listbox" aria-label={t("trading.payWith")} className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-2xl border border-paper/15 bg-ink-raised shadow-2xl">
          <p className="px-3.5 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-panda-grey">{t("trading.payWith")}</p>
          <ul className="max-h-64 overflow-y-auto pb-1.5">
            {options.map((o, i) => {
              const locked = !!onlySol && i > 0;
              return (
                <li key={o.mint}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.mint === selected.mint}
                    disabled={locked}
                    onClick={() => {
                      onChange(o.mint);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors ${locked ? "cursor-not-allowed opacity-40" : "hover:bg-paper/5"} ${o.mint === selected.mint ? "bg-bamboo/10" : ""}`}
                  >
                    <TokenBadge option={o} size={26} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{o.symbol}</span>
                      {o.priceUsd !== null && o.balance !== null && (
                        <span className="block text-[11px] text-panda-grey">≈ ${fmt(o.balance * o.priceUsd)}</span>
                      )}
                    </span>
                    <span className="text-right text-sm text-paper/80">{o.balance !== null ? fmt(o.balance) : "—"}</span>
                    {o.mint === selected.mint && (
                      <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="var(--bamboo)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="M2.5 6.2 5 8.7 9.5 3.5" />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-paper/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-panda-grey">
            {loading ? t("trading.payLoading") : onlySol ? t("trading.payOnlySol") : options.length === 1 ? t("trading.payNoTokens") : t("trading.payFeeNote")}
          </p>
        </div>
      )}
    </div>
  );
}

function TokenBadge({ option, size = 20 }: { option: PayOption; size?: number }) {
  const style = { width: size, height: size };
  if (option.image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={option.image} alt="" style={style} className="shrink-0 rounded-full bg-ink object-cover" />;
  }
  return (
    <span style={style} className="flex shrink-0 items-center justify-center rounded-full bg-paper/10 text-[10px] font-bold text-paper/80" aria-hidden>
      {option.symbol.slice(0, 1)}
    </span>
  );
}
