"use client";

import Image from "next/image";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/** The X-community banner's real art — one designed image per language (the headline and the "Follow us on
 *  X" visual are drawn into the image itself), same pattern as RecruitersArt.tsx. Swaps automatically when
 *  the site's language changes. */
const SRC = { es: "/banners/x-community-es.webp", en: "/banners/x-community-en.webp" } as const;

export default function XCommunityArt() {
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
