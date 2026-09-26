"use client";

import Image from "next/image";

export type PandaPose = "idle" | "create" | "tradeUp" | "tradeDown" | "loading" | "empty" | "success" | "error";

/**
 * The mascot IS the PANDA logo: the panda's face (/logo.png, pure-black background blended away with `lighten`, like <Logo />). What it
 * is "doing" is told by a small badge in the corner and a short motion (see globals.css `.panda-pose-*`), not by a different drawing.
 */
const BADGE: Partial<Record<PandaPose, { bg: string; icon: React.ReactNode }>> = {
  success: { bg: "bg-bamboo text-ink", icon: <path d="m5 12.5 4.5 4.5L19 7" /> },
  tradeUp: { bg: "bg-bamboo text-ink", icon: <path d="M12 19V6M6 11.5 12 5.5l6 6" /> },
  tradeDown: { bg: "bg-clay-red text-ink", icon: <path d="M12 5v13M6 12.5l6 6 6-6" /> },
  error: { bg: "bg-clay-red text-ink", icon: <path d="M12 6v8M12 18.2v.1" /> },
  create: { bg: "bg-meme-orange text-ink", icon: <path d="M12 5v14M5 12h14" /> },
  loading: { bg: "bg-paper text-ink", icon: <path d="M12 4a8 8 0 1 0 8 8" className="origin-center animate-spin" /> },
};

export default function Panda({ pose = "idle", size = 220, className = "" }: { pose?: PandaPose; size?: number; className?: string }) {
  const badge = BADGE[pose];
  const badgeSize = Math.max(18, Math.round(size * 0.26));
  return (
    <span
      role="img"
      aria-label="PANDA"
      className={`panda-figure panda-pose-${pose} relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image src="/logo.png" alt="" width={size} height={size} className="h-full w-full mix-blend-lighten" priority={size >= 150} />
      {badge && (
        <span className={`absolute bottom-0 right-0 flex items-center justify-center rounded-full shadow-[0_2px_10px_rgba(0,0,0,0.5)] ${badge.bg}`} style={{ width: badgeSize, height: badgeSize }} aria-hidden>
          <svg viewBox="0 0 24 24" width={badgeSize * 0.62} height={badgeSize * 0.62} fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
            {badge.icon}
          </svg>
        </span>
      )}
    </span>
  );
}
