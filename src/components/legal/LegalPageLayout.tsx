import Link from "next/link";
import { LEGAL_PAGES, LEGAL_SLUGS, LegalPage } from "@/lib/legal-content";

export default function LegalPageLayout({ page }: { page: LegalPage }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12">
      <nav className="mb-8 flex flex-wrap gap-1.5">
        {LEGAL_SLUGS.map((slug) => {
          const active = slug === page.slug;
          return (
            <Link
              key={slug}
              href={`/legal/${slug}`}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active ? "bg-paper/10 text-paper" : "text-paper/50 hover:text-paper/80"
              }`}
            >
              {LEGAL_PAGES[slug].title}
            </Link>
          );
        })}
      </nav>

      <h1 className="font-display text-2xl font-bold">{page.title}</h1>
      <div className="mt-5 space-y-4">
        {page.body.map((paragraph, i) => (
          <p key={i} className={`text-sm leading-relaxed ${i === 0 ? "text-clay-red" : "text-panda-grey"}`}>
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
