import { notFound } from "next/navigation";
import { branchesEnabled } from "@/lib/branches/route";
import BranchDetailClient from "@/components/branches/BranchDetailClient";

export const dynamic = "force-dynamic";

export default async function BranchPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!branchesEnabled()) notFound();
  const { slug } = await params;
  return <BranchDetailClient slug={slug} />;
}
