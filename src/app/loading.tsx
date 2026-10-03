/** Shown the instant a visitor navigates here, before the real server-rendered page (which calls
 *  getLiveCoins()) resolves — without this, a slow upstream call left the click looking completely
 *  unanswered (no spinner, no skeleton, nothing) until the whole page was ready. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1680px] px-5">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6 py-8">
          <div className="h-8 w-48 animate-pulse rounded-full bg-paper/10" />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-48 animate-pulse rounded-[22px] bg-paper/5" />
            ))}
          </div>
        </div>
        <div className="space-y-3 py-8">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-paper/5" />
          ))}
        </div>
      </div>
    </div>
  );
}
