"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";

type Row = { directive: string; blocked: string; page: string; source: string; count: number };

/** /admin: what browsers reported under the report-only CSP. Read-only. */
export default function CspPanel() {
  const { t } = useLanguage();
  const [mode, setMode] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  async function load() {
    setError("");
    try {
      const res = await fetch("/api/admin/csp", { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed.");
      setMode(d.mode);
      setRows(d.violations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
    }
  }

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.csp.title")}</h2>
      {mode && <p className="mt-2 text-xs text-panda-grey">{t(`admin.csp.mode.${mode}` as DictKey)}</p>}
      <button onClick={load} className="mt-3 rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold hover:border-paper/40">
        {t("admin.csp.load")}
      </button>
      {error && <p className="mt-2 text-xs text-clay-red">{error}</p>}
      {rows && rows.length === 0 && <p className="mt-3 text-xs text-panda-grey">{t("admin.csp.none")}</p>}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-paper/5">
              {rows.map((r) => (
                <tr key={`${r.directive}|${r.blocked}|${r.page}|${r.source}`}>
                  <td className="py-1.5 pr-3 font-mono">{r.directive}</td>
                  <td className="pr-3 font-mono">{r.blocked}</td>
                  <td className="pr-3 text-panda-grey">{r.page || "/"}</td>
                  <td className="text-right text-panda-grey">
                    {r.count} {t("admin.csp.count")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
