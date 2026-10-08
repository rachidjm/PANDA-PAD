import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config/site";
import { isEnabled } from "@/lib/config/flags";
import { LEGAL_SLUGS } from "@/lib/legal-content";

/**
 * The static/well-known pages only — not every coin or branch page (those are counted in the thousands and
 * change constantly; crawlers already reach them from Discover's own links and each coin page's own canonical
 * tag would be the more scalable way to add them later, rather than one sitemap entry per mint).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${base}/discover`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/create`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
  ];
  if (isEnabled("REFERRALS")) {
    entries.push({ url: `${base}/recruiters`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
    entries.push({ url: `${base}/reclutadores`, lastModified: now, changeFrequency: "weekly", priority: 0.6 });
  }
  if (isEnabled("OTC_REWARDS") || isEnabled("HOLDER_REWARDS")) entries.push({ url: `${base}/rewards`, lastModified: now, changeFrequency: "weekly", priority: 0.5 });
  if (isEnabled("PANDA_POINTS")) entries.push({ url: `${base}/points`, lastModified: now, changeFrequency: "weekly", priority: 0.5 });
  if (isEnabled("NFT_THEMES")) entries.push({ url: `${base}/themes`, lastModified: now, changeFrequency: "weekly", priority: 0.5 });
  for (const slug of LEGAL_SLUGS) entries.push({ url: `${base}/legal/${slug}`, lastModified: now, changeFrequency: "yearly", priority: 0.3 });
  return entries;
}
