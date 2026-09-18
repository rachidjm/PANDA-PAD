"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import WalletButton from "@/components/WalletButton";
import Panda from "@/components/panda/Panda";

const links = [
  { href: "/discover", label: "Discover" },
  { href: "/create", label: "Create" },
  { href: "/rewards", label: "Rewards" },
];

export default function Navbar() {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Panda mark size={30} />
          <span className="font-display text-lg font-bold tracking-tight">PANDA</span>
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  active ? "bg-paper/10 text-paper" : "text-paper/60 hover:text-paper"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="relative hidden md:block">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coins"
              className="w-48 rounded-full border border-paper/15 bg-ink-raised px-4 py-2 text-sm text-paper placeholder:text-panda-grey outline-none focus:border-paper/40"
            />
          </div>
          <WalletButton />
        </div>
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto border-t border-paper/10 px-5 py-2 sm:hidden">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="shrink-0 rounded-full px-3 py-1 text-sm text-paper/70 hover:text-paper"
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
