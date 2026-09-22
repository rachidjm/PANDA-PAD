"use client";

import { useEffect, useMemo, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { OtcRewardAsset } from "@/lib/otc/reward-assets";

const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

/**
 * "What should your holders earn?" — the one choice a PANDA Rewards launch makes that Standard
 * doesn't. Only ever offers assets PANDA's own /api/otc/reward-assets returns (the curated,
 * OTC-documented list — see src/lib/otc/reward-assets.ts): nothing here lets a user type an
 * arbitrary mint, since OTC's own server rejects anything else with a 400.
 */
export default function RewardAssetPicker({ value, onChange }: { value: string | null; onChange: (mint: string) => void }) {
  const { t } = useLanguage();
  const [assets, setAssets] = useState<OtcRewardAsset[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/otc/reward-assets")
      .then((r) => r.json())
      .then((d: { assets?: OtcRewardAsset[] }) => !cancelled && setAssets(d.assets ?? []))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!assets) return [];
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) => a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));
  }, [assets, query]);

  const selected = assets?.find((a) => a.mint === value) ?? null;

  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("otc.rewardAsset.title")}</span>
      <p className="mb-2 text-xs text-panda-grey">{t("otc.rewardAsset.subtitle")}</p>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t("otc.rewardAsset.search")}
        className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
      />

      {loadError && <p className="mt-2 text-xs text-clay-red">{t("otc.rewardAsset.loadError")}</p>}

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {assets === null &&
          !loadError &&
          Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[58px] animate-pulse rounded-xl bg-ink" />)}
        {assets !== null && filtered.length === 0 && (
          <p className="col-span-full py-4 text-center text-xs text-panda-grey">{t("otc.rewardAsset.empty")}</p>
        )}
        {filtered.map((a) => (
          <button
            type="button"
            key={a.mint}
            onClick={() => onChange(a.mint)}
            aria-pressed={value === a.mint}
            title={a.mint}
            className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${
              value === a.mint ? "border-bamboo bg-bamboo/10" : "border-paper/10 bg-ink-raised hover:border-paper/25"
            }`}
          >
            <p className="text-sm font-semibold">{a.symbol}</p>
            <p className="truncate text-xs text-panda-grey">{a.name}</p>
          </button>
        ))}
      </div>

      {selected && (
        <p className="mt-2 text-xs text-panda-grey">
          {t("otc.rewardAsset.selected", { symbol: selected.symbol })} · <span className="font-mono">{short(selected.mint)}</span>
        </p>
      )}
    </div>
  );
}
