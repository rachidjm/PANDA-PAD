export default function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        live ? "bg-bamboo/15 text-bamboo" : "bg-panda-grey/15 text-panda-grey"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-bamboo" : "bg-panda-grey"}`} />
      {live ? "Live from Solana" : "Demo data"}
    </span>
  );
}
