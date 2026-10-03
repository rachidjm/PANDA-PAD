export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      <div className="h-8 w-40 animate-pulse rounded-full bg-paper/10" />
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-paper/5" />
        ))}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-2xl bg-paper/5" />
    </div>
  );
}
