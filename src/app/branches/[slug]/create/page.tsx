import { notFound } from "next/navigation";
import { branchesEnabled } from "@/lib/branches/route";
import CreateNftClient from "@/components/themes/CreateNftClient";

export const dynamic = "force-dynamic";

export default async function CreateBranchNftPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!branchesEnabled()) notFound();
  const { slug } = await params;
  return <CreateNftClient slug={slug} branch />;
}
