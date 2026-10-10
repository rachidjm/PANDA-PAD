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
        className="group relative aspect-[1672/941] overflow-hidden rounded-[24px] border border-paper/10 bg-ink-raised sm:aspect-[13/5]"
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

        {/* Solid and always on (no opacity/hover dependency — a faint or hover-only arrow simply wasn't seen over the
            real art). Desktop only: on touch screens the swipe does the same job. Sides, vertically centered. */}
        {banners.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(index - 1)}
              aria-label={t("banner.prev")}
              className="absolute left-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-paper/30 bg-ink text-xl leading-none text-paper shadow-lg transition hover:bg-ink-raised sm:flex"
            >
              <span aria-hidden>‹</span>
            </button>
            <button
              type="button"
              onClick={() => go(index + 1)}
              aria-label={t("banner.next")}
              className="absolute right-3 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-paper/30 bg-ink text-xl leading-none text-paper shadow-lg transition hover:bg-ink-raised sm:flex"
            >
              <span aria-hidden>›</span>
            </button>
          </>
        )}
      </div>

      {banner.hideTitle && (banner.cta || banner.noteKey) && (
        // Phone only: the button and the fine print sit centered right under the box (on desktop they live
        // inside it, see SlideContent).
        <div className="mt-3 flex flex-col items-center gap-2 text-center sm:hidden">
          {banner.cta && banner.cta2 ? (
            // Two buttons: one on top of the other, each the full width — the second one (Telegram) FIRST.
            <div className="flex w-full flex-col gap-2 px-4">
              <CtaButton cta={banner.cta2} t={t} full />
              <CtaButton cta={banner.cta} t={t} full />
            </div>
          ) : (
            banner.cta && <CtaButton cta={banner.cta} t={t} />
          )}
          {banner.noteKey && <p className="px-4 text-[11px] text-panda-grey">{t(banner.noteKey)}</p>}
        </div>
      )}

      <div className="mt-2 flex justify-center sm:justify-end">
        {banners.length > 1 && (
          <div className="flex shrink-0 gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={t("banner.goTo", { n: i + 1 })}
                aria-current={i === index}
                className="flex h-11 w-5 items-center justify-center"
              >
                <span className={`block h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-paper/70" : "w-1.5 bg-paper/25"}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CtaButton({ cta, t, full }: { cta: NonNullable<BannerConfig["cta"]>; t: ReturnType<typeof useLanguage>["t"]; full?: boolean }) {
  const className = `${full ? "flex w-full" : "inline-flex"} items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink shadow-lg transition hover:brightness-90 sm:text-sm`;
  const content = (
    <>
      {cta.icon === "telegram" && <TelegramIcon />}
      {t(cta.labelKey)}
    </>
  );
  return cta.external ? (
    <a href={cta.href} target="_blank" rel="noopener noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <Link href={cta.href} className={className}>
      {content}
    </Link>
  );
}

/** Telegram's paper plane, small, in the button's own text color. */
function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" fill="currentColor">
      <path d="M21.94 4.3a1.2 1.2 0 0 0-1.63-1.32L2.7 9.86a1.1 1.1 0 0 0 .07 2.08l4.4 1.4 1.7 5.36a1 1 0 0 0 1.66.42l2.5-2.38 4.3 3.16a1.2 1.2 0 0 0 1.88-.72L21.94 4.3ZM9.3 13.1l8.2-5.2c.22-.14.45.15.26.33l-6.6 6.2a1 1 0 0 0-.3.56l-.37 2.2c-.03.2-.31.22-.37.03l-1.1-3.5a.6.6 0 0 1 .28-.62Z" />
    </svg>
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
        {/* Desktop only: button and fine print stacked inside the box, bottom-left in the free zone under the
            text. On phones the same button is rendered below the box instead (BannerCarousel). */}
        {(banner.cta || banner.noteKey) && (
          <div className="absolute bottom-[7%] left-[6%] hidden flex-col items-start gap-2 sm:flex">
            {banner.cta && (
              <div className="flex items-center gap-2">
                <CtaButton cta={banner.cta} t={t} />
                {banner.cta2 && <CtaButton cta={banner.cta2} t={t} />}
              </div>
            )}
            {banner.noteKey && <p className="text-[11px] text-paper/90 [text-shadow:0_1px_3px_rgb(0_0_0_/_0.9)]">{t(banner.noteKey)}</p>}
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
