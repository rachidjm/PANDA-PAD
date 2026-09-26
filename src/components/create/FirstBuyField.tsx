"use client";

import { useEffect, useState } from "react";
import { sanitizeDecimalInput } from "@/lib/trading/input";
import { FIRST_BUY_PRESETS, firstBuyFromInput, solToUnit, type BuyRates, type BuyUnit } from "@/lib/trading/amount";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

const SYMBOL: Record<BuyUnit, string> = { SOL: "SOL", USD: "$", EUR: "€" };
const money = (n: number, currency: string) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(n);

/**
 * "Your first buy", typed in SOL, dollars or euros — the same choice as the buy/sell box (and the same remembered `panda.buy.unit`).
 * The purchase itself is always in SOL: a dollar/euro figure is converted with the live rate, and the conversion is shown right under
 * the box. Without a live rate a dollar/euro figure can't be used (a message says so); it is never guessed.
 */
export default function FirstBuyField({
  value,
  unit,
  onValue,
  onUnit,
  rates,
  description,
}: {
  value: string;
  unit: BuyUnit;
  onValue: (v: string) => void;
  onUnit: (u: BuyUnit) => void;
  rates: BuyRates;
  description: string;
}) {
  const { t } = useLanguage();
  const { sol, noRate } = firstBuyFromInput(unit, value, rates);
  const typed = parseFloat(value) > 0;
  const [remembered, setRemembered] = useState(false);
  useEffect(() => {
    if (remembered) return;
    Promise.resolve().then(() => {
      try {
        const u = localStorage.getItem("panda.buy.unit");
        if (u === "USD" || u === "EUR") onUnit(u);
      } catch {}
      setRemembered(true);
    });
  }, [remembered, onUnit]);

  function pick(next: BuyUnit) {
    if (next === unit) return;
    // Keep the same purchase when the unit changes: convert what is typed (if there is a rate for both).
    if (typed && sol > 0) {
      const converted = solToUnit(next, sol, rates);
      if (converted !== null) onValue(String(Number(converted.toFixed(next === "SOL" ? 4 : 2))));
    }
    onUnit(next);
    try {
      localStorage.setItem("panda.buy.unit", next);
    } catch {}
  }

  const others = (["USD", "EUR"] as const).filter((u) => u !== unit);
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cr.firstBuy")}</span>
      <p className="mb-2 text-xs text-panda-grey">{description}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3.5 focus-within:border-bamboo/50">
        <input
          value={value}
          onChange={(e) => onValue(sanitizeDecimalInput(e.target.value))}
          placeholder="0"
          inputMode="decimal"
          aria-label={t("cr.firstBuy")}
          className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey"
        />
        <div className="flex shrink-0 gap-0.5 rounded-full bg-ink-raised p-0.5" role="group" aria-label={t("trading.view")}>
          {(["SOL", "USD", "EUR"] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => pick(u)}
              aria-pressed={unit === u}
              className={`min-w-9 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${unit === u ? "bg-paper text-ink" : "text-paper/60 hover:text-paper"}`}
            >
              {SYMBOL[u]}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-5 gap-1.5">
        <button
          type="button"
          onClick={() => onValue("")}
          className={`rounded-xl py-2 text-xs font-semibold transition-colors ${!value ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"}`}
        >
          {t("cr.none")}
        </button>
        {FIRST_BUY_PRESETS[unit].map((p) => (
          <button
            type="button"
            key={p}
            onClick={() => onValue(String(p))}
            className={`rounded-xl py-2 text-xs font-semibold transition-colors ${value === String(p) ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"}`}
          >
            {unit === "SOL" ? `${p} SOL` : `${SYMBOL[unit]}${p}`}
          </button>
        ))}
      </div>

      {typed && !noRate && (
        <p className="mt-2 text-xs text-panda-grey" aria-live="polite">
          {unit === "SOL"
            ? others.map((u) => solToUnit(u, sol, rates)).every((v) => v !== null)
              ? `≈ ${money(solToUnit("USD", sol, rates)!, "USD")} · ${money(solToUnit("EUR", sol, rates)!, "EUR")}`
              : ""
            : `≈ ${sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`}
        </p>
      )}
      {noRate && <p className="mt-2 text-xs text-clay-red">{t("trading.noRate")}</p>}
      <p className="mt-2 text-[11px] leading-relaxed text-panda-grey">{t("cr.firstBuyUnitHint")}</p>
    </div>
  );
}
