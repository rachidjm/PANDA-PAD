import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isEnabled } from "@/lib/config/flags";
import ThemesClient from "@/components/themes/ThemesClient";

export const metadata: Metadata = { title: "PANDA — Themes" };
export const dynamic = "force-dynamic"; // the feature flag is read at request time

export default function ThemesPage() {
  if (!isEnabled("NFT_THEMES")) notFound();
  return <ThemesClient />;
}
