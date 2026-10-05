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
      className="group relative mb-6 h-44 overflow-hidden rounded-[24px] border border-paper/10 bg-ink-raised sm:h-52 lg:h-56"
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
          {/* Discrete by design: invisible until the banner itself is hovered (or an arrow gets keyboard
              focus), so they never compete with the art/text — see src/components/home/banners/BannerCarousel.tsx. */}
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label={t("banner.prev")}
            className="absolute left-2.5 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink/30 text-paper/60 opacity-0 backdrop-blur transition hover:bg-ink/50 hover:text-paper focus-visible:opacity-100 group-hover:opacity-100 sm:flex"
          >
            <span aria-hidden>‹</span>
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label={t("banner.next")}
            className="absolute right-2.5 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-ink/30 text-paper/60 opacity-0 backdrop-blur transition hover:bg-ink/50 hover:text-paper focus-visible:opacity-100 group-hover:opacity-100 sm:flex"
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

function CtaButton({ cta, t }: { cta: NonNullable<BannerConfig["cta"]>; t: ReturnType<typeof useLanguage>["t"] }) {
  const className = "inline-block rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink transition hover:brightness-90 sm:text-sm";
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

function SlideContent({ banner, Art }: { banner: BannerConfig; Art: BannerConfig["art"] }) {
  const { t } = useLanguage();

  // The art already draws its OWN button (e.g. X-community's "Follow us on X" mockup) — a second, separately
  // rendered button right next to a picture of one would just look duplicated. Instead the whole banner
  // becomes the click target, and nothing extra is overlaid (the drawn button is purely illustrative).
  if (banner.hideTitle && banner.ctaBuiltIntoArt && banner.cta) {
    const cta = banner.cta;
    return cta.external ? (
      <a href={cta.href} target="_blank" rel="noopener noreferrer" className="absolute inset-0 block" aria-label={t(cta.labelKey)}>
        <Art />
      </a>
    ) : (
      <Link href={cta.href} className="absolute inset-0 block" aria-label={t(cta.labelKey)}>
        <Art />
      </Link>
    );
  }

  return (
    <>
      <div className="absolute inset-0">
        <Art />
      </div>
      {banner.hideTitle ? (
        // The art already has its own headline AND the Founder teaser's job (short banner height leaves no
        // room to also stack `extraKey` here without it climbing into the image's own text — that promotion
        // still lives on /recruiters) — this just adds what can't be baked into a static image: the CTA and
        // the fine print, on a gradient scrim so they stay legible over any part of the art.
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-1.5 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent px-6 pb-4 pt-8 sm:px-10 sm:pb-5">
          {banner.cta && <CtaButton cta={banner.cta} t={t} />}
          {banner.noteKey && <p className="text-[11px] text-paper/70">{t(banner.noteKey)}</p>}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center">
          <div className="max-w-md px-6 sm:px-10">
            <p className="font-display text-lg font-bold leading-tight text-paper sm:text-2xl">{t(banner.titleKey)}</p>
            {banner.extraKey && <p className="mt-1.5 text-xs text-bamboo sm:text-sm">{t(banner.extraKey)}</p>}
            {banner.cta && (
              <div className="mt-4">
                <CtaButton cta={banner.cta} t={t} />
              </div>
            )}
            {banner.noteKey && <p className="mt-1.5 text-[11px] text-panda-grey">{t(banner.noteKey)}</p>}
          </div>
        </div>
      )}
    </>
  );
}
