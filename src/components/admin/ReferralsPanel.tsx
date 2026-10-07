"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Attempt = { id: string; wallet: string | null; code: string | null; referrer: string | null; kind: "apply_code" | "sign_in"; result: string; reason: string | null; createdAt: number };
type Invitee = { wallet: string; boundAt: number; lastQualifyingDay: string | null; streakAtLastQualifyingDay: number; firstActivatedAt: number | null; source: "link" | "code"; code: string | null };

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
const RESULT_TONE: Record<string, string> = {
  bound: "text-bamboo",
  pending: "text-meme-orange",
  rejected: "text-clay-red",
  already_bound: "text-panda-grey",
  already_traded: "text-panda-grey",
  invalid_code: "text-clay-red",
  error: "text-clay-red",
};

/** /admin: "Referidos" — searches every code-apply/bind attempt ever logged (not just the current state, see
 *  src/lib/db/schema.ts's referral_attempt_log), a recruiter's own full invitee list, and retries a wallet
 *  still stuck on "pending" (never a result the anti-abuse check already rejected — the server itself refuses that). */
export default function ReferralsPanel() {
  const { t } = useLanguage();
  const [q, setQ] = useState("");
  const [referrer, setReferrer] = useState("");
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const [invitees, setInvitees] = useState<Invitee[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);

  async function search() {
    setBusy(true);
    setMessage("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (referrer.trim()) params.set("referrer", referrer.trim());
      const res = await fetch(`/api/admin/referrals?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed.");
      setAttempts(body.attempts ?? []);
      setInvitees(body.invitees ?? null);
      setError(false);
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : "Failed.");
      setAttempts(null);
      setInvitees(null);
    } finally {
      setBusy(false);
    }
  }

  async function retry(wallet: string) {
    setRetrying(wallet);
    setMessage("");
    try {
      const res = await fetch("/api/admin/referrals/retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wallet }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed.");
      setError(false);
      setMessage(t("admin.referrals.retryDone", { outcome: body.outcome }));
      await search();
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.referrals.title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.referrals.help")}</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("admin.referrals.searchPlaceholder")} className="min-w-0 rounded-xl bg-ink px-3 py-2 font-mono text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30" />
        <input value={referrer} onChange={(e) => setReferrer(e.target.value)} placeholder={t("admin.referrals.referrerPlaceholder")} className="min-w-0 rounded-xl bg-ink px-3 py-2 font-mono text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30" />
        <button onClick={search} disabled={busy} className="rounded-full bg-paper px-4 py-2 text-xs font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50">
          {busy ? "…" : t("admin.referrals.search")}
        </button>
      </div>
      {message && <p className={`mt-2 text-xs ${error ? "text-clay-red" : "text-bamboo"}`}>{message}</p>}

      {invitees && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-paper/80">{t("admin.referrals.invitees", { n: invitees.length })}</h3>
          {invitees.length === 0 ? (
            <p className="mt-2 text-xs text-panda-grey">{t("admin.referrals.noInvitees")}</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-panda-grey">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">Wallet</th>
                    <th className="pr-4 font-medium">Source</th>
                    <th className="pr-4 font-medium">Bound (UTC)</th>
                    <th className="font-medium">Streak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper/5">
                  {invitees.map((inv) => (
                    <tr key={inv.wallet}>
                      <td className="py-1.5 pr-4 font-mono">{short(inv.wallet)}</td>
                      <td className="pr-4">{inv.source === "code" && inv.code ? `@${inv.code}` : "link"}</td>
                      <td className="whitespace-nowrap pr-4 text-panda-grey">{new Date(inv.boundAt).toISOString().slice(0, 19).replace("T", " ")}</td>
                      <td>{inv.streakAtLastQualifyingDay}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {attempts && (
        <div className="mt-5">
          <h3 className="text-xs font-semibold text-paper/80">{t("admin.referrals.attempts", { n: attempts.length })}</h3>
          {attempts.length === 0 ? (
            <p className="mt-2 text-xs text-panda-grey">{t("admin.referrals.noAttempts")}</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-panda-grey">
                  <tr>
                    <th className="py-1.5 pr-4 font-medium">Time (UTC)</th>
                    <th className="pr-4 font-medium">Kind</th>
                    <th className="pr-4 font-medium">Wallet</th>
                    <th className="pr-4 font-medium">Code</th>
                    <th className="pr-4 font-medium">Referrer</th>
                    <th className="pr-4 font-medium">Result</th>
                    <th className="pr-4 font-medium">Reason</th>
                    <th className="font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-paper/5">
                  {attempts.map((a) => (
                    <tr key={a.id}>
                      <td className="whitespace-nowrap py-1.5 pr-4 text-panda-grey">{new Date(a.createdAt).toISOString().slice(0, 19).replace("T", " ")}</td>
                      <td className="pr-4 font-mono">{a.kind}</td>
                      <td className="pr-4 font-mono">{a.wallet ? short(a.wallet) : "—"}</td>
                      <td className="pr-4">{a.code ?? "—"}</td>
                      <td className="pr-4 font-mono">{a.referrer ? short(a.referrer) : "—"}</td>
                      <td className={`pr-4 font-semibold ${RESULT_TONE[a.result] ?? ""}`}>{a.result}</td>
                      <td className="pr-4 text-panda-grey">{a.reason ?? ""}</td>
                      <td>
                        {a.result === "pending" && a.wallet && (
                          <button onClick={() => retry(a.wallet!)} disabled={retrying === a.wallet} className="rounded-full bg-paper/10 px-3 py-1 text-[11px] font-semibold text-paper hover:bg-paper/15 disabled:opacity-50">
                            {retrying === a.wallet ? "…" : t("admin.referrals.retry")}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
