"use client";

import { useState } from "react";
import { isPumpCoin, pumpImageUrl } from "@/lib/coin-image";

// Same tinted-chip palette already used for badges elsewhere on the site (KindChip, RugBadge): a
// tint background with the same color as solid text, never a color that isn't already brand-approved.
const PALETTE = [
  { bg: "bg-meme-orange/15", text: "text-meme-orange" },
  { bg: "bg-bamboo/15", text: "text-bamboo" },
  { bg: "bg-clay-red/15", text: "text-clay-red" },
  { bg: "bg-sun/15", text: "text-sun" },
];

/** A short, stable string → one of `PALETTE`'s tones, so the same coin always gets the same color tile. */
function toneFor(key: string): (typeof PALETTE)[number] {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** Two letters worth showing as initials — from the ticker if it has any, else from the mint address. Never "?". */
function initialsFor(ticker: string, mint?: string): string {
  const fromTicker = ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  if (fromTicker) return fromTicker.toUpperCase();
  const fromMint = (mint ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 2);
  return (fromMint || "PN").toUpperCase(); // "PN" (Panda) is the only literal fallback, and only for a blank mint too
}

/**
 * A coin's real logo, or — when it has none (or the image fails to load) — a generated tile: initials from its
 * ticker (or its address, if the ticker is unusable) on a color that's always the same for that mint, never a
 * generic "?" and never a drawn stand-in that could be mistaken for the coin's actual artwork.
 */
export default function CoinAvatar({
  image,
  ticker,
  size = "sm",
  mint,
}: {
  image?: string | null;
  ticker: string;
  size?: "sm" | "lg";
  /** The coin's address, when known: used for the image-load retry, the initials fallback, and the fixed tile color. */
  mint?: string;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const backup = mint && isPumpCoin({ mint }) ? pumpImageUrl(mint) : null;
  const src = [image, backup].find((s): s is string => !!s && !failed.includes(s));

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img key={src} src={src} alt="" loading="lazy" onError={() => setFailed((f) => [...f, src])} className="h-full w-full object-cover" />
    );
  }

  const tone = toneFor(mint || ticker || "panda");
  return (
    <div
      className={`flex h-full w-full items-center justify-center font-display font-bold ${tone.bg} ${tone.text} ${size === "lg" ? "text-5xl" : "text-xs"}`}
    >
      {initialsFor(ticker, mint)}
    </div>
  );
}
