"use client";

import { useState } from "react";

/**
 * A coin's real logo, or — when it has none (or the image fails to load) —
 * a neutral tile with its ticker's initials. Never a drawn stand-in that
 * could be mistaken for the coin's actual artwork.
 */
export default function CoinAvatar({
  image,
  ticker,
  size = "sm",
}: {
  image?: string | null;
  ticker: string;
  size?: "sm" | "lg";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (image && failedSrc !== image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={image} alt="" loading="lazy" onError={() => setFailedSrc(image)} className="h-full w-full object-cover" />
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
