"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Status = { configured: boolean; imported: boolean; pubkey: string | null; used: boolean };
type SimResult = {
  mint: string;
  endsInPanda: boolean;
  creator: string;
  creatorLamports: number | null;
  combined: boolean;
  ok: boolean;
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
};

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;

/**
 * Admin-only: imports the one reserved "…panda" address for the real $PANDA token launch, and lets the admin
 * simulate (never sign) the real create transaction against it. The keypair JSON file is read entirely in the
 * browser (FileReader) and POSTed once to /api/admin/reserved-mint — it never passes through this app's build
 * or any committed file.
 */
export default function ReservedMintPanel({ sessionTick = 0 }: { sessionTick?: number }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"import" | "simulate" | null>(null);
  const [error, setError] = useState("");
  const [importedNote, setImportedNote] = useState(false);
  const [sim, setSim] = useState<SimResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/reserved-mint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed.");
    return data;
  }, []);

  const refresh = useCallback(() => {
    post({ action: "status" })
      .then((d: Status) => setStatus(d))
      .catch(() => {});
  }, [post]);

  useEffect(() => {
    refresh();
  }, [refresh, sessionTick]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!file) return;
    setError("");
    setImportedNote(false);
    setBusy("import");
    try {
      const text = await file.text();
      const secretKey = JSON.parse(text);
      if (!Array.isArray(secretKey)) throw new Error(t("admin.reserved.badFile"));
      await post({ action: "import", secretKey });
      setImportedNote(true);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.reserved.badFile"));
    } finally {
      setBusy(null);
    }
  }

  async function simulate() {
    setError("");
    setSim(null);
    setBusy("simulate");
    try {
      const data = await post({ action: "simulate" });
      setSim(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.reserved.title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.reserved.intro")}</p>

      {status && !status.configured && <p className="mt-3 text-xs text-clay-red">{t("admin.reserved.notConfigured")}</p>}

      {status?.configured && (
        <div className="mt-3 text-xs">
          {status.imported ? (
            <>
              <p className="font-mono text-paper/80">{t("admin.reserved.imported", { pubkey: status.pubkey! })}</p>
              <p className={status.used ? "mt-1 text-clay-red" : "mt-1 text-bamboo"}>{status.used ? t("admin.reserved.used") : t("admin.reserved.notUsed")}</p>
            </>
          ) : (
            <p className="text-panda-grey">{t("admin.reserved.notImported")}</p>
          )}
        </div>
      )}

      {status?.configured && !status.imported && (
        <div className="mt-4">
          <input ref={fileInput} type="file" accept=".json,application/json" onChange={onFile} disabled={busy !== null} className="hidden" id="reserved-mint-file" />
          <label
            htmlFor="reserved-mint-file"
            className={`inline-block cursor-pointer rounded-full bg-paper px-5 py-2 text-xs font-semibold text-ink transition-opacity hover:opacity-90 ${busy !== null ? "pointer-events-none opacity-50" : ""}`}
          >
            {busy === "import" ? t("admin.reserved.importing") : t("admin.reserved.upload")}
          </label>
        </div>
      )}

      {importedNote && <p className="mt-3 text-xs text-bamboo">{t("admin.reserved.importDone")}</p>}
      {error && <p className="mt-3 text-xs text-clay-red">{error}</p>}

      {status?.imported && (
        <div className="mt-5 border-t border-paper/10 pt-4">
          <button
            onClick={simulate}
            disabled={busy !== null}
            className="rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold hover:border-paper/40 disabled:opacity-50"
          >
            {busy === "simulate" ? t("admin.reserved.simulating") : t("admin.reserved.simulate")}
          </button>

          {sim && (
            <div className="mt-3">
              <p className={sim.ok ? "text-xs text-bamboo" : "text-xs text-clay-red"}>
                {sim.ok ? t("admin.reserved.simOk", { ok: String(sim.endsInPanda), combined: String(sim.combined) }) : t("admin.reserved.simFailed")}
              </p>
              <p className="mt-1 font-mono text-xs text-panda-grey">{short(sim.mint)}</p>
              <p className="mt-1 font-mono text-xs text-panda-grey">
                {t("admin.reserved.simCreator", { wallet: short(sim.creator), sol: sim.creatorLamports !== null ? (sim.creatorLamports / 1e9).toFixed(4) : "?" })}
              </p>
              {sim.creatorLamports === 0 && <p className="mt-1 text-xs text-meme-orange">{t("admin.reserved.simNoFunds")}</p>}
              {!sim.ok && (
                <pre className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-ink p-3 text-[10px] leading-relaxed text-panda-grey">
                  {sim.logs.length > 0 ? sim.logs.join("\n") : JSON.stringify(sim.err, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
