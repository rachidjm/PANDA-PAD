import { notFound } from "next/navigation";
import { getLegalPage, LEGAL_PAGES, LEGAL_SLUGS, LegalSlug } from "@/lib/legal-content";
import { isEnabled } from "@/lib/config/flags";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

// Read per request, not baked at build: which sections appear follows the feature flags (and the $PANDA mint) as deployed.
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export default async function LegalSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!LEGAL_PAGES[slug as LegalSlug]) notFound();

  // Each optional feature's sections appear only while its flag is on, and $PANDA is described as launched only once its mint is configured.
  const page = getLegalPage(slug as LegalSlug, {
    custody: isEnabled("STRATEGIES"),
    holders: isEnabled("HOLDER_REWARDS"),
    otc: isEnabled("OTC_REWARDS"),
    nft: isEnabled("NFT_THEMES"),
    market: isEnabled("NFT_THEMES") && isEnabled("NFT_MARKET"),
    points: isEnabled("PANDA_POINTS"),
    airdrops: isEnabled("PANDA_AIRDROPS"),
    pandaToken: !!process.env.NEXT_PUBLIC_PANDA_TOKEN_MINT?.trim(),
  });
  return <LegalPageLayout page={page} />;
}
