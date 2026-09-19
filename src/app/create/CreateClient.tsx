"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Keypair } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";
import { base64ToTransaction } from "@/lib/pump/wire";
import FeeDistributionStep from "@/components/create/FeeDistributionStep";

type Stage = "form" | "uploading" | "building" | "signing" | "confirming" | "buying" | "done" | "error";
type Shareholder = { address: string; shareBps: number };

const ACCEPTED_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];
const firstBuyPresets = [0.5, 1, 2, 5];

export default function CreateClient() {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction } = useWallet();
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
  const [error, setError] = useState("");
  const [firstBuyAmount, setFirstBuyAmount] = useState("");
  const [buyError, setBuyError] = useState("");
  const [feeShareholders, setFeeShareholders] = useState<Shareholder[] | null>(null);
  const [feeDistributionUsed, setFeeDistributionUsed] = useState(false);
  const [result, setResult] = useState<{ mint: string; signature: string; buySignature?: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setImageError("Please upload a GIF, PNG, JPG or WEBP image.");
      return;
    }
    setImageError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  const canLaunch = imageFile && name.trim().length > 0 && ticker.trim().length > 0 && connected;

  // Buys the just-created coin as a second, separate transaction — the
  // bonding curve doesn't exist until the create transaction has confirmed,
  // so this can't be bundled into the same one. You sign it too.
  async function buyFirst(mint: string, solAmount: number): Promise<string> {
    if (!publicKey) throw new Error("Wallet not connected.");
    const res = await fetch("/api/pump/buy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mint, user: publicKey.toBase58(), solAmount }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to build the first-buy transaction.");

    const tx = base64ToTransaction(data.transaction);
    const signature = await sendTransaction(tx, connection, { maxRetries: 3, preflightCommitment: "confirmed" });

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    if (confirmation.value.err) throw new Error("First buy failed to confirm.");

    return signature;
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
      if (website.trim()) form.set("website", website.trim());
      if (twitter.trim()) form.set("twitter", twitter.trim());

      const uploadRes = await fetch("/api/upload-metadata", { method: "POST", body: form });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed.");

      setStage("building");
      const mint = Keypair.generate();
      const shareholders = feeShareholders;
      const buildRes = await fetch("/api/pump/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mint: mint.publicKey.toBase58(),
          user: publicKey.toBase58(),
          name: name.trim(),
          symbol: ticker.trim(),
          uri: uploadData.uri,
          shareholders: shareholders || undefined,
        }),
      });
      const buildData = await buildRes.json();
      if (!buildRes.ok) throw new Error(buildData.error || "Failed to build transaction.");

      const transaction = base64ToTransaction(buildData.transaction);

      setStage("signing");
      const signature = await sendTransaction(transaction, connection, {
        signers: [mint],
        maxRetries: 3,
        preflightCommitment: "confirmed",
      });

      setStage("confirming");
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      const confirmation = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      if (confirmation.value.err) throw new Error("Transaction failed to confirm.");

      setResult({ mint: mint.publicKey.toBase58(), signature });
      setFeeDistributionUsed(!!shareholders);

      const buyAmount = parseFloat(firstBuyAmount);
      if (buyAmount > 0) {
        setStage("buying");
        try {
          const buySignature = await buyFirst(mint.publicKey.toBase58(), buyAmount);
          setResult({ mint: mint.publicKey.toBase58(), signature, buySignature });
        } catch (buyErr) {
          // The coin itself launched fine — only the optional first buy failed.
          // That's not a launch failure, just a separate note on the success screen.
          setBuyError(explainError(buyErr));
        }
      }

      setStage("done");
    } catch (err) {
      setStage("error");
      setError(explainError(err));
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
    setFirstBuyAmount("");
    setBuyError("");
    setFeeShareholders(null);
    setFeeDistributionUsed(false);
    setResult(null);
    setError("");
  }

  if (stage === "uploading" || stage === "building" || stage === "signing" || stage === "confirming" || stage === "buying") {
    const labels: Record<string, string> = {
      uploading: "Uploading image…",
      building: "Preparing transaction…",
      signing: "Confirm in wallet…",
      confirming: "Confirming on Solana…",
      buying: `Buying your first $${ticker || "COIN"}…`,
    };
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <Panda pose="loading" size={160} />
        <p className="font-display text-lg font-semibold">Launching ${ticker || "COIN"}…</p>
        <p className="text-sm text-panda-grey">{labels[stage]}</p>
      </div>
    );
  }

  if (stage === "error") {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <Panda pose="error" size={150} />
        <p className="font-display text-lg font-semibold">Launch failed</p>
        <p className="max-w-xs text-sm text-panda-grey">{error}</p>
        <button
          onClick={() => setStage("form")}
          className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
        >
          Back to form
        </button>
      </div>
    );
  }

  if (stage === "done" && result) {
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <Panda pose="success" size={170} />
        <div>
          <p className="font-display text-2xl font-bold">${ticker} is live</p>
          <p className="mt-1 text-sm text-panda-grey">{name} was created for real, on-chain.</p>
        </div>
        {imagePreview && (
          <div className="w-full max-w-[220px] overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePreview} alt={name} className="aspect-[4/3] w-full object-cover" />
          </div>
        )}
        <p className="max-w-xs text-xs text-panda-grey">
          It can take a few minutes to show up in Discover while our data source indexes the new pool.
        </p>
        {result.buySignature && (
          <p className="text-sm text-bamboo">Your first buy of ${ticker} went through too.</p>
        )}
        {buyError && (
          <p className="max-w-xs text-xs text-clay-red">
            The coin launched fine, but your first buy didn&apos;t go through: {buyError} You can still buy it from
            its page below.
          </p>
        )}
        {feeDistributionUsed && <p className="text-sm text-bamboo">Fee distribution is set, real and on-chain.</p>}
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={`https://solscan.io/tx/${result.signature}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
          >
            View transaction
          </a>
          <button
            onClick={reset}
            className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
          >
            Create another
          </button>
          <Link
            href={`/coin/${result.mint}`}
            className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
          >
            View coin page
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-4">
        <Panda pose="create" size={84} />
        <div>
          <h1 className="font-display text-2xl font-bold">Create your coin</h1>
          <p className="text-sm text-panda-grey">Upload an image or GIF, name it, launch it — for real, on Solana.</p>
        </div>
      </div>

      <div className="mt-8 space-y-5">
        <div>
          <span className="mb-1.5 block text-sm font-medium text-paper/80">Launch on</span>
          <div className="flex items-center gap-2.5 rounded-2xl border border-bamboo/50 bg-bamboo/10 px-4 py-3">
            <PumpFunIcon />
            <span className="text-sm font-semibold">Pump.fun</span>
          </div>
        </div>

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
              <img src={imagePreview} alt="Uploaded image preview" className="max-h-48 rounded-2xl" />
            ) : (
              <>
                <span className="text-3xl">🖼️</span>
                <span className="font-medium">Upload image</span>
                <span className="text-xs text-panda-grey">GIF, PNG, JPG or WEBP — or drag and drop</span>
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

        <Field label="Token name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dancing Cat"
            maxLength={32}
            className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
          />
        </Field>

        <Field label="Ticker">
          <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 focus-within:border-paper/40">
            <span className="text-panda-grey">$</span>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))}
              placeholder="CAT"
              className="w-full bg-transparent text-sm outline-none placeholder:text-panda-grey"
            />
          </div>
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's the story behind this coin?"
            rows={3}
            maxLength={280}
            className="w-full resize-none rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Website (optional)">
            <input
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
            />
          </Field>
          <Field label="X (optional)">
            <input
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              placeholder="https://x.com/…"
              className="w-full rounded-2xl border border-paper/15 bg-ink-raised px-4 py-3 text-sm outline-none placeholder:text-panda-grey focus:border-paper/40"
            />
          </Field>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-paper/80">Your first buy (optional)</span>
          <p className="mb-2 text-xs text-panda-grey">
            Buy some of ${ticker || "your coin"} the moment it launches, paid in SOL — as its very first trade.
            This is a second transaction right after creation, so you sign it separately.
          </p>
          <div className="flex items-center gap-2 rounded-2xl border border-paper/15 bg-ink px-4 py-3.5 focus-within:border-bamboo/50">
            <input
              value={firstBuyAmount}
              onChange={(e) => setFirstBuyAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              inputMode="decimal"
              className="w-full bg-transparent text-xl font-medium outline-none placeholder:text-panda-grey/50"
            />
            <span className="shrink-0 rounded-full bg-paper/10 px-2.5 py-1 text-xs font-semibold text-paper/80">SOL</span>
          </div>
          <div className="mt-2 grid grid-cols-5 gap-1.5">
            <button
              type="button"
              onClick={() => setFirstBuyAmount("")}
              className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                !firstBuyAmount ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
              }`}
            >
              None
            </button>
            {firstBuyPresets.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setFirstBuyAmount(String(p))}
                className={`rounded-xl py-2 text-xs font-semibold transition-colors ${
                  firstBuyAmount === String(p) ? "bg-bamboo/15 text-bamboo" : "bg-paper/5 text-paper/70 hover:bg-paper/10 hover:text-paper"
                }`}
              >
                {p} SOL
              </button>
            ))}
          </div>
        </div>

        <FeeDistributionStep onChange={setFeeShareholders} />

        <button
          onClick={launch}
          disabled={!canLaunch}
          className="w-full rounded-full bg-paper py-3.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Launch
        </button>
        {!connected && imageFile && name.trim() && ticker.trim() && (
          <p className="text-center text-sm text-panda-grey">Connect your wallet to launch.</p>
        )}
        <p className="text-center text-xs text-panda-grey">
          This mints a real coin on Solana mainnet — you sign it in your own wallet, and you&apos;re the coin&apos;s creator.
        </p>
      </div>
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

function PumpFunIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" className="shrink-0" aria-hidden="true">
      <defs>
        <clipPath id="pumpPillClip">
          <rect x="4" y="10" width="24" height="12" rx="6" />
        </clipPath>
      </defs>
      <g transform="rotate(-45 16 16)">
        <g clipPath="url(#pumpPillClip)">
          <rect x="4" y="10" width="12" height="8" fill="#4ADE94" />
          <rect x="4" y="18" width="12" height="4" fill="#2EBE78" />
          <rect x="16" y="10" width="12" height="8" fill="#FFFFFF" />
          <rect x="16" y="18" width="12" height="4" fill="#C7D3D6" />
        </g>
        <rect x="6.5" y="16.5" width="1.6" height="1.6" rx="0.8" fill="#FFFFFF" />
        <rect x="7" y="19" width="1.2" height="2.6" rx="0.6" fill="#FFFFFF" />
        <rect x="4" y="10" width="24" height="12" rx="6" fill="none" stroke="#123832" strokeWidth="1.6" />
        <line x1="16" y1="10" x2="16" y2="22" stroke="#123832" strokeWidth="1.2" />
      </g>
    </svg>
  );
}

function explainError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/reject|cancel/i.test(message)) return "You rejected the transaction.";
  if (/insufficient/i.test(message)) return "Insufficient SOL to cover the network fee.";
  if (/hosting isn't configured/i.test(message)) return message;
  if (/429|too many requests/i.test(message)) return "The Solana RPC is rate-limiting us — wait a moment and retry.";
  if (/fetch failed|network|ECONNRESET|timeout/i.test(message)) return "Network error — check your connection and retry.";
  if (/blockhash|expired/i.test(message)) return "Transaction expired — try again.";
  return message || "Launch failed. Please try again.";
}
