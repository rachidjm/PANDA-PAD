"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { getHomeBanners, type BannerConfig } from "./banners-config";

const INTERVAL_MS = 6000;
/** A horizontal drag/swipe past this many pixels counts as a deliberate slide change. */
const SWIPE_THRESHOLD_PX = 40;

/**
 * Home banner carousel — auto-advances every 6s, pauses on hover/touch, swipeable on mobile, dots + discrete
 * arrows on desktop. No carousel library: the content is a handful of lightweight inline-SVG slides (see
 * banners-config.tsx), so a small AnimatePresence crossfade is all this needs. The autoplay timer (plain JS,
 * not a framer-motion animation) is its own prefers-reduced-motion check — MotionConfig only covers animated
 * props, not setInterval.
 */
export default function BannerCarousel() {
  const { t } = useLanguage();
  const features = useFeatures();
  const [banners] = useState(() => getHomeBanners(features));
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    Promise.resolve().then(() => setReducedMotion(mq.matches));
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (paused || reducedMotion || banners.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % banners.length), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, reducedMotion, banners.length]);

  if (banners.length === 0) return null;

  const go = (i: number) => setIndex(((i % banners.length) + banners.length) % banners.length);
  const banner = banners[index];
  const Art = banner.art;
  // Only the very first slide shown on page load gets eager/high-priority loading — everything reached only
  // by navigating the carousel afterward can load lazily (see BannerPicture.tsx).
  const priority = index === 0;

  function onTouchStart(e: React.TouchEvent) {
    touchStartX.current = e.touches[0].clientX;
    setPaused(true);
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartX.current;
    touchStartX.current = null;
    setPaused(false);
    if (start === null) return;
    const delta = e.changedTouches[0].clientX - start;
    if (delta > SWIPE_THRESHOLD_PX) go(index - 1);
    else if (delta < -SWIPE_THRESHOLD_PX) go(index + 1);
  }

  return (
    <div className="mb-6">
      {/* Height follows the real art's own aspect ratio (mobile vs desktop — see BannerPicture.tsx) instead
          of a fixed height cropped with object-cover, so nothing of the designed banners is ever clipped. */}
      <div
        className="group relative aspect-[1672/941] overflow-hidden rounded-[24px] border border-paper/10 bg-ink-raised sm:aspect-[1920/819]"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {reducedMotion ? (
          // No crossfade at all — framer-motion's own reduced-motion handling can leave opacity stranded
          // mid-transition (the DOM swaps correctly but the old slide never visually clears), so for a viewer
          // who asked for less motion this skips the animation layer entirely rather than trusting it to degrade.
          <div className="absolute inset-0">
            <SlideContent banner={banner} Art={Art} priority={priority} />
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={banner.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
              className="absolute inset-0"
            >
              <SlideContent banner={banner} Art={Art} priority={priority} />
            </motion.div>
          </AnimatePresence>
        )}

        {/* Always at least faintly visible (not hover-only — against bright/busy real art, a hover-only arrow
            at 0 opacity was too easy to miss entirely), brighter on hover/focus. A real shadow (not just a
            translucent fill) keeps them readable over any part of the art, light or dark.
            Sides only (vertically centered) — the bottom of the image is real art now (a free zone for the
            CTA button below), so the dots live outside the image entirely instead of overlaying it there too. */}
        {banners.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={t("banner.prev")}
              className="absolute left-2.5 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-paper opacity-70 shadow-lg ring-1 ring-paper/10 backdrop-blur transition hover:bg-ink/90 hover:opacity-100 focus-visible:opacity-100 sm:flex"
            >
              <span aria-hidden>‹</span>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={t("banner.next")}
              className="absolute right-2.5 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/70 text-paper opacity-70 shadow-lg ring-1 ring-paper/10 backdrop-blur transition hover:bg-ink/90 hover:opacity-100 focus-visible:opacity-100 sm:flex"
            >
              <span aria-hidden>›</span>
            </button>
          </>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 px-1">
        {/* Fine-print disclaimer, deliberately OUTSIDE the image (never overlaid on the art) — e.g. the
            Recruiters banner's "30% only applies to traders you invite yourself". */}
        <p className="text-[11px] text-panda-grey">{banner.noteKey ? t(banner.noteKey) : ""}</p>
        {banners.length > 1 && (
          <div className="flex shrink-0 gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={t("banner.goTo", { n: i + 1 })}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-paper/70" : "w-1.5 bg-paper/25 hover:bg-paper/40"}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CtaButton({ cta, t }: { cta: NonNullable<BannerConfig["cta"]>; t: ReturnType<typeof useLanguage>["t"] }) {
  const className = "inline-block rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink shadow-lg transition hover:brightness-90 sm:text-sm";
  return cta.external ? (
    <a href={cta.href} target="_blank" rel="noopener noreferrer" className={className}>
      {t(cta.labelKey)}
    </a>
  ) : (
    <Link href={cta.href} className={className}>
      {t(cta.labelKey)}
    </Link>
  );
}

function SlideContent({ banner, Art, priority }: { banner: BannerConfig; Art: BannerConfig["art"]; priority: boolean }) {
  const { t } = useLanguage();

  if (banner.hideTitle) {
    // The art already has the headline (and, on X, the subtitle/icons) drawn in, per language and per
    // breakpoint — this just adds the one thing that can't be baked into a static image: a REAL button, in
    // the free space each design leaves for it (desktop: below the text, left-aligned; mobile: centered over
    // the dark ground at the bottom).
    return (
      <>
        <div className="absolute inset-0">
          <Art priority={priority} />
        </div>
        {banner.cta && (
          <div className="absolute inset-x-0 bottom-[6%] flex justify-center px-4 sm:inset-x-auto sm:bottom-[7%] sm:left-[6%] sm:block sm:px-0">
            <CtaButton cta={banner.cta} t={t} />
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="absolute inset-0">
        <Art priority={priority} />
      </div>
      <div className="absolute inset-0 flex items-center">
        <div className="max-w-md px-6 sm:px-10">
          <p className="font-display text-lg font-bold leading-tight text-paper sm:text-2xl">{t(banner.titleKey)}</p>
          {banner.extraKey && <p className="mt-1.5 text-xs text-bamboo sm:text-sm">{t(banner.extraKey)}</p>}
          {banner.cta && (
            <div className="mt-4">
              <CtaButton cta={banner.cta} t={t} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
