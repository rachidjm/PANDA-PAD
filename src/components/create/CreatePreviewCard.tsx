"use client";

import ImagePlaceholderIcon from "@/components/icons/ImagePlaceholderIcon";
import LaunchedOnPandaBadge from "@/components/LaunchedOnPandaBadge";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * How the coin will look in PANDA's showcase, live while it's typed. The same look as CoinCard (same frame, image box,
 * ticker and name type) — not CoinCard itself, which needs a real address (its link, rug check and copy-address
 * button) that a coin not launched yet doesn't have. Market data isn't shown: there is none yet.
 */
export default function CreatePreviewCard({ image, name, ticker, description }: { image: string | null; name: string; ticker: string; description: string }) {
  const { t } = useLanguage();
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-panda-grey">{t("cr.preview")}</p>
      <div className="sticker-card relative overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
        <div className="relative aspect-[4/3] overflow-hidden bg-[#171512]">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={t("cr.previewAlt")} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ImagePlaceholderIcon className="text-panda-grey/60" />
            </div>
          )}
          <LaunchedOnPandaBadge size="compact" className="absolute bottom-3 left-3" />
        </div>
        <div className="p-4">
          <p className={`truncate font-display text-lg font-bold ${ticker ? "" : "text-paper/35"}`}>${ticker || "CAT"}</p>
          <p className={`mt-0.5 truncate text-sm ${name ? "text-panda-grey" : "text-panda-grey/50"}`}>{name || t("cr.namePh")}</p>
          {description.trim() && <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-paper/70">{description}</p>}
        </div>
      </div>
    </div>
  );
}
