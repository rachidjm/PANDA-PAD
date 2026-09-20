"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import WalletButton from "@/components/WalletButton";
import Panda from "@/components/panda/Panda";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import type { DictKey } from "@/lib/i18n/translations";
import { useWalletSession } from "@/lib/auth/useWalletSession";
import Countdown from "./Countdown";
import { isOpen, ThemeView } from "./types";

type Stage = "form" | "checking" | "checked" | "signing" | "confirming" | "pending" | "done";
type Upload = { contentId: string; review: "ORIGINAL" | "REVIEW_REQUIRED" | "APPROVED"; imageUrl: string; royaltyBps: number; name: string };
type Mine = { contentId: string; name: string; imageUrl: string; status: string; review: string; asset: string | null; signature: string | null };

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const STEPS: DictKey[] = ["cn.step.art", "cn.step.details", "cn.step.check", "cn.step.mint", "cn.step.done"];

const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export default function CreateNftClient({ slug }: { slug: string }) {
  const { t } = useLanguage();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { ensureSession } = useWalletSession();

  const [theme, setTheme] = useState<ThemeView | null | "missing">(null);
  const [now] = useState(() => Date.now());
  const [stage, setStage] = useState<Stage>("form");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [upload, setUpload] = useState<Upload | null>(null);
  const [error, setError] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [mine, setMine] = useState<Mine[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // ---- data -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/themes?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as { theme: ThemeView }).theme : "missing"))
      .then((th) => !cancelled && setTheme(th as ThemeView | "missing"))
      .catch(() => !cancelled && setTheme("missing"));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const loadMine = useCallback(async () => {
    const r = await fetch(`/api/nft/mine?theme=${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (r.ok) setMine(((await r.json()) as { items: Mine[] }).items);
  }, [slug]);

  const errorText = (code: string | undefined, fallback?: string) => {
    const key = `cn.err.${code}` as DictKey;
    const translated = code ? t(key) : "";
    return translated && translated !== key ? translated : fallback || t("cn.err.generic");
  };

  function pick(f: File | undefined) {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setError("");
  }

  // ---- 1. upload + duplicate check ---------------------------------------------
  async function check() {
    if (!file || !publicKey) return;
    setError("");
    setStage("checking");
    try {
      await ensureSession(); // one free signature proves the wallet is yours
      const form = new FormData();
      form.set("themeSlug", slug);
      form.set("name", name);
      form.set("description", description);
      form.set("image", file);
      const res = await fetch("/api/nft/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(errorText(data.code, data.error)), { code: data.code });
      setUpload(data as Upload);
      setStage("checked");
      void loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("cn.err.generic"));
      setStage("form");
    }
  }

  // ---- 2. confirm (polls; safe to repeat) -----------------------------------------
  async function confirm(contentId: string, sig: string | null): Promise<"done" | "pending" | "failed"> {
    for (let i = 0; i < 30; i++) {
      const res = await fetch("/api/nft/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, ...(sig ? { signature: sig } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSignature(data.signature ?? sig);
        return "done";
      }
      if (res.status !== 202) {
        setError(errorText(data.code, data.error));
        return "failed";
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    return "pending";
  }

  async function finishConfirm(contentId: string, sig: string | null) {
    setStage("confirming");
    const outcome = await confirm(contentId, sig);
    setStage(outcome === "done" ? "done" : outcome === "pending" ? "pending" : "checked");
    void loadMine();
  }

  // ---- 3. mint: prepare -> wallet signs and pays -> confirm ---------------------------
  async function mint(contentId: string) {
    setError("");
    try {
      const asset = Keypair.generate(); // a throwaway key that exists only to sign for the new asset's address
      const prep = await fetch("/api/nft/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, assetAddress: asset.publicKey.toBase58() }),
      });
      const data = await prep.json().catch(() => ({}));
      if (!prep.ok) throw new Error(errorText(data.code, data.error));

      setStage("signing");
      const tx = VersionedTransaction.deserialize(b64ToBytes(data.transaction));
      const sig = await sendTransaction(tx, connection, { signers: [asset], maxRetries: 3 });
      setSignature(sig);
      await finishConfirm(contentId, sig);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(/reject|cancel|denied/i.test(msg) ? t("cn.rejected") : msg || t("cn.err.generic"));
      setStage("checked");
    }
  }

  function reset() {
    setStage("form");
    setFile(null);
    setPreview(null);
    setName("");
    setDescription("");
    setUpload(null);
    setSignature(null);
    setError("");
  }

  // ---- render --------------------------------------------------------------------
  if (theme === null) return <Shell><div className="h-56 animate-pulse rounded-[24px] border border-paper/10 bg-ink-raised" aria-hidden /></Shell>;
  if (theme === "missing") return <Shell><p className="text-panda-grey">{t("th.notFound")}</p></Shell>;

  const open = isOpen(theme, now);
  const step = stage === "done" ? 4 : stage === "signing" || stage === "confirming" || stage === "pending" ? 3 : stage === "checking" || stage === "checked" ? 2 : file ? 1 : 0;
  const used = mine.filter((m) => !["REJECTED", "REJECTED_ONCHAIN"].includes(m.status)).length;

  return (
    <Shell title={theme.title} slug={theme.slug}>
      <Stepper step={step} />

      {!open && stage === "form" ? (
        <Card><p className="text-panda-grey">{t("th.closedNote")}</p></Card>
      ) : !connected ? (
        <Card>
          <div className="flex items-center justify-between gap-6">
            <div>
              <p className="font-medium">{t("cn.connect")}</p>
              <div className="mt-4"><WalletButton /></div>
            </div>
            <Panda pose="empty" size={80} />
          </div>
        </Card>
      ) : stage === "done" ? (
        <Card>
          <div className="flex flex-col items-center gap-4 py-4 text-center">
            {upload && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={upload.imageUrl} alt={upload.name} className="h-40 w-40 rounded-2xl object-cover" />
            )}
            <p className="font-display text-2xl font-bold text-bamboo">{t("cn.published")}</p>
            <div className="flex flex-wrap justify-center gap-3">
              {signature && (
                <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer" className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold transition hover:border-paper/40">
                  {t("cn.viewTx")}
                </a>
              )}
              <Link href={`/themes/${theme.slug}`} className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink transition hover:brightness-90">
                {theme.title}
              </Link>
              <button onClick={reset} className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold transition hover:border-paper/40">
                {t("cn.another")}
              </button>
            </div>
          </div>
        </Card>
      ) : stage === "form" || stage === "checking" ? (
        <Card>
          <div className="mb-4 flex items-center justify-between text-xs text-panda-grey">
            <span>{t("cn.slotsLeft", { n: used, limit: theme.creationLimit })}</span>
            <span className="flex items-center gap-1.5">{t("th.endsIn")} <Countdown target={theme.endTime} className="font-semibold text-paper" /></span>
          </div>

          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
            className={`flex min-h-56 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-4 text-center transition-colors ${dragOver ? "border-paper/60 bg-paper/5" : "border-paper/15 hover:border-paper/35"}`}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="" className="max-h-64 rounded-xl" />
            ) : (
              <>
                <span className="text-3xl" aria-hidden>🖼️</span>
                <span className="font-medium">{t("cn.dropTitle")}</span>
                <span className="text-xs text-panda-grey">{t("cn.dropHint")}</span>
              </>
            )}
          </button>
          <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

          <label className="mt-5 block">
            <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cn.name")}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={FIELD} />
          </label>
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cn.description")}</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={3} className={`${FIELD} resize-none`} />
          </label>

          {error && <p className="mt-4 text-sm text-clay-red" role="alert">{error}</p>}

          <button
            onClick={check}
            disabled={!file || name.trim().length < 2 || stage === "checking"}
            className="mt-5 w-full rounded-full bg-paper py-3.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {stage === "checking" ? t("cn.checking") : t("cn.checkBtn")}
          </button>
        </Card>
      ) : (
        upload && (
          <Card>
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={upload.imageUrl} alt={upload.name} className="h-20 w-20 rounded-xl object-cover" />
              <div className="min-w-0">
                <p className="truncate font-display text-lg font-bold">{upload.name}</p>
                <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${upload.review === "REVIEW_REQUIRED" ? "bg-meme-orange/15 text-meme-orange" : "bg-bamboo/15 text-bamboo"}`}>
                  {upload.review === "REVIEW_REQUIRED" ? t("cn.reviewRequired") : t("cn.original")}
                </span>
              </div>
            </div>

            {upload.review === "REVIEW_REQUIRED" ? (
              <p className="mt-4 rounded-xl bg-ink px-4 py-3 text-sm text-paper/80">{t("cn.reviewNote")}</p>
            ) : (
              <>
                <p className="mt-4 text-sm text-panda-grey">{t("cn.originalNote")}</p>

                <div className="mt-5 rounded-2xl bg-ink p-4">
                  <p className="text-sm font-medium">{t("cn.feesTitle")}</p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-panda-grey">{t("cn.feeNetwork")}</dt><dd className="text-right">{t("cn.feeEstimate")}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-panda-grey">{t("cn.feePanda")}</dt><dd>{t("cn.feeNone")}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-panda-grey">{t("cn.royalty", { pct: upload.royaltyBps / 100 })}</p>
                  <p className="mt-2 text-xs text-panda-grey">{t("cn.permanent")}</p>
                </div>
              </>
            )}

            {error && <p className="mt-4 text-sm text-clay-red" role="alert">{error}</p>}

            {stage === "checked" && upload.review !== "REVIEW_REQUIRED" && (
              <button onClick={() => mint(upload.contentId)} className="mt-5 w-full rounded-full bg-paper py-3.5 text-sm font-semibold text-ink transition hover:brightness-90">
                {t("cn.mint")}
              </button>
            )}
            {stage === "signing" && <Status text={t("cn.signing")} />}
            {stage === "confirming" && <Status text={t("cn.confirming")} />}
            {stage === "pending" && (
              <div className="mt-5">
                <p className="text-sm text-panda-grey">{t("cn.pending")}</p>
                <button onClick={() => finishConfirm(upload.contentId, signature)} className="mt-3 rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold transition hover:border-paper/40">
                  {t("cn.checkAgain")}
                </button>
              </div>
            )}
          </Card>
        )
      )}

      {connected && mine.some((m) => m.status === "PREPARED") && stage !== "done" && (
        <Card>
          {mine.filter((m) => m.status === "PREPARED").map((m) => (
            <div key={m.contentId} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{m.name}</span>
              <button onClick={() => finishConfirm(m.contentId, null)} className="shrink-0 rounded-full border border-paper/20 px-4 py-1.5 text-xs font-semibold transition hover:border-paper/40">
                {t("cn.checkAgain")}
              </button>
            </div>
          ))}
        </Card>
      )}
    </Shell>
  );
}

const FIELD = "w-full rounded-2xl border border-paper/15 bg-ink px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40";

function Shell({ children, title, slug }: { children: React.ReactNode; title?: string; slug?: string }) {
  const { t } = useLanguage();
  return (
    <div className="mx-auto max-w-2xl px-5 py-12">
      {slug && (
        <Link href={`/themes/${slug}`} className="text-sm text-panda-grey transition-colors hover:text-paper">
          ← {title}
        </Link>
      )}
      <h1 className="mt-4 font-display text-3xl font-bold tracking-tight">{t("cn.title")}</h1>
      <div className="mt-6 space-y-4">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <section className="rounded-[24px] border border-paper/10 bg-ink-raised p-5 sm:p-6">{children}</section>;
}

function Status({ text }: { text: string }) {
  return (
    <p className="mt-5 flex items-center gap-2.5 text-sm text-paper/80" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-paper/20 border-t-paper" aria-hidden />
      {text}
    </p>
  );
}

function Stepper({ step }: { step: number }) {
  const { t } = useLanguage();
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEPS.map((key, i) => (
        <li key={key} className="flex flex-1 items-center gap-2" aria-current={i === step ? "step" : undefined}>
          <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i < step ? "bg-bamboo text-ink" : i === step ? "bg-paper text-ink" : "bg-paper/10 text-panda-grey"}`}>
            {i < step ? "✓" : i + 1}
          </span>
          <span className={`hidden truncate text-xs sm:block ${i === step ? "text-paper" : "text-panda-grey"}`}>{t(key)}</span>
          {i < STEPS.length - 1 && <span className={`h-px flex-1 ${i < step ? "bg-bamboo/50" : "bg-paper/10"}`} aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
