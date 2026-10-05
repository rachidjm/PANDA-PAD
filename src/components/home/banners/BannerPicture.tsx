"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Sources = { desktop: string; mobile: string };

/**
 * Real art-directed `<picture>`: a genuinely different image (not just a different crop) for mobile vs
 * desktop, chosen by the browser itself via the media query on `<source>` — so only the one that actually
 * matches the viewport is ever downloaded, unlike a single image resized with CSS. Swaps to the other
 * language's pair automatically when the site's language changes. Breakpoint matches Tailwind's own `sm`
 * (640px), the same one BannerCarousel's container aspect-ratio switches on.
 *
 * Not run through next/image: these are already-optimized static files in public/banners/, and next/image
 * doesn't support per-breakpoint DIFFERENT images (only different sizes of the same one) — exactly what art
 * direction needs here. `priority` mirrors next/image's own prop: eager + high fetch priority for the one
 * banner visible on first paint, lazy for everything reached only by navigating the carousel.
 */
export default function BannerPicture({ es, en, priority = false }: { es: Sources; en: Sources; priority?: boolean }) {
  const { lang } = useLanguage();
  const { desktop, mobile } = lang === "es" ? es : en;
  return (
    <picture>
      <source media="(min-width: 640px)" srcSet={desktop} />
      <source media="(max-width: 639px)" srcSet={mobile} />
      <img
        src={desktop}
        alt=""
        className="h-full w-full object-cover"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />
    </picture>
  );
}
