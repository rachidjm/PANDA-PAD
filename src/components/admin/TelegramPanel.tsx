"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/i18n/LanguageProvider";

type Status = {
  enabled: boolean;
  hasToken: boolean;
  hasSecret: boolean;
  botUsername: string | null;
  botUsernameFromTelegram: string | null;
  channelId: string | null;
  groupId: string | null;
  groupUrl: string | null;
  channelUrl: string | null;
  topics: Record<string, number | null>;
  adminIds: number;
  minBuyUsd: number;
  paused: boolean;
  webhook: { url: string; pending: number; lastError: string | null; lastErrorAt: number | null } | { error: string } | null;
  stats?: Record<string, number>;
  outbox?: Record<string, number>;
  suggestions?: { id: string; telegramId: number; text: string; createdAt: number }[];
  changelogEnabled?: boolean;
  hasChangelogSecret?: boolean;
  changelogs?: { id: string; text: string; versions?: unknown[]; publishedVersion?: number | null; status: "pending" | "published" | "discarded"; decidedBy: number | null; decidedAt: number | null; createdAt: number }[];
  error?: string;
};

const input = "min-w-0 rounded-xl bg-ink px-3 py-2 text-xs outline-none placeholder:text-panda-grey focus:ring-1 focus:ring-paper/30";
const btn = "rounded-full border border-paper/20 px-4 py-2 text-xs font-semibold hover:border-paper/40 disabled:opacity-50";

/** /admin: the Telegram bot. Everything is done by the server (the token never reaches the browser), audited there. */
export default function TelegramPanel() {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [buttonUrl, setButtonUrl] = useState("");
  const [preview, setPreview] = useState<{ text: string; image?: string; buttons: string[] } | null>(null);

  async function load() {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/telegram", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed.");
      setStatus(d);
      setMsg(null);
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...extra }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Failed.");
      return d;
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : "Failed.", error: true });
      return null;
    } finally {
      setBusy(false);
    }
  }

  const announcement = { text, imageUrl, buttonText, buttonUrl };

  async function showPreview() {
    const d = await act("announce_preview", announcement);
    if (!d) return setPreview(null);
    const p = d.preview.payload as { text?: string; caption?: string; photo?: string; reply_markup?: { inline_keyboard: { text: string }[][] } };
    // The server's escaped text, shown as Telegram will show it (plain text).
    const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    setPreview({ text: unescape(p.text ?? p.caption ?? ""), image: p.photo, buttons: (p.reply_markup?.inline_keyboard ?? []).map((row) => row[0]?.text).filter(Boolean) });
  }

  async function send() {
    if (!window.confirm(t("admin.tg.confirmSend"))) return;
    const d = await act("announce", announcement);
    if (d) {
      setMsg({ text: t(d.sent ? "admin.tg.sent" : "admin.tg.queued"), error: false });
      setText("");
      setImageUrl("");
      setButtonText("");
      setButtonUrl("");
      setPreview(null);
    }
  }

  const wh = status?.webhook && "url" in status.webhook ? status.webhook : null;
  const row = (k: string, v: React.ReactNode) => (
    <div className="flex justify-between gap-3 py-1">
      <dt className="text-panda-grey">{k}</dt>
      <dd className="min-w-0 break-all text-right font-mono">{v}</dd>
    </div>
  );

  return (
    <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-6">
      <h2 className="text-sm font-medium">{t("admin.tg.title")}</h2>
      <p className="mt-2 text-xs leading-relaxed text-panda-grey">{t("admin.tg.help")}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={load} disabled={busy} className={btn}>{t("admin.tg.load")}</button>
        {status && (
          <>
            <button onClick={async () => (await act("set_webhook")) && (setMsg({ text: t("admin.tg.done"), error: false }), load())} disabled={busy} className={btn}>{t("admin.tg.setWebhook")}</button>
            <button onClick={async () => (await act("delete_webhook")) && (setMsg({ text: t("admin.tg.done"), error: false }), load())} disabled={busy} className={btn}>{t("admin.tg.deleteWebhook")}</button>
            <button onClick={async () => (await act("set_commands")) && setMsg({ text: t("admin.tg.done"), error: false })} disabled={busy} className={btn}>{t("admin.tg.setCommands")}</button>
          </>
        )}
      </div>

      {status && (
        <dl className="mt-4 rounded-xl bg-ink px-3.5 py-2.5 text-[11px]">
          {row("FEATURE_TELEGRAM_BOT", status.enabled ? "on" : "off")}
          {row("paused", status.paused ? "yes" : "no")}
          {row("TELEGRAM_BOT_TOKEN", status.hasToken ? "set" : "missing")}
          {row("TELEGRAM_WEBHOOK_SECRET", status.hasSecret ? "set" : "missing")}
          {row("bot", status.botUsernameFromTelegram ? `@${status.botUsernameFromTelegram}` : status.botUsername ?? "—")}
          {row("channel / group", `${status.channelId ?? "—"} / ${status.groupId ?? "—"}`)}
          {row("TELEGRAM_CHANNEL_URL / TELEGRAM_GROUP_URL", `${status.channelUrl ?? "—"} / ${status.groupUrl ?? "—"}`)}
          {row("topics", Object.entries(status.topics).map(([k, v]) => `${k}=${v ?? "—"}`).join(" "))}
          {row("TELEGRAM_ADMIN_IDS", status.adminIds)}
          {row("min $PANDA buy", `$${status.minBuyUsd}`)}
          {row("webhook", wh ? `${wh.url || "(none)"} · pending ${wh.pending}${wh.lastError ? ` · last error: ${wh.lastError}` : ""}` : status.webhook && "error" in status.webhook ? status.webhook.error : "—")}
          {status.stats && row("users / linked / alerts / watched", `${status.stats.users} / ${status.stats.linked} / ${status.stats.alerts} / ${status.stats.watched}`)}
          {status.outbox && row("outbox pending / failed / sent 24h", `${status.outbox.pending} / ${status.outbox.failed} / ${status.outbox.sent24h}`)}
          {status.error && row("database", status.error)}
        </dl>
      )}

      <h3 className="mt-6 text-xs font-medium text-paper/80">{t("admin.tg.announce")}</h3>
      <div className="mt-2 grid gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={3500} placeholder={t("admin.tg.text")} className={`${input} resize-y`} />
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder={t("admin.tg.image")} className={input} />
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={buttonText} onChange={(e) => setButtonText(e.target.value)} maxLength={40} placeholder={t("admin.tg.buttonText")} className={input} />
          <input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder={t("admin.tg.buttonUrl")} className={input} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={showPreview} disabled={busy || !text.trim()} className={btn}>{t("admin.tg.preview")}</button>
          <button onClick={send} disabled={busy || !preview} className="rounded-full bg-paper px-4 py-2 text-xs font-semibold text-ink hover:brightness-90 disabled:opacity-50">
            {t("admin.tg.send")}
          </button>
        </div>
      </div>
      {preview && (
        // An approximation of the post in Telegram's own look: image on top, the text, then the button.
        <div className="mt-3 max-w-sm overflow-hidden rounded-2xl bg-[#182533] text-[13px] text-white">
          {preview.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview.image} alt="" className="max-h-60 w-full object-cover" />
          )}
          <p className="whitespace-pre-wrap break-words px-3 py-2">{preview.text}</p>
          {preview.buttons.map((b) => (
            <div key={b} className="border-t border-white/10 py-2 text-center text-[#6ab3f3]">
              {b}
            </div>
          ))}
        </div>
      )}

      {msg && <p className={`mt-3 text-xs ${msg.error ? "text-clay-red" : "text-bamboo"}`}>{msg.text}</p>}

      {status?.changelogs && (
        <>
          <h3 className="mt-6 text-xs font-medium text-paper/80">
            {t("admin.tg.changelog")} · {t(status.changelogEnabled && status.hasChangelogSecret ? "admin.tg.changelogOn" : "admin.tg.changelogOff")}
          </h3>
          {status.changelogs.length === 0 ? (
            <p className="mt-1 text-xs text-panda-grey">{t("admin.tg.noChangelogs")}</p>
          ) : (
            <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto text-xs">
              {status.changelogs.map((c) => (
                <li key={c.id} className="rounded-xl bg-ink px-3 py-2">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-panda-grey">
                    <span>
                      {new Date(c.createdAt).toLocaleString()}
                      {c.status === "published" && c.publishedVersion != null ? ` · v${c.publishedVersion + 1}` : c.versions?.length ? ` · ${c.versions.length} v.` : ""}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-bold uppercase tracking-wide ${c.status === "published" ? "bg-bamboo/20 text-bamboo" : c.status === "discarded" ? "bg-paper/10 text-panda-grey" : "bg-sun/20 text-sun"}`}>
                      {t(`admin.tg.changelog.${c.status}`)}
                    </span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{c.text}</p>
                  {c.decidedAt && (
                    <p className="mt-1 text-[10px] text-panda-grey">
                      {new Date(c.decidedAt).toLocaleString()} · tg {c.decidedBy}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {status?.suggestions && (
        <>
          <h3 className="mt-6 text-xs font-medium text-paper/80">{t("admin.tg.suggestions")}</h3>
          {status.suggestions.length === 0 ? (
            <p className="mt-1 text-xs text-panda-grey">{t("admin.tg.noSuggestions")}</p>
          ) : (
            <ul className="mt-2 max-h-80 space-y-1.5 overflow-y-auto text-xs">
              {status.suggestions.map((s) => (
                <li key={s.id} className="rounded-xl bg-ink px-3 py-2">
                  <p className="whitespace-pre-wrap break-words">{s.text}</p>
                  <p className="mt-1 text-[10px] text-panda-grey">
                    {new Date(s.createdAt).toLocaleString()} · tg {s.telegramId}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
