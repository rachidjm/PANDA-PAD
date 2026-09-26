import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";

// Holder rewards are switched off by default (FEATURE_HOLDER_REWARDS): with the flag off this page doesn't exist, like Points and Airdrops.
export const dynamic = "force-dynamic";

export default function RewardsLayout({ children }: { children: React.ReactNode }) {
  if (!isEnabled("HOLDER_REWARDS")) notFound();
  return children;
}
