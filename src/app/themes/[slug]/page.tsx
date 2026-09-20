import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import ThemeDetailClient from "@/components/themes/ThemeDetailClient";

export const dynamic = "force-dynamic";

export default async function ThemePage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isEnabled("NFT_THEMES")) notFound();
  const { slug } = await params;
  return <ThemeDetailClient slug={slug} />;
}
