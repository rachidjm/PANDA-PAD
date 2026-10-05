"use client";

import Image from "next/image";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The Recruiters banner's real art (replaces the earlier placeholder SVG) — one designed image per language,
 *  since the headline itself is drawn into the image rather than overlaid as text. Swaps automatically when
 *  the site's language changes. */
const SRC = { es: "/banners/recruiters-es.webp", en: "/banners/recruiters-en.webp" } as const;

export default function RecruitersArt() {
  const { lang } = useLanguage();
  return (
    <Image
      src={SRC[lang]}
      alt=""
      fill
      sizes="(min-width: 1280px) 1200px, 100vw"
      className="object-cover"
    />
  );
}
