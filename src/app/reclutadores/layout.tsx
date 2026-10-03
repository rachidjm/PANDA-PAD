import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";

// Same gate as /recruiters — this is just its Spanish-named mirror, same component underneath.
export const dynamic = "force-dynamic";

export default function ReclutadoresLayout({ children }: { children: React.ReactNode }) {
  if (!isEnabled("REFERRALS")) notFound();
  return children;
}
