/** A coin card (Discover, search, a link from elsewhere) always lands here while the real page's own
 *  upstream fetches (pool lookup, hourly closes, socials) are still in flight — without this, clicking a
 *  coin looked identical to a dead link until all of that resolved. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-4 sm:py-8">
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 animate-pulse rounded-full bg-paper/10" />
            <div className="h-6 w-32 animate-pulse rounded bg-paper/10" />
          </div>
          <div className="h-80 animate-pulse rounded-[26px] bg-paper/5" />
        </div>
        <div className="h-80 animate-pulse rounded-[26px] bg-paper/5" />
      </div>
    </div>
  );
}
