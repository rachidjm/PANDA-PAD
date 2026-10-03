"use client";

import { useEffect, useState } from "react";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { normalizeRecruiterCode, recruiterCodeProblem, type CodeProblem } from "@/lib/referrals/codes";

const PROBLEM_KEY: Record<CodeProblem, DictKey> = {
  too_short: "rec.codeErrTooShort",
  too_long: "rec.codeErrTooLong",
  bad_format: "rec.codeErrBadFormat",
  reserved: "rec.codeErrReserved",
};

type LoadState = "loading" | "none" | "set";

/** A recruiter's own short code ("/r/<code>") — chosen once, shown as a copyable link once set. Lives next to
 *  CopyReferralLink in the Recruiters page's "your link" panel. */
export default function SetRecruiterCode({ wallet }: { wallet: string }) {
  const { t } = useLanguage();
  const { ensureSession } = useWalletSession();
  const [state, setState] = useState<LoadState>("loading");
  const [code, setCode] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/referrals/code?wallet=${wallet}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { code?: string | null } | null) => {
        if (cancelled) return;
        setCode(d?.code ?? null);
        setState(d?.code ? "set" : "none");
      })
      .catch(() => !cancelled && setState("none"));
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    if (code) Promise.resolve().then(() => setLink(`${window.location.origin}/r/${code}`));
  }, [code]);

  async function submit() {
    const normalized = normalizeRecruiterCode(input);
    const problem = recruiterCodeProblem(normalized);
    if (problem) {
      setError(t(PROBLEM_KEY[problem]));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await ensureSession();
      const res = await fetch("/api/referrals/code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet, code: normalized }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.outcome === "set") {
        setCode(normalized);
        setState("set");
        return;
      }
      const dataProblem = typeof data.problem === "string" ? PROBLEM_KEY[data.problem as CodeProblem] : undefined;
      setError(data.outcome === "code_taken" ? t("rec.codeErrTaken") : dataProblem ? t(dataProblem) : t("rec.codeErrGeneric"));
    } catch {
      setError(t("rec.codeErrGeneric"));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;

  if (state === "set" && code) {
    return (
      <div className="mt-3">
        <p className="text-xs text-panda-grey">{t("rec.yourCode")}</p>
        <div className="mt-1.5 rounded-2xl border border-paper/10 bg-paper/[0.04] p-3">
          <code className="block min-w-0 truncate text-xs text-panda-grey sm:text-sm">{link ?? `…/r/${code}`}</code>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-xs text-panda-grey">{t("rec.yourCode")}</p>
      <div className="mt-1.5 flex gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          placeholder={t("rec.setCodePlaceholder")}
          disabled={busy}
          maxLength={20}
          className="min-w-0 flex-1 rounded-2xl border border-paper/15 bg-ink px-3.5 py-2.5 text-sm outline-none placeholder:text-panda-grey focus:border-bamboo/50 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-2xl bg-paper px-4 py-2.5 text-xs font-semibold text-ink transition hover:brightness-90 disabled:opacity-50"
        >
          {busy ? t("rec.setCodeSaving") : t("rec.setCodeCta")}
        </button>
      </div>
      <p className="mt-1 text-[11px] text-panda-grey">{t("rec.yourCodeNote")}</p>
      {error && (
        <p className="mt-1 text-xs text-clay-red" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
