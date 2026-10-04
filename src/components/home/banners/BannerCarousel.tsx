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
    <div
      className="relative mb-6 h-44 overflow-hidden rounded-[24px] border border-paper/10 bg-ink-raised sm:h-52 lg:h-56"
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
          <SlideContent banner={banner} Art={Art} />
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
            <SlideContent banner={banner} Art={Art} />
          </motion.div>
        </AnimatePresence>
      )}

      {banners.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={t("banner.prev")}
            className="absolute left-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/40 text-paper/70 backdrop-blur transition hover:bg-ink/60 hover:text-paper sm:flex"
          >
            <span aria-hidden>‹</span>
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={t("banner.next")}
            className="absolute right-3 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink/40 text-paper/70 backdrop-blur transition hover:bg-ink/60 hover:text-paper sm:flex"
          >
            <span aria-hidden>›</span>
          </button>

          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={t("banner.goTo", { n: i + 1 })}
                aria-current={i === index}
                className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-paper" : "w-1.5 bg-paper/30 hover:bg-paper/50"}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SlideContent({ banner, Art }: { banner: BannerConfig; Art: BannerConfig["art"] }) {
  const { t } = useLanguage();
  return (
    <>
      <div className="absolute inset-0">
        <Art />
      </div>
      <div className="absolute inset-0 flex items-center">
        <div className="max-w-md px-6 sm:px-10">
          <p className="font-display text-lg font-bold leading-tight text-paper sm:text-2xl">{t(banner.titleKey)}</p>
          {banner.extraKey && <p className="mt-1.5 text-xs text-bamboo sm:text-sm">{t(banner.extraKey)}</p>}
          {banner.cta && (
            <div className="mt-4">
              {banner.cta.external ? (
                <a
                  href={banner.cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink transition hover:brightness-90 sm:text-sm"
                >
                  {t(banner.cta.labelKey)}
                </a>
              ) : (
                <Link
                  href={banner.cta.href}
                  className="inline-block rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink transition hover:brightness-90 sm:text-sm"
                >
                  {t(banner.cta.labelKey)}
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
