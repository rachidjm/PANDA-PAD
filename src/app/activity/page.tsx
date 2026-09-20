import ActivityClient from "@/components/activity/ActivityClient";
import { realFeedDeps } from "@/lib/activity/deps";
import { getFeed } from "@/lib/activity/service";

// Real, changing data: never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  // If the feed can't be built, the page still renders and the client asks again.
  const initial = await getFeed(realFeedDeps()).catch(() => null);
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <ActivityClient initial={initial} />
    </div>
  );
}
