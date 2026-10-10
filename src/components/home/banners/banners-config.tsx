import type { ComponentType } from "react";
import type { DictKey } from "@/lib/i18n/translations";
import XCommunityArt from "./XCommunityArt";
import NftTeaserArt from "./NftTeaserArt";
import RecruitersArt from "./RecruitersArt";
import { botStartUrl } from "@/lib/telegram/public";

/**
 * The home banner carousel's content lives here, not in BannerCarousel.tsx — add, remove or reorder a banner by
 * editing this array alone; the carousel component only ever renders whatever this file gives it. `order`
 * breaks ties when adding a banner in the middle; `active` is a simple on/off switch independent of any
 * feature-flag gating `visible` does at render time (e.g. hide this banner until an env var or flag is on).
 *
 * `art`: NftTeaserArt is still placeholder inline SVG (no network request) — replace it with real collection
 * teaser art whenever that's ready (swap the component here, nothing else needs to change). XCommunityArt and
 * RecruitersArt are real designed art — four files each (public/banners/, one per language AND per breakpoint,
 * see BannerPicture.tsx) with the headline (and, on X, the subtitle/icons) drawn in, which is why both set
 * `hideTitle: true` below. `art` takes an optional `priority` prop (only the first slide shown passes true —
 * see BannerCarousel.tsx) so it can mirror next/image's own eager/lazy loading hint.
 */
export type BannerConfig = {
  id: string;
  order: number;
  active: boolean;
  /** Extra gate beyond `active` — env vars / feature flags that only make sense to check at render time. */
  visible?: () => boolean;
  art: ComponentType<{ priority?: boolean }>;
  titleKey: DictKey;
  /** Skips the overlaid title text entirely — for a banner whose image already has its own headline drawn in
   *  (e.g. Recruiters' real art), so the two never render on top of each other. */
  hideTitle?: boolean;
  /** A second, smaller line — e.g. the Founder-slot teaser on the Recruiters banner. */
  extraKey?: DictKey;
  /** Fine-print disclaimer (smallest, gray), rendered BELOW the carousel, never over the art — e.g. "the 30%
   *  only applies to traders you invite yourself". */
  noteKey?: DictKey;
  cta: BannerCta | null;
  /** A second button next to the first (desktop: to its right; phone: full width, ABOVE the first). */
  cta2?: BannerCta | null;
};
export type BannerCta = { labelKey: DictKey; href: string; external?: boolean; icon?: "telegram" };

/** PANDA's public X account. Overridable per deploy, but this is the real default — no env var needed to show the banner. */
const X_ACCOUNT_URL = process.env.NEXT_PUBLIC_X_ACCOUNT_URL || "https://x.com/LaunchOnPanda";

export function getHomeBanners(features: { referrals: boolean; founderNft: boolean; telegramBot?: string | null }): BannerConfig[] {
  const banners: BannerConfig[] = [
    {
      id: "x-community",
      order: 1,
      active: true,
      art: XCommunityArt,
      titleKey: "banner.xCommunity.title",
      hideTitle: true, // the real art (XCommunityArt.tsx) already has the headline/subtitle/icons drawn in, per language
      cta: { labelKey: "banner.xCommunity.cta", href: X_ACCOUNT_URL, external: true },
      // The bot, opened with ?start=web. No bot username (or the bot is off) → no second button.
      cta2: features.telegramBot ? { labelKey: "banner.xCommunity.telegram", href: botStartUrl(features.telegramBot), external: true, icon: "telegram" } : null,
    },
    {
      id: "nft-teaser",
      order: 2,
      active: false, // paused for now at the user's request — the placeholder art/copy isn't ready to show yet
      art: NftTeaserArt,
      titleKey: "banner.nft.title",
      cta: { labelKey: "banner.nft.cta", href: X_ACCOUNT_URL, external: true },
    },
    {
      id: "recruiters",
      order: 3,
      active: true,
      visible: () => features.referrals,
      art: RecruitersArt,
      titleKey: "banner.recruiters.title",
      hideTitle: true, // the real art (RecruitersArt.tsx) already has the headline drawn in, per language
      // No extraKey here on purpose: the banner is too short to also stack the Founder teaser without it
      // climbing into the image's own text — see SlideContent's hideTitle branch. That teaser still lives
      // on /recruiters itself.
      noteKey: "banner.recruiters.note",
      cta: { labelKey: "banner.recruiters.cta", href: "/reclutadores" },
    },
  ];
  return banners
    .filter((b) => b.active && (b.visible ? b.visible() : true))
    .sort((a, b) => a.order - b.order);
}
