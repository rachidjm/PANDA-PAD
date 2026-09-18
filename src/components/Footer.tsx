import Link from "next/link";
import Panda from "@/components/panda/Panda";
import { LEGAL_PAGES, LEGAL_SLUGS } from "@/lib/legal-content";

const productLinks = [
  { href: "/discover", label: "Discover" },
  { href: "/create", label: "Create" },
  { href: "/rewards", label: "Rewards" },
  { href: "/analytics", label: "Analytics" },
];

export default function Footer() {
  return (
    <footer className="border-t border-paper/10 bg-ink">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-[1.2fr_1fr_1fr]">
          <div className="flex items-center gap-2">
            <Panda mark size={26} />
            <span className="font-display text-base font-bold tracking-tight">PANDA</span>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-panda-grey">Product</p>
            <ul className="mt-3 space-y-2">
              {productLinks.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-paper/70 transition-colors hover:text-paper">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-panda-grey">Legal</p>
            <ul className="mt-3 space-y-2">
              {LEGAL_SLUGS.map((slug) => (
                <li key={slug}>
                  <Link href={`/legal/${slug}`} className="text-sm text-paper/70 transition-colors hover:text-paper">
                    {LEGAL_PAGES[slug].title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-8 border-t border-paper/10 pt-6 text-xs text-panda-grey">
          PANDA is a non-custodial interface for launching and trading coins on Solana. It isn&apos;t a financial
          advisor, broker, or exchange, and nothing on this site is investment advice. Memecoins are extremely
          volatile and can lose all value.
        </p>
      </div>
    </footer>
  );
}
