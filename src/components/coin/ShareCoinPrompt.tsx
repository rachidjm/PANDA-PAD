"use client";

import { useEffect, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { siteUrl } from "@/lib/config/site";
import { copyText } from "@/lib/clipboard";

/** On a coin's own page, its creator's recruiter link — a single discrete row, same neutral style as the rest
 *  of the page (no colored box: this isn't a warning). Only shown to the connected wallet that actually
 *  created the coin, and only while the Recruiters program is switched on. Uses the creator's short `/r/<code>`
 *  link once they've set one, the long `?ref=` one until then. */
export default function ShareCoinPrompt({ creator }: { creator: string }) {
  const { publicKey } = useWallet();
  const { referrals } = useFeatures();
  const { t } = useLanguage();
  const [code, setCode] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isCreator = referrals && publicKey?.toBase58() === creator;

  useEffect(() => {
    if (!isCreator) return;
    let cancelled = false;
    fetch(`/api/referrals/code?wallet=${creator}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => !cancelled && setCode(d?.code ?? null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isCreator, creator]);

  useEffect(() => {
    if (!isCreator) return;
    Promise.resolve().then(() => setLink(code ? `${siteUrl()}/r/${code}` : `${siteUrl()}/?ref=${creator}`));
    return () => void (timer.current && clearTimeout(timer.current));
  }, [isCreator, creator, code]);

  if (!isCreator) return null;

  async function onCopy() {
    if (!link) return;
    const ok = await copyText(link);
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  const copyLabel = state === "copied" ? t("rec.copied") : state === "failed" ? t("rec.copyFailed") : t("rec.copy");

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="min-w-0 truncate text-panda-grey">
        {t("rec.yourLink")}: <span className="text-paper/70">{link ?? "…"}</span>
      </span>
      <button
        type="button"
        onClick={onCopy}
        disabled={!link}
        className="shrink-0 rounded-full border border-paper/15 px-2.5 py-1 text-[11px] font-semibold text-paper/70 transition-colors hover:border-paper/35 hover:text-paper disabled:opacity-50"
      >
        {copyLabel}
      </button>
      <Link href="/recruiters" className="shrink-0 text-[11px] text-panda-grey transition-colors hover:text-paper">
        {t("rec.shareCoinLink")}
      </Link>
    </div>
  );
}
