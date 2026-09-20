import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import AirdropsClient from "@/components/airdrops/AirdropsClient";

export const dynamic = "force-dynamic";

export default function AirdropsPage() {
  if (!isEnabled("PANDA_AIRDROPS")) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <AirdropsClient />
    </div>
  );
}
