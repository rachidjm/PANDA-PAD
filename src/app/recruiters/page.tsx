import type { Metadata } from "next";
import RecruitersClient from "@/components/recruiters/RecruitersClient";

// Its own title/description so a share to X or Telegram reads well on its own, separate from the rest of the site.
export const metadata: Metadata = {
  title: "PANDA — Recruiters",
  description: "Earn 30% of PANDA's trading fees for every trader you bring — paid instantly in SOL, for life.",
  openGraph: {
    title: "PANDA Recruiters",
    description: "Earn 30% of PANDA's trading fees for every trader you bring — paid instantly in SOL, for life.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "PANDA Recruiters",
    description: "Earn 30% of PANDA's trading fees for every trader you bring — paid instantly in SOL, for life.",
  },
};

export default function RecruitersPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <RecruitersClient />
    </div>
  );
}
