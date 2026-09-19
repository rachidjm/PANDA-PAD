"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import CoinAvatar from "@/components/CoinAvatar";
import { formatPct } from "@/lib/format";
import { Coin } from "@/lib/types";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

/**
 * Compact live-search dropdown: results appear in a small row list right
 * under the input as you type — it never navigates away from the current
 * page. Only clicking a result (or "See all results") does.
 */
export default function CoinSearchBox() {
  const router = useRouter();
  const { t } = useLanguage();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<Coin[] | null>(null);
  const [resolvedQuery, setResolvedQuery] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const trimmed = query.trim();
  const loading = trimmed !== "" && trimmed !== resolvedQuery;

  // Wait for typing to pause before firing a request — GeckoTerminal's free
  // API rate-limits hard, and firing on every keystroke burns through it fast.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(trimmed), 300);
    return () => clearTimeout(t);
  }, [trimmed]);

  useEffect(() => {
    if (!debouncedQuery) return;
    let cancelled = false;
    fetch(`/api/coins?q=${encodeURIComponent(debouncedQuery)}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setError(data.error || t("search.failed"));
          setResults([]);
        } else {
          setError("");
          setResults(data.coins || []);
        }
        setResolvedQuery(debouncedQuery);
      })
      .catch(() => {
        if (cancelled) return;
        setError(t("search.failedConnection"));
        setResults([]);
        setResolvedQuery(debouncedQuery);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, t]);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function seeAll() {
    setOpen(false);
    router.push(trimmed ? `/discover?q=${encodeURIComponent(trimmed)}` : "/discover");
  }

  const showDropdown = open && trimmed.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          seeAll();
        }}
      >
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={t("nav.searchPlaceholder")}
          className="w-48 rounded-full border border-paper/15 bg-ink-raised px-4 py-2 text-sm text-paper placeholder:text-panda-grey outline-none focus:border-paper/40"
        />
      </form>

      {showDropdown && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 min-w-[280px] overflow-y-auto rounded-2xl border border-paper/10 bg-ink-raised shadow-2xl">
          {loading ? (
            <p className="px-4 py-3 text-xs text-panda-grey">{t("search.searching")}</p>
          ) : error ? (
            <p className="px-4 py-3 text-xs text-clay-red">{error}</p>
          ) : results && results.length > 0 ? (
            <>
              {results.slice(0, 8).map((c) => (
                <Link
                  key={c.mint}
                  href={`/coin/${c.mint}`}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2 hover:bg-paper/5"
                >
                  <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full">
                    <CoinAvatar image={c.image} ticker={c.ticker} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">${c.ticker}</p>
                    <p className="truncate text-xs text-panda-grey">{c.name}</p>
                  </div>
                  <span className={`shrink-0 text-xs font-medium ${c.changePct >= 0 ? "text-bamboo" : "text-clay-red"}`}>
                    {formatPct(c.changePct)}
                  </span>
                </Link>
              ))}
              <button
                onClick={seeAll}
                className="block w-full border-t border-paper/10 px-3 py-2 text-center text-xs text-paper/60 hover:text-paper"
              >
                {t("search.seeAll")}
              </button>
            </>
          ) : (
            <p className="px-4 py-3 text-xs text-panda-grey">{t("search.noMatch", { query: trimmed })}</p>
          )}
        </div>
      )}
    </div>
  );
}
