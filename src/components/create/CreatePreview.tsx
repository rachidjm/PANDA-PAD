"use client";

import ImagePlaceholderIcon from "@/components/icons/ImagePlaceholderIcon";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import InfoTooltip from "./InfoTooltip";

const sol = (n: number, lang: string, digits = 4) => n.toLocaleString(lang, { maximumFractionDigits: digits });

/**
 * The live preview beside the form: the coin as it is being typed, and its key facts. Every figure is real — the supply
 * and graduation point are Pump.fun's own, the split is the one chosen in step 2, and the cost is the measured one
 * (src/lib/pump/launch-info.ts). Market data isn't shown: a coin that doesn't exist yet has none.
 */
export default function CreatePreview({
  image,
  name,
  ticker,
  description,
  supply,
  graduationSol,
  split,
  costSol,
}: {
  image: string | null;
  name: string;
  ticker: string;
  description: string;
  supply: number;
  graduationSol: number;
  /** ["PANDA 5%", "Creator 60%", "Holders 20%", "Burn 15%"] — null until a split exists (no wallet connected yet). */
  split: string[] | null;
  /** What launching takes besides the first buy. */
  costSol: number;
}) {
  const { t, lang } = useLanguage();
  return (
    <div className="sticker-card rounded-[26px] border border-paper/10 bg-ink-raised p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-ink">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={t("cr.previewAlt")} className="h-full w-full object-cover" />
          ) : (
            <ImagePlaceholderIcon className="h-6 w-6 text-panda-grey/60" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={`truncate font-display text-xl font-bold leading-tight ${name ? "" : "text-paper/35"}`}>{name || t("cr.pv.name")}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`truncate text-sm font-semibold ${ticker ? "text-paper/80" : "text-paper/35"}`}>${ticker || "TICKER"}</span>
            <span className="rounded-full border border-paper/15 px-2 py-0.5 text-[11px] font-medium text-paper/70">Pump.fun</span>
          </div>
        </div>
      </div>

      <p className={`mt-4 line-clamp-4 break-words text-sm leading-relaxed ${description.trim() ? "text-paper/80" : "text-panda-grey/70"}`}>{description.trim() || t("cr.pv.desc")}</p>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t border-paper/10 pt-5">
        <Fact label={t("cr.pv.supply")} value={supply.toLocaleString(lang)} />
        <Fact label={t("cr.pv.graduates")} tooltip={t("cr.pv.graduatesInfo")} value={`≈ ${sol(graduationSol, lang, 0)} SOL`} />
        <Fact label={t("cr.pv.cost")} tooltip={t("cr.pv.costInfo")} value={`≈ ${sol(costSol, lang)} SOL`} note={t("cr.pv.costNote")} />
        <Fact
          label={t("cr.pv.split")}
          small
          wide
          value={
            split
              ? split.map((part, i) => (
                  <span key={i}>
                    <span className="whitespace-nowrap">{part}</span>
                    {i < split.length - 1 && <span className="text-panda-grey"> · </span>}
                  </span>
                ))
              : t("cr.pv.splitDefault")
          }
        />
      </dl>
    </div>
  );
}

function Fact({ label, value, tooltip, note, small, wide }: { label: string; value: React.ReactNode; tooltip?: string; note?: string; small?: boolean; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-2" : ""}`}>
      <dt className="flex items-center gap-1.5 text-xs text-panda-grey">
        {label}
        {tooltip && <InfoTooltip text={tooltip} align="end" />}
      </dt>
      <dd className={`mt-1 break-words font-semibold ${small ? "text-[13px] leading-snug" : "text-[15px]"}`}>{value}</dd>
      {note && <p className="mt-0.5 text-[11px] leading-snug text-panda-grey">{note}</p>}
    </div>
  );
}
