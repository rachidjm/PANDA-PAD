"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import LookupTablePanel from "@/components/admin/LookupTablePanel";
import AuditChainPanel from "@/components/admin/AuditChainPanel";
import SessionsPanel from "@/components/admin/SessionsPanel";
import { SUBSYSTEMS, confirmationPhrase, type Subsystem } from "@/lib/protocol/pause";

type PausedItem = { subsystem: Subsystem; reason: string; since: number };
type AuditRow = { id: string; ts: number; actor: string; action: string; object: string; reason?: string };

const short = (s: string) => (s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);

export default function AdminClient() {
  const { connected, publicKey } = useWallet();
  const { ensureSession } = useWalletSession();
  const [paused, setPaused] = useState<PausedItem[]>([]);
  const [events, setEvents] = useState<AuditRow[] | null>(null);
  const [reasons, setReasons] = useState<Partial<Record<Subsystem, string>>>({});
  const [busy, setBusy] = useState<Subsystem | "signin" | null>(null);
  const [message, setMessage] = useState("");
  const [sessionTick, setSessionTick] = useState(0);
  const [auditMode, setAuditMode] = useState("blob");

  const refresh = useCallback(async () => {
    const [status, audit] = await Promise.all([
      fetch("/api/protocol/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      fetch("/api/admin/audit?limit=50", { cache: "no-store" }),
    ]);
    if (status?.paused) setPaused(status.paused);
    if (audit.ok) {
      const body = await audit.json();
      setEvents(body.events);
      if (typeof body.mode === "string") setAuditMode(body.mode);
      setMessage("");
    } else {
      setEvents(null);
      const body = await audit.json().catch(() => ({}));
      setMessage(audit.status === 403 ? "This wallet isn't an admin." : body.error || "Couldn't load the audit log.");
    }
  }, []);

  useEffect(() => {
    if (!connected) return;
    Promise.resolve().then(refresh);
  }, [connected, publicKey, refresh]);

  async function signIn() {
    setBusy("signin");
    try {
      await ensureSession();
      await refresh();
      setSessionTick((n) => n + 1);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setBusy(null);
    }
  }

  async function toggle(subsystem: Subsystem, nextPaused: boolean) {
    const reason = reasons[subsystem]?.trim() ?? "";
    if (nextPaused && reason.length < 3) return setMessage("Enter a reason before pausing.");
    if (!window.confirm(`${nextPaused ? "PAUSE" : "RESUME"} ${subsystem}?`)) return;
    setBusy(subsystem);
    setMessage("");
    try {
      const res = await fetch("/api/admin/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subsystem, paused: nextPaused, reason, confirm: confirmationPhrase(nextPaused, subsystem) }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) {
        await ensureSession(); // the session is missing or too old for an admin action: re-sign, then retry once
        return setMessage("Signed in again — press the button once more.");
      }
      if (!res.ok) throw new Error(body.error || "Failed.");
      setReasons((r) => ({ ...r, [subsystem]: "" }));
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!connected) {
    return <p className="mt-10 rounded-[24px] border border-paper/10 bg-ink-raised p-6 text-sm text-panda-grey">Connect an admin wallet to continue.</p>;
  }

  return (
    <div className="mt-8 space-y-6">
      <button
        onClick={signIn}
        disabled={busy !== null}
        className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {busy === "signin" ? "Signing…" : "Sign in as admin"}
      </button>
      {message && <p className="text-sm text-clay-red">{message}</p>}

      <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <h2 className="text-sm font-medium">Subsystems</h2>
        <ul className="mt-4 divide-y divide-paper/10">
          {SUBSYSTEMS.map((s) => {
            const p = paused.find((x) => x.subsystem === s);
            return (
              <li key={s} className="flex flex-wrap items-center gap-3 py-3">
                <span className="w-44 font-mono text-sm">{s}</span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    p ? "bg-clay-red/15 text-clay-red" : "bg-bamboo/15 text-bamboo"
                  }`}
                >
                  {p ? "PAUSED" : "RUNNING"}
                </span>
                {p ? (
                  <span className="min-w-0 flex-1 truncate text-xs text-panda-grey">{p.reason}</span>
                ) : (
                  <input
                    value={reasons[s] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [s]: e.target.value }))}
                    maxLength={200}
                    placeholder="Reason (shown publicly)"
                    className="min-w-0 flex-1 rounded-xl bg-ink px-3 py-2 text-sm outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30"
                  />
                )}
                <button
                  onClick={() => toggle(s, !p)}
                  disabled={busy !== null}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50 ${
                    p ? "bg-bamboo text-ink" : "bg-clay-red text-paper"
                  }`}
                >
                  {busy === s ? "…" : p ? "Resume" : "Pause"}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <LookupTablePanel sessionTick={sessionTick} />

      <SessionsPanel />

      <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
        <h2 className="text-sm font-medium">Audit trail</h2>
        <div className="mt-3">
          <AuditChainPanel mode={auditMode} />
        </div>
        {events === null ? (
          <p className="mt-3 text-sm text-panda-grey">Sign in as an admin to view it.</p>
        ) : events.length === 0 ? (
          <p className="mt-3 text-sm text-panda-grey">No events recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-panda-grey">
                <tr>
                  <th className="py-1.5 pr-4 font-medium">Time (UTC)</th>
                  <th className="pr-4 font-medium">Action</th>
                  <th className="pr-4 font-medium">Actor</th>
                  <th className="pr-4 font-medium">Object</th>
                  <th className="font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-paper/5">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap py-1.5 pr-4 text-panda-grey">{new Date(e.ts).toISOString().slice(0, 19).replace("T", " ")}</td>
                    <td className="pr-4 font-mono">{e.action}</td>
                    <td className="pr-4 font-mono">{short(e.actor)}</td>
                    <td className="pr-4 font-mono">{short(e.object)}</td>
                    <td className="text-panda-grey">{e.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
