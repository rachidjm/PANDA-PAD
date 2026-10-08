import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Deliberately nothing beyond /api/ here — robots.txt is public, and a disallow entry for a sensitive
    // path would be the one thing that tells a crawler (or anyone else reading it) that it exists at all.
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
