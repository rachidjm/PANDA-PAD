import BannerPicture from "./BannerPicture";

/** The Recruiters banner's real art — headline, subtitle and the panda are all drawn into the image itself,
 *  one image per language AND per breakpoint (see BannerPicture.tsx). */
export default function RecruitersArt({ priority }: { priority?: boolean }) {
  return (
    <BannerPicture
      priority={priority}
      es={{ desktop: "/banners/recruiters-es-desktop.webp", mobile: "/banners/recruiters-es-mobile.webp" }}
      en={{ desktop: "/banners/recruiters-en-desktop.webp", mobile: "/banners/recruiters-en-mobile.webp" }}
    />
  );
}
