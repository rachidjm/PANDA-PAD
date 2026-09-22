"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Keypair } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { confirmSignature } from "@/lib/solana/confirm";
import { base64ToTransaction } from "@/lib/pump/wire";
import Panda from "@/components/panda/Panda";
import RewardAssetPicker from "@/components/create/RewardAssetPicker";
import { otcRewardAssetByMint } from "@/lib/otc/reward-assets";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";

type Stage =
  | "form"
  | "uploading"
  | "building"
  | "sendingTx1"
  | "confirmingTx1"
  | "sendingTx2"
  | "confirmingTx2"
  | "registering"
  | "done"
  | "error";

const ACCEPTED_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];
const REGISTER_RETRY_DELAYS_MS = [1500, 3000, 6000]; // a 409 means "not indexed yet" — the docs say wait and retry, never relaunch

async function reportStatus(mint: string, event: string, extra?: Record<string, unknown>) {
  try {
    await fetch("/api/otc/launch/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, event, ...extra }),
    });
  } catch {
    // Bookkeeping only — a failed report never blocks the real, on-chain flow.
  }
}

export default function OtcRewardsCreate() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { t } = useLanguage();

  const [stage, setStage] = useState<Stage>("form");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [quoteMint, setQuoteMint] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [registerPending, setRegisterPending] = useState(false);
  const [result, setResult] = useState<{ mint: string; tx1: string; tx2: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError(t("cr.imageType"));
      return;
    }
    setImageError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  const canLaunch = imageFile && name.trim().length > 0 && ticker.trim().length > 0 && ticker.trim().length <= 13 && connected && quoteMint;

  async function registerWithRetries(mint: string) {
    for (let i = 0; i < REGISTER_RETRY_DELAYS_MS.length + 1; i++) {
      const res = await fetch("/api/otc/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      if (res.ok) return true;
      const data = await res.json().catch(() => ({}));
      if (data.code !== "NOT_INDEXED_YET" || i === REGISTER_RETRY_DELAYS_MS.length) return false;
      await new Promise((r) => setTimeout(r, REGISTER_RETRY_DELAYS_MS[i]));
    }
    return false;
  }

  async function launch() {
    if (!canLaunch || !publicKey || !quoteMint) return;
    setError("");
    const mintKeypair = Keypair.generate();
    const mint = mintKeypair.publicKey.toBase58();

    try {
      setStage("uploading");
      const form = new FormData();
      form.set("image", imageFile);
      form.set("mint", mint);
      form.set("creator", publicKey.toBase58());
      form.set("name", name.trim());
      form.set("symbol", ticker.trim());
      form.set("description", description.trim());
      form.set("quoteMint", quoteMint);
      if (website.trim()) form.set("website", website.trim());
      if (twitter.trim()) form.set("twitter", twitter.trim());

      const uploadRes = await fetch("/api/otc/metadata", { method: "POST", body: form });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || t("otc.err.upload"));

      setStage("building");
      const buildRes = await fetch("/api/otc/launch/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || t("otc.err.build"));

      const [tx1b64, tx2b64] = buildData.transactions as [string, string];

      // Two transactions, sent one at a time, never together: TX1's pool config must exist on-chain
      // before TX2 can create a pool from it (see OTC's own docs). TX2 is what actually creates the
      // coin's mint, so it — and only it — needs the mint's own signature alongside the creator's.
      setStage("sendingTx1");
      const tx1 = base64ToTransaction(tx1b64);
      const sig1 = await sendTransaction(tx1, connection, { maxRetries: 3, preflightCommitment: "confirmed" });
      await reportStatus(mint, "tx1_pending", { signature: sig1 });

      setStage("confirmingTx1");
      await confirmSignature(connection, sig1);
      await reportStatus(mint, "tx1_confirmed");

      setStage("sendingTx2");
      const tx2 = base64ToTransaction(tx2b64);
      const sig2 = await sendTransaction(tx2, connection, { signers: [mintKeypair], maxRetries: 3, preflightCommitment: "confirmed" });
      await reportStatus(mint, "tx2_pending", { signature: sig2 });

      setStage("confirmingTx2");
      await confirmSignature(connection, sig2);
      await reportStatus(mint, "tx2_confirmed");

      // From here the coin is real and already earning fees for its holders, whether or not the
      // optional listing step below succeeds — never treat a registration failure as a launch failure.
      setResult({ mint, tx1: sig1, tx2: sig2 });

      setStage("registering");
      const registered = await registerWithRetries(mint);
      setRegisterPending(!registered);

      setStage("done");
    } catch (err) {
      // Only report "failed" for stages before TX2 was sent — src/app/api/otc/launch/status blocks it
      // afterward on purpose, since the coin may already be real by then even if this call threw.
      if (stage !== "sendingTx2" && stage !== "confirmingTx2" && stage !== "registering") {
        await reportStatus(mint, "failed", { error: err instanceof Error ? err.message : String(err) });
      }
      setStage("error");
      setError(explainOtcError(err, t));
    }
  }

  function reset() {
    setStage("form");
    setImageFile(null);
    setImagePreview(null);
    setName("");
    setTicker("");
    setDescription("");
    setWebsite("");
    setTwitter("");
    setQuoteMint(null);
    setConfirming(false);
    setRegisterPending(false);
    setResult(null);
    setError("");
  }

  const busyStages: Stage[] = ["uploading", "building", "sendingTx1", "confirmingTx1", "sendingTx2", "confirmingTx2", "registering"];
  if (busyStages.includes(stage)) {
    const labels: Record<string, string> = {
      uploading: t("otc.stage.uploading"),
      building: t("otc.stage.building"),
      sendingTx1: t("otc.stage.sendingTx1"),
      confirmingTx1: t("otc.stage.confirmingTx1"),
      sendingTx2: t("otc.stage.sendingTx2"),
      confirmingTx2: t("otc.stage.confirmingTx2"),
      registering: t("otc.stage.registering"),
    };
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <Panda pose="loading" size={160} />
        <p className="font-display text-lg font-semibold">{t("cr.launching", { ticker: ticker || "COIN" })}</p>
        <p className="text-sm text-panda-grey">{labels[stage]}</p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <Panda pose="error" size={150} />
        <p className="font-display text-lg font-semibold">{t("cr.failed")}</p>
        <p className="max-w-xs text-sm text-panda-grey">{error}</p>
        <button
          onClick={() => setStage("form")}
          className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
        >
          {t("cr.backToForm")}
        </button>
      </div>
    );
  }

  if (stage === "done" && result) {
    const asset = otcRewardAssetByMint(quoteMint ?? "");
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <Panda pose="success" size={170} />
        <div>
          <p className="font-display text-2xl font-bold">{t("cr.isLive", { ticker })}</p>
          <p className="mt-1 text-sm text-panda-grey">{t("otc.done.summary", { asset: asset?.symbol ?? "" })}</p>
        </div>
        {imagePreview && (
          <div className="w-full max-w-[220px] overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt={name} className="aspect-[4/3] w-full object-cover" />
          </div>
        )}
        <div className="rounded-2xl border border-paper/10 bg-ink-raised px-4 py-3 text-left text-sm">
          <Row label={t("otc.done.launch")} value="PANDA Rewards" />
          <Row label={t("otc.done.venue")} value="Meteora" />
          <Row label={t("otc.done.rewardAsset")} value={asset?.symbol ?? "—"} />
        </div>
        {registerPending && <p className="max-w-xs text-xs text-panda-grey">{t("otc.done.registerPending")}</p>}
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`https://solscan.io/tx/${result.tx2}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
          >
            {t("cr.viewTx")}
          </a>
          <button
            onClick={reset}
            className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
          >
            {t("cr.createAnother")}
          </button>
          <Link
            href={`/coin/${result.mint}`}
            className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
          >
            {t("cr.viewCoin")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      <div>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
          className={`flex w-full flex-col items-center justify-center gap-2 rounded-[22px] border-2 border-dashed px-6 py-10 text-center transition-colors ${
            dragOver ? "border-meme-orange bg-meme-orange/5" : "border-paper/20 hover:border-paper/35"
          }`}
        >
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt={t("cr.previewAlt")} className="max-h-48 rounded-2xl" />
          ) : (
            <>
              <span className="text-3xl">🖼️</span>
              <span className="font-medium">{t("cr.uploadImage")}</span>
              <span className="text-xs text-panda-grey">{t("cr.uploadHint")}</span>
            </>
          )}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/gif,image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        {imageError && <p className="mt-2 text-sm text-clay-red">{imageError}</p>}
      </div>

      <Field label={t("cr.tokenName")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("cr.namePh")}
          maxLength={32}
          className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
        />
      </Field>

      <Field label={t("cr.ticker")}>
        <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 focus-within:border-paper/40">
          <span className="text-panda-grey">$</span>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 13))}
            placeholder="CAT"
            className="w-full bg-transparent text-sm outline-none placeholder:text-panda-grey"
          />
        </div>
      </Field>

      <Field label={t("cr.description")}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("cr.descPh")}
          rows={3}
          maxLength={280}
          className="w-full resize-none rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label={t("cr.website")}>
          <input
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
          />
        </Field>
        <Field label={t("cr.xOpt")}>
          <input
            value={twitter}
            onChange={(e) => setTwitter(e.target.value)}
            placeholder="https://x.com/…"
            className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
          />
        </Field>
      </div>

      <RewardAssetPicker value={quoteMint} onChange={setQuoteMint} />

      <OtcSplitInfo />

      <button
        onClick={() => setConfirming(true)}
        disabled={!canLaunch}
        className="w-full rounded-full bg-paper py-3.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("cr.launch")}
      </button>
      {!connected && imageFile && name.trim() && ticker.trim() && (
        <p className="text-center text-sm text-panda-grey">{t("cr.connectToLaunch")}</p>
      )}
      <p className="text-center text-xs text-panda-grey">{t("otc.mintNote")}</p>

      {confirming && (
        <OtcLaunchConfirm
          name={name.trim()}
          ticker={ticker.trim()}
          imageSrc={imagePreview}
          rewardAssetSymbol={otcRewardAssetByMint(quoteMint ?? "")?.symbol ?? ""}
          onBack={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            launch();
          }}
        />
      )}
    </div>
  );
}

/** The fixed OTC split — shown, never editable: the /api/meteora/launch endpoint has no field for it. */
function OtcSplitInfo() {
  const { t } = useLanguage();
  return (
    <div className="rounded-2xl border border-paper/15 bg-ink-raised p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        {t("otc.split.title")}
        <span
          tabIndex={0}
          title={t("otc.split.tooltip")}
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-paper/10 text-[10px] font-bold text-panda-grey"
        >
          i
        </span>
      </p>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
        <span className="text-sm">{t("otc.split.holders")}</span>
        <span className="text-sm font-semibold text-bamboo">67.5%</span>
      </div>
      <p className="mt-2 text-xs text-panda-grey">{t("otc.split.rest")}</p>
    </div>
  );
}

function OtcLaunchConfirm({
  name,
  ticker,
  imageSrc,
  rewardAssetSymbol,
  onBack,
  onConfirm,
}: {
  name: string;
  ticker: string;
  imageSrc: string | null;
  rewardAssetSymbol: string;
  onBack: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/80 p-4 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-labelledby="otc-launch-confirm-title">
      <div className="w-full max-w-md rounded-[24px] border border-paper/10 bg-ink-raised p-6 shadow-2xl">
        <h2 id="otc-launch-confirm-title" className="font-display text-xl font-bold tracking-tight">
          {t("cr.confirmTitle")}
        </h2>
        <div className="mt-4 flex items-center gap-3">
          {imageSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageSrc} alt="" className="h-12 w-12 rounded-full object-cover" />
          )}
          <div className="min-w-0">
            <p className="truncate font-medium">{name}</p>
            <p className="text-sm text-panda-grey">${ticker}</p>
          </div>
        </div>
        <div className="mt-4 space-y-1.5 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
            <span className="text-panda-grey">{t("otc.done.rewardAsset")}</span>
            <span className="font-semibold">{rewardAssetSymbol}</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
            <span className="text-panda-grey">{t("otc.done.venue")}</span>
            <span className="font-semibold">Meteora</span>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-ink px-3.5 py-2.5">
            <span className="text-panda-grey">{t("otc.split.holders")}</span>
            <span className="font-semibold text-bamboo">67.5%</span>
          </div>
        </div>
        <p className="mt-4 text-xs text-panda-grey">{t("otc.confirmBody")}</p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-paper/20 py-3 text-sm font-semibold transition-colors hover:border-paper/40"
          >
            {t("cr.confirmBack")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            autoFocus
            className="rounded-full bg-paper py-3 text-sm font-semibold text-ink transition hover:brightness-90"
          >
            {t("cr.confirmGo")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-panda-grey">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-paper/80">{label}</span>
      {children}
    </label>
  );
}

function explainOtcError(err: unknown, t: (key: DictKey, vars?: Record<string, string | number>) => string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return t("cr.err.rejected");
  if (/insufficient/i.test(message)) return t("cr.err.insufficient");
  if (/429|too many requests/i.test(message)) return t("cr.err.rateLimit");
  if (/fetch failed|network|ECONNRESET|timeout/i.test(message)) return t("cr.err.network");
  if (/blockhash|expired/i.test(message)) return t("cr.err.expired");
  if (/could not be priced/i.test(message)) return t("otc.err.unpriceable");
  if (/isn't offered/i.test(message)) return t("otc.err.badAsset");
  return message || t("cr.err.generic");
}
