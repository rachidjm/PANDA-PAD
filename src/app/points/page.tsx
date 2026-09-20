import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import PointsClient from "@/components/points/PointsClient";

export const dynamic = "force-dynamic";

export default function PointsPage() {
  if (!isEnabled("PANDA_POINTS")) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <PointsClient />
    </div>
  );
}
