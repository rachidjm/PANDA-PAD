"use client";

import { useState } from "react";

type Status =
  | { configured: false }
  | { configured: true; ok: true; publicKey: string; solBalance: number | null }
  | { configured: true; ok: false; error: string };

/** /admin: the Rewards Pool public key and balance the server is ACTUALLY using right now — never the secret
 *  key. Compare the address shown here against any wallet you'd recognize to confirm it's a dedicated server
 *  wallet, not a personal one. Read-only. */
export default function RewardsPoolPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const res = await fetch("/api/admin/rewards-pool", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed.");
      setStatus(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    }
  }

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">Rewards Pool signer</h2>
      <p className="mt-1 text-xs text-panda-grey">
        The public key and balance the server derives from PANDA_REWARDS_POOL_SECRET_KEY right now — the secret itself is never shown.
      </p>
      <button onClick={load} className="mt-3 rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold hover:border-paper/40">
        Load
      </button>
      {error && <p className="mt-2 text-xs text-clay-red">{error}</p>}
      {status && !status.configured && <p className="mt-3 text-xs text-panda-grey">Not configured.</p>}
      {status && status.configured && !status.ok && (
        <p className="mt-3 text-xs text-clay-red">{status.error}</p>
      )}
      {status && status.configured && status.ok && (
        <div className="mt-3 space-y-1 text-xs">
          <p className="font-mono text-paper">{status.publicKey}</p>
          <p className="text-panda-grey">Balance: {status.solBalance !== null ? `${status.solBalance.toFixed(4)} SOL` : "couldn't read"}</p>
        </div>
      )}
    </section>
  );
}
