"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import Panda from "@/components/panda/Panda";

type Stage = "form" | "launching" | "done";

export default function CreateClient() {
  const { connected } = useWallet();
  const [stage, setStage] = useState<Stage>("form");
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [gifError, setGifError] = useState("");
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = ["image/gif", "image/png", "image/jpeg", "image/webp"];

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setGifError("Please upload a GIF, PNG, JPG or WEBP image.");
      return;
    }
    setGifError("");
    setGifUrl(URL.createObjectURL(file));
  }

  const canLaunch = gifUrl && name.trim().length > 0 && ticker.trim().length > 0 && connected;

  function launch() {
    if (!canLaunch) return;
    setStage("launching");
    setTimeout(() => setStage("done"), 1600);
  }

  function reset() {
    setStage("form");
    setGifUrl(null);
    setName("");
    setTicker("");
    setDescription("");
  }

  if (stage === "launching") {
    return (
      <div className="flex flex-col items-center gap-5 py-16 text-center">
        <Panda pose="loading" size={160} />
        <p className="font-display text-lg font-semibold">Launching ${ticker || "COIN"}…</p>
        <p className="text-sm text-panda-grey">Sealing it onto Solana. One moment.</p>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div className="flex flex-col items-center gap-6 py-12 text-center">
        <Panda pose="success" size={170} />
        <div>
          <p className="font-display text-2xl font-bold">${ticker} is live</p>
          <p className="mt-1 text-sm text-panda-grey">{name} just joined the feed.</p>
        </div>
        {gifUrl && (
          <div className="w-full max-w-[220px] overflow-hidden rounded-[22px] border border-paper/10 bg-ink-raised">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={gifUrl} alt={name} className="aspect-[4/3] w-full object-cover" />
          </div>
        )}
        <div className="flex gap-3">
          <button
            onClick={reset}
            className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold hover:border-paper/40 transition"
          >
            Create another
          </button>
          <Link
            href="/discover"
            className="rounded-full bg-paper px-5 py-2.5 text-sm font-semibold text-ink hover:brightness-90 transition"
          >
            Explore coins
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
          <p className="text-sm text-panda-grey">Upload an image or GIF, name it, launch it.</p>
        </div>
      </div>

      <div className="mt-8 space-y-5">
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
            {gifUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={gifUrl} alt="Uploaded image preview" className="max-h-48 rounded-2xl" />
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
          {gifError && <p className="mt-2 text-sm text-clay-red">{gifError}</p>}
        </div>

        <Field label="Token name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Dancing Cat"
            maxLength={40}
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

        <button
          onClick={launch}
          disabled={!gifUrl || !name.trim() || !ticker.trim()}
          className="w-full rounded-full bg-paper py-3.5 text-sm font-semibold text-ink transition hover:brightness-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Launch
        </button>
        {!connected && gifUrl && name.trim() && ticker.trim() && (
          <p className="text-center text-sm text-panda-grey">Connect your wallet to launch.</p>
        )}
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
