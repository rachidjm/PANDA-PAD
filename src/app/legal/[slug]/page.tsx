import { notFound } from "next/navigation";
import { getLegalPage, LEGAL_PAGES, LEGAL_SLUGS, LegalSlug } from "@/lib/legal-content";
import { isEnabled } from "@/lib/config/flags";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

// Read per request, not baked at build: whether the custody sections appear follows FEATURE_STRATEGIES and FEATURE_HOLDER_REWARDS as deployed.
export const dynamic = "force-dynamic";

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export default async function LegalSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!LEGAL_PAGES[slug as LegalSlug]) notFound();

  return <LegalPageLayout page={getLegalPage(slug as LegalSlug, { custody: isEnabled("STRATEGIES"), holders: isEnabled("HOLDER_REWARDS") })} />;
}
