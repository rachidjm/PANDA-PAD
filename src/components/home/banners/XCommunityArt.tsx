import BannerPicture from "./BannerPicture";

/** The X-community banner's real art — headline, subtitle and the feature icons are all drawn into the image
 *  itself, one image per language AND per breakpoint (see BannerPicture.tsx). Unlike the previous version,
 *  this art has no button drawn in — the real "Follow us on X" button overlays it (see BannerCarousel.tsx). */
export default function XCommunityArt({ priority }: { priority?: boolean }) {
  return (
    <BannerPicture
      priority={priority}
      es={{ desktop: "/banners/x-community-es-desktop.webp", mobile: "/banners/x-community-es-mobile.webp" }}
      en={{ desktop: "/banners/x-community-en-desktop.webp", mobile: "/banners/x-community-en-mobile.webp" }}
    />
  );
}
