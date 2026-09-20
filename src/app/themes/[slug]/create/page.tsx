import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import CreateNftClient from "@/components/themes/CreateNftClient";

export const dynamic = "force-dynamic";

export default async function CreateNftPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isEnabled("NFT_THEMES")) notFound();
  const { slug } = await params;
  return <CreateNftClient slug={slug} />;
}
