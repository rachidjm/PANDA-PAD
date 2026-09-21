"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

const COUNT = 8;
const tiles = Array.from({ length: COUNT }, (_, i) => `/nft-soon/${i + 1}.webp`);

/**
 * "NFTs — coming soon": a band of blurred pictures drifting sideways, endlessly, with the words on top.
 * The pictures are blurred and shrunk in advance (33 KB in all) so the browser only has to MOVE them: the
 * motion is one CSS transform on one layer, which runs on the GPU in every browser and never touches layout —
 * that is what keeps it smooth on a phone. The row is drawn twice and shifted by exactly half, so the loop has no seam.
 */
export default function NftComingSoon() {
  const { t } = useLanguage();
  return (
    <section className="relative my-4 overflow-hidden rounded-[26px] border border-paper/10 bg-ink-raised sm:my-8" aria-labelledby="nft-soon-title">
      <div className="nft-marquee-track flex w-max" aria-hidden>
        {[...tiles, ...tiles].map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element -- already sized and blurred; a plain image is what keeps the loop cheap
          <img key={i} src={src} alt="" width={720} height={424} draggable={false} decoding="async" className="nft-marquee-tile h-[130px] w-auto flex-none select-none sm:h-[240px] lg:h-[280px]" />
        ))}
      </div>

      {/* A dark veil so the words read on any picture, and the edges fade into the page. */}
      <div className="pointer-events-none absolute inset-0 bg-ink/55" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-transparent to-ink opacity-80" />

      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <span className="rounded-full border border-paper/25 bg-ink/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-paper/80 sm:text-xs">{t("nft.soon.kicker")}</span>
        <h2 id="nft-soon-title" className="mt-2 font-display text-4xl font-extrabold uppercase leading-none tracking-tight text-paper drop-shadow-[0_4px_24px_rgba(0,0,0,0.6)] sm:mt-3 sm:text-6xl lg:text-7xl">
          {t("nft.soon.title")}
        </h2>
      </div>
    </section>
  );
}
