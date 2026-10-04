import type { ComponentType } from "react";
import type { DictKey } from "@/lib/i18n/translations";
import XCommunityArt from "./XCommunityArt";
import NftTeaserArt from "./NftTeaserArt";
import RecruitersArt from "./RecruitersArt";

/**
 * The home banner carousel's content lives here, not in BannerCarousel.tsx — add, remove or reorder a banner by
 * editing this array alone; the carousel component only ever renders whatever this file gives it. `order`
 * breaks ties when adding a banner in the middle; `active` is a simple on/off switch independent of any
 * feature-flag gating `visible` does at render time (e.g. hide this banner until an env var or flag is on).
 *
 * `image`: a placeholder has been drawn for every banner so far (plain inline SVG, no network request — see
 * ./XCommunityArt.tsx etc.) — replace `XCommunityArt` with PANDA's real X profile/banner photo, and
 * `NftTeaserArt` with real collection teaser art, whenever that's ready (swap the component here, nothing else
 * needs to change).
 */
export type BannerConfig = {
  id: string;
  order: number;
  active: boolean;
  /** Extra gate beyond `active` — env vars / feature flags that only make sense to check at render time. */
  visible?: () => boolean;
  art: ComponentType;
  titleKey: DictKey;
  /** A second, smaller line — e.g. the Founder-slot teaser on the Recruiters banner. */
  extraKey?: DictKey;
  cta: { labelKey: DictKey; href: string; external?: boolean } | null;
};

const X_COMMUNITY_URL = process.env.NEXT_PUBLIC_X_COMMUNITY_URL || null;

export function getHomeBanners(features: { referrals: boolean; founderNft: boolean }): BannerConfig[] {
  const banners: BannerConfig[] = [
    {
      id: "x-community",
      order: 1,
      active: true,
      visible: () => !!X_COMMUNITY_URL,
      art: XCommunityArt,
      titleKey: "banner.xCommunity.title",
      cta: X_COMMUNITY_URL ? { labelKey: "banner.xCommunity.cta", href: X_COMMUNITY_URL, external: true } : null,
    },
    {
      id: "nft-teaser",
      order: 2,
      active: true,
      art: NftTeaserArt,
      titleKey: "banner.nft.title",
      cta: X_COMMUNITY_URL ? { labelKey: "banner.nft.cta", href: X_COMMUNITY_URL, external: true } : null,
    },
    {
      id: "recruiters",
      order: 3,
      active: true,
      visible: () => features.referrals,
      art: RecruitersArt,
      titleKey: "banner.recruiters.title",
      extraKey: features.founderNft ? "banner.recruiters.founderLine" : undefined,
      cta: { labelKey: "banner.recruiters.cta", href: "/reclutadores" },
    },
  ];
  return banners
    .filter((b) => b.active && (b.visible ? b.visible() : true))
    .sort((a, b) => a.order - b.order);
}
