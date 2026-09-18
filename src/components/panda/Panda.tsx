"use client";

import { useEffect, useRef, useState } from "react";

export type PandaPose =
  | "idle"
  | "create"
  | "tradeUp"
  | "tradeDown"
  | "loading"
  | "empty"
  | "success"
  | "error";

type PandaComponentProps = {
  pose?: PandaPose;
  size?: number;
  /** Eyes track the cursor and blink on a timer. Use only for one hero-scale instance per view. */
  interactive?: boolean;
  /** Compact head-only crop with no desk/prop layer, for the navbar and other small marks. */
  mark?: boolean;
  className?: string;
};

/**
 * Shared ink-wobble filter, mounted once and referenced by every Panda
 * instance so the linework reads as hand-inked rather than vector-perfect.
 */
export function PandaDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
      <filter id="ink-wobble" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.012 0.018" numOctaves={2} seed={7} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.2} xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

const INK = "var(--ink-line, #F7F4EC)";

export default function Panda({ pose = "idle", size = 220, interactive = false, mark = false, className = "" }: PandaComponentProps) {
  const rootRef = useRef<SVGSVGElement>(null);
  const pupilGroupRef = useRef<SVGGElement>(null);
  const [blink, setBlink] = useState(false);

  // Eyes ease toward the cursor with a lerp loop (smooth, not a 1:1 snap), and
  // fall back to a slow idle drift on touch devices where there is no cursor.
  useEffect(() => {
    if (!interactive) return;

    const hasCursor = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let raf = 0;
    let target = { x: 0, y: 0 };
    let current = { x: 0, y: 0 };

    function apply() {
      pupilGroupRef.current?.style.setProperty("transform", `translate(${current.x}px, ${current.y}px)`);
    }

    function tick() {
      current.x += (target.x - current.x) * 0.14;
      current.y += (target.y - current.y) * 0.14;
      apply();
      raf = requestAnimationFrame(tick);
    }

    if (hasCursor) {
      function onMove(e: MouseEvent) {
        const el = rootRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height * 0.4;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const max = 3.2;
        target = { x: (dx / dist) * Math.min(max, dist / 40), y: (dy / dist) * Math.min(max, dist / 40) };
      }
      window.addEventListener("mousemove", onMove);
      raf = requestAnimationFrame(tick);
      return () => {
        window.removeEventListener("mousemove", onMove);
        cancelAnimationFrame(raf);
      };
    }

    // No cursor: gentle idle look-around loop.
    let t = 0;
    function idleTick() {
      t += 0.012;
      target = { x: Math.sin(t) * 2.6, y: Math.cos(t * 0.7) * 1.4 };
      current = target;
      apply();
      raf = requestAnimationFrame(idleTick);
    }
    raf = requestAnimationFrame(idleTick);
    return () => cancelAnimationFrame(raf);
  }, [interactive]);

  useEffect(() => {
    if (!interactive) return;
    let timeout: ReturnType<typeof setTimeout>;
    function scheduleBlink() {
      timeout = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        scheduleBlink();
      }, 2600 + Math.random() * 2800);
    }
    scheduleBlink();
    return () => clearTimeout(timeout);
  }, [interactive]);

  return (
    <svg
      ref={rootRef}
      viewBox={mark ? "34 24 172 150" : "0 0 240 240"}
      width={size}
      height={size}
      className={`panda-figure panda-pose-${pose} ${className}`}
      role="img"
      aria-label="PANDA"
    >
      <g filter="url(#ink-wobble)">
        {!mark && <PandaSceneProps pose={pose} />}

        <g className="panda-ears">
          <circle className="panda-ear panda-ear-l" cx="72" cy="54" r="26" fill="#171512" stroke={INK} strokeWidth="5" />
          <circle className="panda-ear panda-ear-r" cx="168" cy="54" r="26" fill="#171512" stroke={INK} strokeWidth="5" />
        </g>

        <path
          d="M120 40
             C 168 38, 198 72, 196 112
             C 194 156, 164 190, 120 190
             C 76 190, 46 156, 44 112
             C 42 72, 72 38, 120 40 Z"
          fill="#1C1A17"
          stroke={INK}
          strokeWidth="5"
          strokeLinejoin="round"
        />

        <ellipse cx="86" cy="108" rx="26" ry="32" fill="#0E0D0C" transform="rotate(-8 86 108)" />
        <ellipse cx="154" cy="108" rx="26" ry="32" fill="#0E0D0C" transform="rotate(8 154 108)" />

        <g className={blink ? "panda-eye blinking" : "panda-eye"}>
          <ellipse cx="86" cy="110" rx="13" ry="14" fill={INK} />
        </g>
        <g className={blink ? "panda-eye blinking" : "panda-eye"}>
          <ellipse cx="154" cy="110" rx="13" ry="14" fill={INK} />
        </g>

        <g className={blink ? "panda-eye blinking" : "panda-eye"}>
          <g ref={pupilGroupRef}>
            <circle cx="86" cy="110" r="6" fill="#1C1A17" />
            <circle cx="154" cy="110" r="6" fill="#1C1A17" />
          </g>
        </g>

        {!mark && <PandaFace pose={pose} />}
        {mark && (
          <path d="M106 156 Q120 166 134 156" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />
        )}
      </g>
    </svg>
  );
}

function PandaFace({ pose }: { pose: PandaPose }) {
  if (pose === "tradeUp" || pose === "success") {
    return (
      <>
        <ellipse cx="120" cy="140" rx="7" ry="5" fill={INK} />
        <path d="M100 155 Q120 172 140 155" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />
      </>
    );
  }
  if (pose === "tradeDown" || pose === "error") {
    return (
      <>
        <ellipse cx="120" cy="140" rx="7" ry="5" fill={INK} />
        <path d="M102 162 Q120 150 138 162" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      <ellipse cx="120" cy="140" rx="7" ry="5" fill={INK} />
      <path d="M106 156 Q120 166 134 156" stroke={INK} strokeWidth="5" fill="none" strokeLinecap="round" />
    </>
  );
}

function PandaSceneProps({ pose }: { pose: PandaPose }) {
  switch (pose) {
    case "create":
      return (
        <g className="panda-prop panda-prop-create">
          <rect x="150" y="168" width="46" height="34" rx="6" fill="none" stroke={INK} strokeWidth="4" />
          <circle cx="173" cy="185" r="10" fill="none" stroke="var(--meme-orange, #FF6A1A)" strokeWidth="4" className="panda-coin-spin" />
          <line x1="120" y1="176" x2="150" y2="188" stroke={INK} strokeWidth="4" strokeLinecap="round" className="panda-pencil" />
        </g>
      );
    case "tradeUp":
      return (
        <g className="panda-prop panda-prop-chart">
          <path d="M40 210 L70 180 L95 196 L130 150 L160 168 L200 116" stroke="var(--bamboo, #C9D94C)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M186 116 L200 116 L200 130" stroke="var(--bamboo, #C9D94C)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "tradeDown":
      return (
        <g className="panda-prop panda-prop-chart">
          <path d="M40 140 L70 158 L95 148 L130 178 L160 168 L200 206" stroke="var(--clay-red, #E8543E)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M186 206 L200 206 L200 192" stroke="var(--clay-red, #E8543E)" strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      );
    case "loading":
      return (
        <g className="panda-prop panda-prop-loading">
          <circle cx="196" cy="170" r="14" fill="none" stroke="var(--meme-orange, #FF6A1A)" strokeWidth="5" className="panda-coin-bounce" />
          <path d="M20 200 L50 200 M14 212 L44 212" stroke={INK} strokeWidth="4" strokeLinecap="round" opacity="0.5" className="panda-motion-lines" />
        </g>
      );
    case "empty":
      return (
        <g className="panda-prop">
          <path d="M90 214 Q120 200 150 214" stroke={INK} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.6" />
        </g>
      );
    case "success":
      return (
        <g className="panda-prop panda-prop-success">
          <circle cx="120" cy="30" r="16" fill="none" stroke="var(--meme-orange, #FF6A1A)" strokeWidth="5" />
          <text x="120" y="36" textAnchor="middle" fontSize="14" fill="var(--meme-orange, #FF6A1A)" fontFamily="var(--font-display)">$</text>
        </g>
      );
    case "error":
      return (
        <g className="panda-prop">
          <text x="176" y="60" textAnchor="middle" fontSize="34" fill="var(--clay-red, #E8543E)" fontFamily="var(--font-display)">?</text>
        </g>
      );
    default:
      return (
        <g className="panda-prop">
          <rect x="70" y="196" width="100" height="8" rx="4" fill={INK} opacity="0.5" />
          <path d="M92 196 L92 172 L148 172 L148 196" stroke={INK} strokeWidth="4" fill="none" strokeLinejoin="round" opacity="0.7" />
        </g>
      );
  }
}
