import type { Metadata } from "next";
import { notFound } from "next/navigation";
import UpdatesClient from "@/components/updates/UpdatesClient";
import { getDb } from "@/lib/db/client";
import { pgGetUpdate, type SiteUpdate } from "@/lib/db/updates";
import { SLUG_RE } from "@/lib/updates/format";

export const dynamic = "force-dynamic";

async function load(id: string): Promise<SiteUpdate | null> {
  if (!SLUG_RE.test(id)) return null;
  try {
    return await pgGetUpdate(getDb(), id);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const entry = await load((await params).id);
  if (!entry) return { title: "Updates · PANDA" };
  return { title: `${entry.title.en} · PANDA Updates`, description: entry.body.en.slice(0, 200), openGraph: { title: entry.title.en, description: entry.body.en.slice(0, 200) } };
}

/** One update on its own page — the address that gets shared. */
export default async function UpdatePage({ params }: { params: Promise<{ id: string }> }) {
  const entry = await load((await params).id);
  if (!entry) notFound();
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <UpdatesClient entries={[entry]} single />
    </div>
  );
}
