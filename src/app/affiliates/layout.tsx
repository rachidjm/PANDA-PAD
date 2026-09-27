import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";

// The affiliate campaign is switched off by default (FEATURE_REFERRALS): with the flag off this page doesn't exist, like Rewards, Points and Airdrops.
export const dynamic = "force-dynamic";

export default function AffiliatesLayout({ children }: { children: React.ReactNode }) {
  if (!isEnabled("REFERRALS")) notFound();
  return children;
}
