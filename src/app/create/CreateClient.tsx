"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { confirmSignature } from "@/lib/solana/confirm";
import Link from "next/link";
import { Keypair } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import ImagePlaceholderIcon from "@/components/icons/ImagePlaceholderIcon";
import { base64ToTransaction, base64ToVersionedTransaction } from "@/lib/pump/wire";
import { applyFeeSplit, registerFeeDistribution } from "@/lib/pump/fee-split-client";
import FeeDistributionStep, { FeeDistributionResult } from "@/components/create/FeeDistributionStep";
import LaunchConfirm from "@/components/create/LaunchConfirm";
import LaunchModeToggle, { LaunchMode } from "@/components/create/LaunchModeToggle";
import OtcRewardsCreate from "@/components/create/OtcRewardsCreate";
import { formatBps } from "@/lib/pump/fee-plan";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { DictKey } from "@/lib/i18n/translations";
import { useFeatures } from "@/components/providers/FeaturesProvider";
import { useCreationStatus } from "@/components/create/useCreationBlocked";
import FirstBuyField from "@/components/create/FirstBuyField";
import CreatePreview from "@/components/create/CreatePreview";
import CostSummary from "@/components/create/CostSummary";
import { useLaunchInfo } from "@/components/create/useLaunchInfo";
import { DESCRIPTION_MAX, IMAGE_MAX_MB, NAME_MAX, TICKER_MAX, imageIssue, telegramLink, websiteLink, xLink } from "@/lib/create/fields";
import { launchCost } from "@/lib/pump/launch-info";
import { useFeeBps } from "@/lib/pump/useFeeBps";
import { useRates } from "@/components/coin/useRates";
import { firstBuyFromInput, type BuyUnit } from "@/lib/trading/amount";

type Stage = "form" | "uploading" | "building" | "signing" | "confirming" | "fees" | "buying" | "done" | "error";

const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * `coinHref`, `onSigning` and `onLaunched` are for the Telegram Mini App, which shows this very form
 * (src/components/tg/TgCreate.tsx): where "View coin page" goes, and when the coin's address is about to be signed for
 * and when the launch has finished. The website passes none of them and behaves exactly as before.
 */
export default function CreateClient({
  minFirstBuySol,
  coinHref = (mint) => `/coin/${mint}`,
  onSigning,
  onLaunched,
}: {
  minFirstBuySol: number;
  coinHref?: (mint: string) => string;
  onSigning?: (mint: string) => void;
  onLaunched?: (mint: string) => void;
}) {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
  const { t } = useLanguage();
  const { otcRewards, referrals } = useFeatures();
  const { blocked: creationBlocked, singleTx } = useCreationStatus();
  const [chosenMode, setMode] = useState<LaunchMode>("standard");
  // The Rewards mode exists only when FEATURE_OTC_REWARDS is on; otherwise Create is exactly the Standard launch.
  const mode: LaunchMode = otcRewards ? chosenMode : "standard";
  const [stage, setStage] = useState<Stage>("form");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageError, setImageError] = useState("");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  // The form is two steps (identity, then economics). Both stay mounted, so each remembers what was typed in it.
  const [step, setStep] = useState<1 | 2>(1);
  const [touched, setTouched] = useState<{ image?: boolean; name?: boolean; ticker?: boolean }>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const launchFacts = useLaunchInfo();
  const feeBps = useFeeBps(publicKey?.toBase58());
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState("");
  const [firstBuyAmount, setFirstBuyAmount] = useState("");
  const [firstBuyUnit, setFirstBuyUnit] = useState<BuyUnit>("SOL");
  // Live SOL/euro rates, so the first buy can be typed in dollars or euros (it is always paid in SOL).
  const rates = useRates(SOL_MINT);
  const firstBuy = firstBuyFromInput(firstBuyUnit, firstBuyAmount, rates);
  const [buyError, setBuyError] = useState("");
  const [feeResult, setFeeResult] = useState<FeeDistributionResult | null>(null);
  const searchParams = useSearchParams();
  // From the AI Assistant's "Crear moneda con IA" (src/components/ai/CreatePanel.tsx): the user already
  // picked one of 3 proposals there, this just fills the same form fields they'd otherwise type by hand — the
  // image is still theirs to upload below, nothing here skips that.
  useEffect(() => {
    const aiName = searchParams.get("aiName");
    const aiTicker = searchParams.get("aiTicker");
    const aiDescription = searchParams.get("aiDescription");
    if (!aiName && !aiTicker && !aiDescription) return;
    Promise.resolve().then(() => {
      if (aiName) setName(aiName.slice(0, NAME_MAX));
      if (aiTicker) setTicker(aiTicker.slice(0, TICKER_MAX));
      if (aiDescription) setDescription(aiDescription.slice(0, DESCRIPTION_MAX));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [feeSummary, setFeeSummary] = useState("");
  const [confirming, setConfirming] = useState(false);
  // A launch with a fee split is two transactions (see src/lib/pump/create.ts). If the second is not confirmed the coin exists
  // WITHOUT its split, and this holds the message and lets the creator retry.
  const [feesPending, setFeesPending] = useState(false);
  const [feeError, setFeeError] = useState("");
  const [retryingFees, setRetryingFees] = useState(false);
  const [result, setResult] = useState<{ mint: string; signature: string; buySignature?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const issue = imageIssue(file);
    if (issue) {
      setImageError(issue === "type" ? t("cr.imageType") : t("cr.imageSize", { mb: IMAGE_MAX_MB }));
      return;
    }
    setImageError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  // The split must be complete and valid: an empty or broken plan never falls through to "no fee distribution".
  const feeReady = !!feeResult && feeResult.lines.length > 0 && !feeResult.issue && !feeResult.invalidNumber;
  // The first buy is mandatory now, not optional — it must clear the configured minimum before Launch unlocks.
  const identityReady = !!imageFile && name.trim().length > 0 && ticker.trim().length > 0;
  const canLaunch = imageFile && name.trim().length > 0 && ticker.trim().length > 0 && connected && feeReady && !creationBlocked && !firstBuy.noRate && firstBuy.sol >= minFirstBuySol;

  const kindLabel = (kind: "panda" | "creator" | "holders" | "burn" | "partner") =>
    kind === "panda" ? "PANDA" : kind === "creator" ? t("fd.creator") : kind === "holders" ? t("fd.holders") : kind === "burn" ? t("fd.burn") : t("fd.partner");

  // Buys the just-created coin as a second, separate transaction — the
  // bonding curve doesn't exist until the create transaction has confirmed,
  // so this can't be bundled into the same one. You sign it too.
  async function buyFirst(mint: string, solAmount: number): Promise<string> {
    if (!publicKey) throw new Error(t("cr.err.buyWallet"));
    const res = await fetch("/api/pump/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, user: publicKey.toBase58(), solAmount }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("cr.err.buyBuild"));

    const tx = base64ToTransaction(data.transaction);
    const signature = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });

    await confirmSignature(connection, signature);

    // Best-effort, same as every other real buy in the app (TradingPanel.tsx) — without this, a creator's own
    // first buy never enters their trade history, so Portfolio's cost-basis/P&L math has nothing to work from
    // for that coin (it either doesn't show at all, or shows degenerate numbers once the on-chain backfill
    // eventually — and only partially — catches up to it).
    fetch("/api/portfolio/record-trade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: publicKey.toBase58(), mint, ticker: ticker.trim().toUpperCase() || mint.slice(0, 4), side: "buy", signature }),
    }).catch(() => {});

    return signature;
  }

  async function retryFeeSplit() {
    if (!result || !feeResult) return;
    setRetryingFees(true);
    setFeeError("");
    try {
      await applyFeeSplit({ connection, publicKey, sendTransaction, mint: result.mint, shareholders: feeResult.lines.map((l) => ({ address: l.address, shareBps: l.bps })), errors: { noWallet: t("cr.err.buyWallet"), build: t("cr.err.build") } });
      setFeesPending(false);
    } catch (err) {
      setFeeError(explainError(err, t));
    } finally {
      setRetryingFees(false);
    }
  }

  async function launch() {
    if (!canLaunch || !publicKey) return;
    setError("");
    setBuyError("");
    try {
      setStage("uploading");
      const form = new FormData();
      form.set("image", imageFile);
      form.set("name", name.trim());
      form.set("symbol", ticker.trim());
      form.set("description", description.trim());
      if (websiteLink(website)) form.set("website", websiteLink(website));
      if (xLink(twitter)) form.set("twitter", xLink(twitter));
      if (telegramLink(telegram)) form.set("telegram", telegramLink(telegram));

      const uploadRes = await fetch("/api/upload-metadata", { method: "POST", body: form });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || t("cr.err.upload"));

      setStage("building");
      const shareholders = (feeResult?.lines ?? []).map((l) => ({ address: l.address, shareBps: l.bps }));
      const summary = (feeResult?.lines ?? []).map((l) => `${kindLabel(l.kind)} ${formatBps(l.bps)}%`).join(" · ");
      const buildRes = await fetch("/api/pump/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user: publicKey.toBase58(),
          name: name.trim(),
          symbol: ticker.trim(),
          uri: uploadData.uri,
          shareholders: shareholders.length ? shareholders : undefined,
          firstBuySol: firstBuy.sol,
        }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || t("cr.err.build"));
      // The mint is now assigned by the server (an address ending in "panda" when the pre-generated stock has
      // one left — see src/lib/vanity/stock.ts) rather than generated in the browser; only its secret ever
      // needs to leave the server, and only once, right here, so this tab can sign with it below.
      const mint = Keypair.fromSecretKey(Uint8Array.from(buildData.mintSecretKey));

      // `combined`: the whole launch (coin + fee split) is ONE v0 transaction; otherwise it is the coin alone and the split follows.
      const transaction = buildData.combined ? base64ToVersionedTransaction(buildData.transaction) : base64ToTransaction(buildData.transaction);

      setStage("signing");
      onSigning?.(mint.publicKey.toBase58());
      const signature = await sendTransaction(transaction, connection, {
        signers: [mint],
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });

      setStage("confirming");
      await confirmSignature(connection, signature);

      setResult({ mint: mint.publicKey.toBase58(), signature });
      setFeeSummary(summary);
      setFeesPending(false);
      setFeeError("");

      // Best-effort — the launch itself already succeeded either way; this only unlocks the "Lanzada en PANDA"
      // showcase and the coin-page-as-recruiter-link feature (src/lib/referrals/client.ts), never the launch flow.
      fetch("/api/launch/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mint: mint.publicKey.toBase58(), signature }),
      }).catch(() => {});

      if (buildData.combined) {
        // One atomic transaction did both: the split can't be missing. Only let PANDA's registry know about the coin.
        void registerFeeDistribution(mint.publicKey.toBase58());
      } else if (shareholders.length) {
        // The coin exists now; the split is the second transaction. If it is rejected or fails, the launch is NOT undone:
        // the coin is live but hidden from PANDA's lists, and the done screen says its split is not set yet and offers a retry
        // (its creator also gets the same notice on the coin page).
        setStage("fees");
        try {
          await applyFeeSplit({ connection, publicKey, sendTransaction, mint: mint.publicKey.toBase58(), shareholders, errors: { noWallet: t("cr.err.buyWallet"), build: t("cr.err.build") } });
        } catch (feeErr) {
          setFeesPending(true);
          setFeeError(explainError(feeErr, t));
          // Let the server see the coin without its split now, so it is audited without waiting for the daily check.
          void fetch(`/api/pump/fee-lock?mint=${mint.publicKey.toBase58()}`).catch(() => {});
        }
      }

      const buyAmount = firstBuy.sol;
      if (buyAmount > 0) {
        setStage("buying");
        try {
          const buySignature = await buyFirst(mint.publicKey.toBase58(), buyAmount);
          setResult({ mint: mint.publicKey.toBase58(), signature, buySignature });
        } catch (buyErr) {
          // The coin itself launched fine — only the optional first buy failed.
          // That's not a launch failure, just a separate note on the success screen.
          setBuyError(explainError(buyErr, t));
        }
      }

      setStage("done");
      onLaunched?.(mint.publicKey.toBase58());
    } catch (err) {
      setStage("error");
      setError(explainError(err, t));
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
    setTelegram("");
    setStep(1);
    setTouched({});
    setPreviewOpen(false);
    setFirstBuyAmount("");
    setBuyError("");
    setFeeResult(null);
    setFeeSummary("");
    setConfirming(false);
    setResult(null);
    setError("");
  }

  if (stage === "uploading" || stage === "building" || stage === "signing" || stage === "confirming" || stage === "fees" || stage === "buying") {
    const labels: Record<string, string> = {
      uploading: t("cr.stageUploading"),
      building: t("cr.stageBuilding"),
      signing: t("cr.stageSigning"),
      confirming: t("cr.stageConfirming"),
      fees: t("cr.stageFees"),
      buying: t("cr.stageBuying", { ticker: ticker || "COIN" }),
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
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <Panda pose="success" size={170} />
        <div>
          <p className="font-display text-2xl font-bold">{t("cr.isLive", { ticker })}</p>
          <p className="mt-1 text-sm text-panda-grey">{t("cr.createdReal", { name })}</p>
        </div>
        {imagePreview && (
          <div className="w-full max-w-[220px] overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt={name} className="aspect-[4/3] w-full object-cover" />
          </div>
        )}
        <p className="max-w-xs text-xs text-panda-grey">
          {t("cr.indexNote")}
        </p>
        {result.buySignature && (
          <p className="text-sm text-bamboo">{t("cr.firstBuyOk", { ticker })}</p>
        )}
        {buyError && (
          <p className="max-w-xs text-xs text-clay-red">
            {t("cr.firstBuyFail", { error: buyError })}
          </p>
        )}
        {feesPending ? (
          <div className="w-full max-w-sm rounded-2xl border border-clay-red/40 bg-clay-red/10 px-4 py-3 text-left text-sm" role="alert">
            <p className="font-semibold text-clay-red">{t("cr.feesPendingTitle")}</p>
            <p className="mt-1 text-paper/80">{t("cr.feesPendingBody")}</p>
            {feeError && <p className="mt-1 text-xs text-clay-red">{feeError}</p>}
            <button
              type="button"
              onClick={retryFeeSplit}
              disabled={retryingFees}
              className="mt-3 w-full rounded-full bg-paper py-2.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:opacity-50"
            >
              {retryingFees ? t("cr.stageFees") : t("cr.feesRetry")}
            </button>
          </div>
        ) : (
          <p className="text-sm text-bamboo">{t("cr.feeSet", { summary: feeSummary })}</p>
        )}
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`https://solscan.io/tx/${result.signature}`}
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
            href={coinHref(result.mint)}
            className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
          >
            {t("cr.viewCoin")}
          </Link>
        </div>
      </div>
    );
  }

  const cost = launchCost(launchFacts, firstBuy.noRate ? 0 : firstBuy.sol, feeBps);
  // What launching takes besides the purchase itself and its fee: the coin's accounts, the first buy's own account and the network fees.
  const fixedCostSol = launchCost(launchFacts, 1, 0).network;
  const splitText = feeReady && feeResult ? feeResult.lines.map((l) => `${kindLabel(l.kind)} ${formatBps(l.bps)}%`) : null;
  const missing = [!imageFile && t("cr.s1.needImage"), !name.trim() && t("cr.s1.needName"), !ticker.trim() && t("cr.s1.needTicker")].filter((x): x is string => !!x);
  const INPUT = "w-full rounded-2xl border border-paper/10 bg-ink px-4 py-3.5 text-base outline-none transition-colors placeholder:text-panda-grey/70 focus:border-bamboo/60";

  return (
    <div>
      <header className="max-w-2xl">
        <h1 className="font-display text-[2rem] font-bold leading-[1.05] tracking-tight sm:text-5xl">{t("cr.heading")}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-panda-grey sm:text-base">{t("cr.sub")}</p>
      </header>

      {creationBlocked && (
        <div className="mt-6 rounded-2xl border border-clay-red/40 bg-clay-red/10 px-4 py-3 text-sm leading-relaxed" role="alert">
          <p className="font-semibold text-clay-red">{t("cr.blocked.title")}</p>
          <p className="mt-1 text-paper/80">{t("cr.blocked.body")}</p>
        </div>
      )}

      {otcRewards && (
        <div className="mt-7 max-w-2xl">
          <LaunchModeToggle mode={mode} onChange={setMode} />
        </div>
      )}

      {mode === "rewards" ? (
        <div className="max-w-2xl">
          <OtcRewardsCreate blocked={creationBlocked} />
        </div>
      ) : (
        <>
          {/* Desktop: the form card on the left, the live preview on the right (it stays in view while the form scrolls).
              Phone and Mini App: the form, and the preview under it behind "See preview". */}
          <div className="mt-7 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start lg:gap-8">
            <section className="rounded-[26px] border border-paper/10 bg-ink-raised p-4 sm:rounded-[28px] sm:p-8">
              <ol className="flex items-center gap-3 text-sm">
                {([1, 2] as const).map((n) => {
                  const active = step === n;
                  const locked = n === 2 && !identityReady;
                  return (
                    <li key={n} className="flex items-center gap-3">
                      {n === 2 && <span className="h-px w-5 bg-paper/15 sm:w-8" aria-hidden />}
                      <button
                        type="button"
                        onClick={() => setStep(n)}
                        disabled={locked}
                        aria-current={active ? "step" : undefined}
                        className="flex items-center gap-2 rounded-full py-1 pr-1 transition-opacity disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${active ? "bg-bamboo text-ink" : n < step ? "bg-paper/15 text-paper" : "border border-paper/20 text-panda-grey"}`}>
                          {n < step ? "✓" : n}
                        </span>
                        <span className={active ? "font-semibold" : "text-panda-grey"}>{t(n === 1 ? "cr.step1" : "cr.step2")}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              {/* Step 1 — identity */}
              <div className={step === 1 ? "mt-5 space-y-6" : "hidden"}>
                <h2 className="font-display text-xl font-bold sm:text-2xl">{t("cr.s1.title")}</h2>

                <div>
                  <span className="mb-2 block text-sm font-medium text-paper/80">{t("cr.image")}</span>
                  <div className="flex items-center gap-4">
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
                      aria-label={t("cr.chooseImage")}
                      className={`flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 transition-colors ${
                        imagePreview ? "border-solid border-paper/15 hover:border-paper/35" : dragOver ? "border-dashed border-meme-orange bg-meme-orange/5" : "border-dashed border-paper/20 bg-ink hover:border-paper/40"
                      }`}
                    >
                      {imagePreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imagePreview} alt={t("cr.previewAlt")} className="h-full w-full object-cover" />
                      ) : (
                        <ImagePlaceholderIcon className="h-7 w-7 text-panda-grey" />
                      )}
                    </button>
                    <div className="min-w-0">
                      <p className="text-sm text-panda-grey">{t("cr.imageHint", { mb: IMAGE_MAX_MB })}</p>
                      <button
                        type="button"
                        onClick={() => fileInput.current?.click()}
                        className="mt-2 min-h-11 rounded-full border border-paper/25 px-5 text-sm font-semibold transition-colors hover:border-paper/50"
                      >
                        {t(imagePreview ? "cr.changeImage" : "cr.chooseImage")}
                      </button>
                    </div>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/gif,image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      handleFile(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  {imageError && (
                    <p className="mt-2 text-sm text-clay-red" role="alert">
                      {imageError}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3 sm:gap-4">
                  <Field label={t("cr.tokenName")} count={`${name.length}/${NAME_MAX}`} error={touched.name && !name.trim() ? t("cr.s1.nameError") : undefined}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => setTouched((x) => ({ ...x, name: true }))}
                      placeholder={t("cr.namePh")}
                      maxLength={NAME_MAX}
                      className={INPUT}
                    />
                  </Field>
                  <Field label={t("cr.ticker")} count={`${ticker.length}/${TICKER_MAX}`} error={touched.ticker && !ticker.trim() ? t("cr.s1.tickerError") : undefined}>
                    <div className="flex items-center gap-1.5 rounded-2xl border border-paper/10 bg-ink px-4 transition-colors focus-within:border-bamboo/60">
                      <span className="text-panda-grey">$</span>
                      <input
                        value={ticker}
                        onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, TICKER_MAX))}
                        onBlur={() => setTouched((x) => ({ ...x, ticker: true }))}
                        placeholder="CAT"
                        className="w-full min-w-0 bg-transparent py-3.5 text-base outline-none placeholder:text-panda-grey/70"
                      />
                    </div>
                  </Field>
                </div>

                <Field label={t("cr.description")} count={`${description.length}/${DESCRIPTION_MAX}`}>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("cr.descPh")} rows={3} maxLength={DESCRIPTION_MAX} className={`${INPUT} resize-none`} />
                </Field>

                <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
                  <Field label="X" optional={t("cr.optional")}>
                    <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder={t("cr.xPh")} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={INPUT} />
                  </Field>
                  <Field label="Telegram" optional={t("cr.optional")}>
                    <input value={telegram} onChange={(e) => setTelegram(e.target.value)} placeholder={t("cr.tgPh")} autoCapitalize="none" autoCorrect="off" spellCheck={false} className={INPUT} />
                  </Field>
                  <Field label={t("cr.web")} optional={t("cr.optional")}>
                    <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} className={INPUT} />
                  </Field>
                </div>

                <div className="flex flex-col-reverse items-stretch gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-panda-grey" aria-live="polite">
                    {missing.length > 0 ? t("cr.s1.missing", { list: missing.join(", ") }) : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setStep(2);
                      window.scrollTo({ top: 0 });
                    }}
                    disabled={!identityReady}
                    className="min-h-14 shrink-0 rounded-full bg-paper px-10 text-base font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {t("cr.continue")}
                  </button>
                </div>
              </div>

              {/* Step 2 — economics. Kept mounted while step 1 is on screen, so the split and the first buy are remembered. */}
              <div className={step === 2 ? "mt-5 space-y-6" : "hidden"}>
                <h2 className="font-display text-xl font-bold sm:text-2xl">{t("cr.s2.title")}</h2>

                <FirstBuyField value={firstBuyAmount} unit={firstBuyUnit} onValue={setFirstBuyAmount} onUnit={setFirstBuyUnit} rates={rates} description={t("cr.firstBuyDesc")} minSol={minFirstBuySol} />

                {connected && publicKey ? (
                  <FeeDistributionStep creator={publicKey.toBase58()} onChange={setFeeResult} />
                ) : (
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-paper/80">{t("cr.feeDistribution")}</span>
                    <p className="rounded-2xl bg-ink px-4 py-3.5 text-sm leading-relaxed text-panda-grey">{t("cr.feeConnect")}</p>
                  </div>
                )}

                <CostSummary cost={cost} feeBps={feeBps} />

                {referrals && <p className="text-xs leading-relaxed text-panda-grey">{t("cr.recruiterNote")}</p>}

                <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 pt-1 sm:flex sm:justify-between">
                  <button type="button" onClick={() => setStep(1)} className="min-h-14 rounded-full border border-paper/25 px-7 text-base font-semibold transition-colors hover:border-paper/50">
                    {t("cr.back")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(true)}
                    disabled={!canLaunch}
                    className="min-h-14 rounded-full bg-paper px-10 text-base font-bold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40 sm:min-w-52"
                  >
                    {t("cr.launch")}
                  </button>
                </div>
                {!connected && <p className="text-right text-sm text-panda-grey">{t("cr.connectToLaunch")}</p>}
                <p className="text-xs leading-relaxed text-panda-grey">{t("cr.mintNote")}</p>
              </div>
            </section>

            <aside className="mt-4 lg:sticky lg:top-[calc(var(--header-h,68px)+20px)] lg:mt-0">
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                aria-expanded={previewOpen}
                className="flex min-h-12 w-full items-center justify-between rounded-2xl border border-paper/10 bg-ink-raised px-4 text-sm font-semibold lg:hidden"
              >
                {t(previewOpen ? "cr.pv.hide" : "cr.pv.show")}
                <span className={`text-panda-grey transition-transform ${previewOpen ? "rotate-180" : ""}`} aria-hidden>
                  ▾
                </span>
              </button>
              <div className={`${previewOpen ? "mt-3" : "hidden"} lg:mt-0 lg:block`}>
                <p className="mb-2 hidden text-xs font-medium text-panda-grey lg:block">{t("cr.pv.label")}</p>
                <CreatePreview
                  image={imagePreview}
                  name={name.trim()}
                  ticker={ticker}
                  description={description}
                  supply={launchFacts.supply}
                  graduationSol={launchFacts.graduationSol}
                  split={splitText}
                  costSol={fixedCostSol}
                />
              </div>
            </aside>
          </div>

          {confirming && feeResult && (
            <LaunchConfirm
              name={name.trim()}
              ticker={ticker.trim()}
              imageSrc={imagePreview}
              lines={feeResult.lines}
              firstBuySol={firstBuy.sol}
              firstBuyNote={firstBuyUnit !== "SOL" && firstBuy.sol > 0 ? `${firstBuyUnit === "USD" ? "$" : "€"}${firstBuyAmount}` : undefined}
              singleTx={singleTx}
              onBack={() => setConfirming(false)}
              onConfirm={() => {
                setConfirming(false);
                launch();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, optional, count, error, children }: { label: string; optional?: string; count?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-0">
      <span className="mb-2 flex items-baseline gap-1.5 text-sm font-medium text-paper/80">
        {label}
        {optional && <span className="text-xs font-normal text-panda-grey">{optional}</span>}
      </span>
      {children}
      {(count || error) && (
        <span className="mt-1.5 flex items-start justify-between gap-2 text-xs">
          <span className="text-clay-red" role={error ? "alert" : undefined}>
            {error ?? ""}
          </span>
          {count && <span className="shrink-0 tabular-nums text-panda-grey">{count}</span>}
        </span>
      )}
    </label>
  );
}

function explainError(err: unknown, t: (key: DictKey) => string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return t("cr.err.rejected");
  if (/insufficient/i.test(message)) return t("cr.err.insufficient");
  if (/hosting isn't configured/i.test(message)) return message;
  if (/429|too many requests/i.test(message)) return t("cr.err.rateLimit");
  if (/fetch failed|network|ECONNRESET|timeout/i.test(message)) return t("cr.err.network");
  if (/blockhash|expired/i.test(message)) return t("cr.err.expired");
  return message || t("cr.err.generic");
}
