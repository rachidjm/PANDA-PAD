"use client";

import { useState } from "react";
import { isPumpCoin, pumpImageUrl } from "@/lib/coin-image";

/**
 * A coin's real logo, or — when it has none (or the image fails to load) —
 * a neutral tile with its ticker's initials. Never a drawn stand-in that
 * could be mistaken for the coin's actual artwork.
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
  /** The coin's address, when known: a picture that fails to load is retried once from Pump.fun's image CDN. */
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

  const initials = ticker.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <div
      className={`flex h-full w-full items-center justify-center bg-paper/10 font-display font-bold text-paper/50 ${
        size === "lg" ? "text-5xl" : "text-xs"
      }`}
    >
      {initials}
    </div>
  );
}
