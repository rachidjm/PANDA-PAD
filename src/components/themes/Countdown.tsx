"use client";

import { useEffect, useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");

/** A live d/h/m/s countdown to `target` (ms). Shows 00:00:00 once it has passed. */
export default function Countdown({ target, className = "" }: { target: number; className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const total = Math.max(0, Math.floor((target - now) / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return (
    <span className={`font-mono tabular-nums ${className}`} suppressHydrationWarning>
      {d > 0 ? `${d}d ` : ""}
      {pad(h)}:{pad(m)}:{pad(s)}
    </span>
  );
}
