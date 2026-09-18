import Link from "next/link";
import Panda from "@/components/panda/Panda";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-5 py-24 text-center">
      <Panda pose="error" size={150} />
      <h1 className="font-display text-xl font-bold">Page not found</h1>
      <p className="text-panda-grey">This page wandered off. Let&apos;s get you back.</p>
      <Link
        href="/"
        className="mt-2 rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
      >
        Back to PANDA
      </Link>
    </div>
  );
}
