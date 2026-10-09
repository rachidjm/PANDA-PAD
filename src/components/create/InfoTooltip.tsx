"use client";

import { useEffect, useRef, useState } from "react";

/** A small info icon that reveals `text` on hover (desktop) or tap (mobile, closing on a tap outside). `align="end"`
 *  opens it leftwards from the icon — for an icon near the right edge, so it never runs off a phone's screen. */
export default function InfoTooltip({ text, align = "center" }: { text: string; align?: "center" | "end" | "start" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const viaMouse = useRef(false);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);
  const pos = align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2";
  return (
    <span
      ref={ref}
      className="relative inline-flex shrink-0 cursor-pointer text-panda-grey transition-colors hover:text-paper"
      // Hover only for a real mouse: on a phone the tap's emulated hover would open it and the tap itself close it.
      onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
      onPointerDown={(e) => {
        viaMouse.current = e.pointerType === "mouse";
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // A mouse already opened it by hovering: its click keeps it open. A tap toggles it.
        setOpen((o) => (viaMouse.current ? true : !o));
      }}
      aria-label={text}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setOpen((o) => !o);
        }
      }}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-5" />
        <path d="M12 8h.01" />
      </svg>
      {open && (
        <span role="tooltip" className={`absolute bottom-full z-20 mb-1.5 w-max max-w-[240px] rounded-lg border border-paper/10 bg-ink px-2.5 py-1.5 text-[11px] font-normal leading-snug text-paper shadow-lg ${pos}`}>
          {text}
        </span>
      )}
    </span>
  );
}
