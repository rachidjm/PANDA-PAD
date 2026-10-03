export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <div className="h-8 w-40 animate-pulse rounded-full bg-paper/10" />
      <div className="mt-6 space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl bg-paper/5" />
        ))}
      </div>
    </div>
  );
}
