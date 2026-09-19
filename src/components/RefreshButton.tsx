"use client";

import { useLanguage } from "@/lib/i18n/LanguageProvider";

export default function RefreshButton({
  loading,
  onClick,
  justUpdated,
}: {
  loading: boolean;
  onClick: () => void;
  /** Briefly true right after a successful refresh — confirms the click did
   * something even when the fetched numbers happen to look the same. */
  justUpdated?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-label="Refresh coins"
      className="flex items-center gap-1.5 rounded-full border border-paper/15 px-3 py-1.5 text-xs font-medium text-paper/70 transition-colors hover:border-paper/35 hover:text-paper disabled:opacity-60"
    >
      <svg
        viewBox="0 0 20 20"
        width="13"
        height="13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={loading ? "animate-spin" : ""}
      >
        <path d="M16.5 10a6.5 6.5 0 1 1-2.1-4.8" />
        <path d="M16.5 3.5v3.5h-3.5" />
      </svg>
      {loading ? t("refresh.refreshing") : justUpdated ? t("refresh.updated") : t("refresh.refresh")}
    </button>
  );
}
