import Link from "next/link";
import Panda from "@/components/panda/Panda";

export default function CoinNotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-5 py-24 text-center">
      <Panda pose="error" size={150} />
      <h1 className="font-display text-xl font-bold">That coin doesn&apos;t exist</h1>
      <p className="text-panda-grey">Check the ticker, or find it in the feed.</p>
      <Link
        href="/discover"
        className="mt-2 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
      >
        Explore coins
      </Link>
    </div>
  );
}
