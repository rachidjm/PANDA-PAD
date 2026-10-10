import type { Metadata } from "next";
import UpdatesClient from "@/components/updates/UpdatesClient";
import { getDb } from "@/lib/db/client";
import { pgListUpdates, type SiteUpdate } from "@/lib/db/updates";

// What was published changes whenever an admin approves an update: never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Updates · PANDA",
  description: "Everything new on PANDA, from the first release to the latest: what changed and how to use it.",
};

export default async function UpdatesPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  // Without a database (or if it can't be read right now) the page still renders, empty.
  let entries: SiteUpdate[] = [];
  try {
    entries = await pgListUpdates(getDb(), "newest");
  } catch {
    entries = [];
  }
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <UpdatesClient entries={entries} initialOrder={order === "oldest" ? "oldest" : "newest"} />
    </div>
  );
}
