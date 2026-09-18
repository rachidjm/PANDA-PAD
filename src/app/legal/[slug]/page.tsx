import { notFound } from "next/navigation";
import { LEGAL_PAGES, LEGAL_SLUGS, LegalSlug } from "@/lib/legal-content";
import LegalPageLayout from "@/components/legal/LegalPageLayout";

export function generateStaticParams() {
  return LEGAL_SLUGS.map((slug) => ({ slug }));
}

export default async function LegalSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = LEGAL_PAGES[slug as LegalSlug];
  if (!page) notFound();

  return <LegalPageLayout page={page} />;
}
