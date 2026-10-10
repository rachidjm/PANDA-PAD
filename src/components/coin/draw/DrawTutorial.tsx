"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { cardPlacement, demoView, moveStep, TUTORIAL_IMAGES, TUTORIAL_STEPS, TUTORIAL_TARGETS, type Box, type DemoView } from "@/lib/draw-tutorial";
import { PCT_ROW } from "@/lib/strategy/allocation";

/**
 * Draw Your Trade's guided tutorial. The page dims and only the part each step talks about stays lit; a little hand
 * shows the gesture; the card with the panda and the text sits beside the lit zone (on a phone, at the bottom).
 *
 * EVERYTHING it shows is a demo. The tabs, the % row, the line card and the sign button it points at are a picture of
 * the panel drawn by this file (TutorialDemoPanel) from the step alone — not the real controls, which stay mounted and
 * hidden underneath, untouched. Nothing here reads the wallet, creates an order or asks the server for anything; closing
 * it leaves the panel exactly as it was. The one thing that reaches the real panel is "Pruébalo tú" (`onTry`), which the
 * user presses on purpose.
 */

const SLOT_ID = "draw-tutorial-demo";
const PAD = 6;
const CARD_W = 340;

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

const boxOf = (el: Element | null): Box | null => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null;
};
const same = (a: Box | null, b: Box | null) => (!a || !b ? a === b : Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5);

/** Where the hand taps in each step: the "Venta" tab, the "25%" button, a point on the chart a little above the price. */
function hitPoint(step: number, target: Box | null): { x: number; y: number } | null {
  if (!target) return null;
  if (step === 2) return { x: target.left + target.width * 0.62, y: target.top + target.height * 0.3 };
  const hit = boxOf(document.querySelector(`[data-tutorial-hit="${step === 0 ? "sell" : "pct25"}"]`));
  return hit ? { x: hit.left + hit.width / 2, y: hit.top + hit.height / 2 } : null;
}

function Picture({ step }: { step: number }) {
  const src = TUTORIAL_IMAGES[step];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a small, fixed illustration from /public
    return <img src={src} alt="" width={320} height={320} className="h-24 w-24 shrink-0 rounded-2xl bg-black object-contain sm:h-20 sm:w-20" />;
  }
  return (
    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl border border-dashed border-paper/20 bg-paper/5 sm:h-20 sm:w-20" aria-hidden>
      <span className="font-display text-3xl font-bold text-paper/30">{step + 1}</span>
    </div>
  );
}

/** A picture of the panel's controls in the state the demo has reached. Inert: no button here does anything. */
function TutorialDemoPanel({ view }: { view: DemoView }) {
  const { t } = useLanguage();
  const tab = (on: boolean, color: string) => (on ? { background: color, color: "var(--ink)" } : { color: "color-mix(in srgb, var(--paper) 75%, transparent)" });
  return (
    <div className="mt-3" aria-hidden inert>
      <p className="mb-2 flex items-center gap-2 text-[11px] text-panda-grey">
        <span className="rounded-full bg-paper/10 px-2 py-0.5 font-semibold uppercase tracking-wide text-paper/80">{t("tutorial.demo")}</span>
        {t("tutorial.demoNote")}
      </p>
      <div data-tutorial="tabs" className="inline-flex gap-0.5 rounded-full bg-ink p-0.5">
        <span className="rounded-full px-3.5 py-1.5 text-xs font-semibold opacity-40" style={tab(false, "")}>
          {t("draw.line.buy")}
        </span>
        <span data-tutorial-hit="sell" className="rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors" style={tab(view.sell, "var(--bamboo)")}>
          {t("draw.line.sell")}
        </span>
        <span className="rounded-full px-3.5 py-1.5 text-xs font-semibold" style={tab(false, "")}>
          {t("draw.line.stop")}
        </span>
      </div>
      <div data-tutorial="pct" className="mt-3 flex gap-1">
        {PCT_ROW.map((p) => (
          <span
            key={p}
            {...(p === 25 ? { "data-tutorial-hit": "pct25" } : {})}
            className={`flex min-h-9 min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-lg text-[11px] font-semibold tracking-tight tabular-nums transition-colors sm:text-xs ${
              p === 25 && view.pct25 ? "bg-bamboo text-ink shadow-[inset_0_-2px_0_rgba(0,0,0,0.25)]" : "bg-paper/5 text-paper/80"
            }`}
          >
            {p}%
          </span>
        ))}
      </div>
      <div className={`mt-3 flex items-stretch overflow-hidden rounded-xl border border-paper/10 bg-ink-raised transition-opacity duration-300 ${view.line ? "opacity-100" : "opacity-0"}`}>
        <span className="w-1 shrink-0 bg-bamboo" />
        <div className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-3 pr-3">
          <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-bamboo">
            <span className="text-sm leading-none">↑</span>
            {t("draw.line.sell")}
          </span>
          <span className="rounded-full bg-bamboo/15 px-2 py-0.5 text-[11px] font-semibold text-bamboo">25%</span>
          <span className="ml-auto text-xs tabular-nums text-paper/70">+12%</span>
        </div>
      </div>
      <div data-tutorial="sign" className={`mt-3 w-full rounded-xl bg-paper py-3 text-center text-sm font-bold text-ink transition-opacity duration-300 ${view.line ? "opacity-100" : "opacity-40"} ${view.pulse ? "tutorial-pulse" : ""}`}>
        {t("draw.sign1")}
      </div>
    </div>
  );
}

function Hand({ at, pressed }: { at: { x: number; y: number }; pressed: boolean }) {
  return (
    <div className="pointer-events-none fixed z-[62] transition-[left,top] duration-700 ease-in-out" style={{ left: at.x - 9, top: at.y - 3 }} aria-hidden>
      <span className={`absolute -left-3 -top-3 h-10 w-10 rounded-full border-2 border-paper/70 transition-all duration-300 ${pressed ? "scale-100 opacity-70" : "scale-50 opacity-0"}`} />
      <svg viewBox="0 0 32 32" width="34" height="34" className={`drop-shadow-[0_2px_6px_rgba(0,0,0,0.7)] transition-transform duration-200 ${pressed ? "scale-90" : "scale-100"}`}>
        <path d="M11 3.5a2.5 2.5 0 0 1 2.5 2.5v8.2l1.2-.2V11a2.3 2.3 0 0 1 4.6 0v2.5l.9-.1a2.2 2.2 0 0 1 4.2.8v1.2a2.1 2.1 0 0 1 3.1 1.9V22c0 4.7-3.300 7.500-7.800 7.500h-2.400c-3 0-4.900-1.200-6.600-3.700L6.300 19.400a2.300 2.300 0 0 1 3.700-2.700l-1.500-2.300V6A2.500 2.500 0 0 1 11 3.500Z" fill="#f7f4ec" stroke="#0e0d0c" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export default function DrawTutorial({ onClose, onTry }: { onClose: () => void; onTry: () => void }) {
  const { t } = useLanguage();
  const phone = useMedia("(max-width: 639px)");
  const still = useMedia("(prefers-reduced-motion: reduce)");
  const [step, setStep] = useState(0);
  const total = TUTORIAL_STEPS.length;
  /** The step's gesture, looping: 0 = the hand waits aside, 1 = it travels to the spot, 2 = it has tapped (the demo shows the result). */
  const [beat, setBeat] = useState(0);
  const [target, setTarget] = useState<Box | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardHeight, setCardHeight] = useState(230);

  const tapped = still || beat === 2;
  const view = demoView(step, tapped);

  useEffect(() => {
    const find = () => setSlot(document.getElementById(SLOT_ID));
    find();
    const id = requestAnimationFrame(find);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // The gesture loop. With "reduce motion" there is no loop: each step simply shows its result.
  useEffect(() => {
    if (still) return;
    let alive = true;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const run = () => {
      if (!alive) return;
      setBeat(0);
      timers.push(setTimeout(() => alive && setBeat(1), 500));
      timers.push(setTimeout(() => alive && setBeat(2), 1350));
      timers.push(setTimeout(run, 3400));
    };
    run();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [step, still]);

  // The lit zone follows its element (the page scrolls, the demo's rows appear): read on every frame while open, and
  // also on scroll / resize and on a slow timer, so it is right even where frames aren't being drawn.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      const next = boxOf(document.querySelector(`[data-tutorial="${TUTORIAL_TARGETS[step]}"]`));
      setTarget((prev) => (same(prev, next) ? prev : next));
    };
    const loop = () => {
      measure();
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    const first = setTimeout(measure, 0);
    const slow = setInterval(measure, 250);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(first);
      clearInterval(slow);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [step, slot]);

  // The page scrolls by itself so the zone is in view: centred on a desktop, near the top on a phone (the card is at the bottom).
  useEffect(() => {
    const id = setTimeout(() => {
      const el = document.querySelector(`[data-tutorial="${TUTORIAL_TARGETS[step]}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 64;
      const wanted = phone ? header + 16 : Math.max(header + 16, (window.innerHeight - r.height) / 2);
      window.scrollBy({ top: r.top - wanted, behavior: still ? "auto" : "smooth" });
    }, 60);
    return () => clearTimeout(id);
  }, [step, phone, still, slot]);

  useLayoutEffect(() => {
    if (cardRef.current) setCardHeight(cardRef.current.offsetHeight);
  }, [step, phone]);

  const go = (move: "next" | "back") => {
    const to = moveStep(step, move, total);
    if (to === "done") onClose();
    else setStep(to);
  };

  const lit = target && { top: target.top - PAD, left: target.left - PAD, width: target.width + PAD * 2, height: target.height + PAD * 2 };
  const point = hitPoint(step, target);
  const hand = !still && step < 3 && point ? (beat === 0 ? { x: point.x + 46, y: point.y + 58 } : point) : null;
  const small = "min-h-9 whitespace-nowrap rounded-full px-3.5 text-xs font-semibold transition sm:min-h-8";

  const card = (
    <div ref={cardRef} role="dialog" aria-modal="true" aria-labelledby="draw-tutorial-title" className="text-paper">
      <div className="flex items-center justify-between gap-3">
        <p id="draw-tutorial-title" className="text-xs font-semibold uppercase tracking-wide text-panda-grey">
          {t("tutorial.title")} · {step + 1}/{total}
        </p>
        <button type="button" onClick={onClose} aria-label={t("tutorial.skip")} className="flex h-9 w-9 items-center justify-center rounded-full text-panda-grey transition-colors hover:bg-paper/10 hover:text-paper">
          <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
      <div className="mt-1 flex items-center gap-3.5">
        <Picture step={step} />
        <p className="text-sm leading-relaxed text-paper/90" aria-live="polite">
          {t(TUTORIAL_STEPS[step])}
        </p>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        {/* On the last step "Entendido" is the way out, so "Saltar" would only crowd the row. */}
        <button type="button" onClick={onClose} className={`min-h-9 text-xs font-semibold text-panda-grey underline underline-offset-2 hover:text-paper sm:min-h-8 ${step === total - 1 ? "invisible" : ""}`} tabIndex={step === total - 1 ? -1 : 0}>
          {t("tutorial.skip")}
        </button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go("back")} className={`${small} border border-paper/15 text-paper/80 hover:text-paper`}>
              {t("tutorial.back")}
            </button>
          )}
          {step === total - 1 ? (
            <>
              <button type="button" onClick={onClose} className={`${small} border border-paper/15 text-paper/80 hover:text-paper`}>
                {t("tutorial.done")}
              </button>
              <button type="button" onClick={onTry} className={`${small} bg-bamboo text-ink hover:brightness-95`}>
                {t("tutorial.try")}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => go("next")} className={`${small} bg-paper text-ink hover:brightness-90`}>
              {t("tutorial.next")}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const place = !phone && lit ? cardPlacement(lit, { width: CARD_W, height: cardHeight }, { width: window.innerWidth, height: window.innerHeight }) : null;

  return (
    <>
      {slot && createPortal(<TutorialDemoPanel view={view} />, slot)}
      {createPortal(
        <div className="fixed inset-0 z-[60]">
          {/* Nothing under the tutorial can be touched while it is open. */}
          <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
          {lit ? (
            <div
              className={`pointer-events-none fixed rounded-2xl ring-2 ring-paper/50 ${still ? "" : "transition-[top,left,width,height] duration-300 ease-out"}`}
              style={{ ...lit, boxShadow: "0 0 0 200vmax rgba(8, 7, 6, 0.72)" }}
              aria-hidden
            />
          ) : (
            <div className="pointer-events-none absolute inset-0 bg-[rgba(8,7,6,0.72)]" aria-hidden />
          )}
          {/* Step 3's example: a sell line on the chart, with its tag. Drawn here, over the chart — the chart itself has no such line. */}
          {step === 2 && target && (
            <div className={`pointer-events-none fixed transition-opacity duration-300 ${view.line ? "opacity-100" : "opacity-0"}`} style={{ left: target.left, width: target.width, top: target.top + target.height * 0.3 }} aria-hidden>
              <div className="border-t-2 border-dashed border-bamboo" />
              <span className="absolute left-1 top-0 -translate-y-1/2 whitespace-nowrap rounded-md bg-bamboo px-1.5 py-0.5 text-[11px] font-bold text-ink">{t("draw.line.sell")} · 25%</span>
              <div className="absolute right-2 top-3 flex items-stretch overflow-hidden rounded-xl border border-paper/15 bg-ink-raised shadow-lg">
                <span className="w-1 shrink-0 bg-bamboo" />
                <span className="flex items-center gap-2 px-2.5 py-1.5 text-xs font-semibold text-bamboo">
                  <span className="text-sm leading-none">↑</span>
                  {t("draw.line.sell")}
                  <span className="rounded-full bg-bamboo/15 px-2 py-0.5 text-[11px]">25%</span>
                </span>
              </div>
            </div>
          )}
          {hand && <Hand at={hand} pressed={beat === 2} />}
          {phone ? (
            <div className="absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-paper/15 bg-ink-raised px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-2xl">{card}</div>
          ) : (
            <div
              className={`fixed rounded-2xl border border-paper/15 bg-ink-raised p-4 shadow-2xl ${still ? "" : "transition-[top,left] duration-300 ease-out"}`}
              style={{ width: CARD_W, ...(place ?? { top: window.innerHeight - cardHeight - 16, left: window.innerWidth - CARD_W - 16 }) }}
            >
              {card}
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}

export { SLOT_ID as TUTORIAL_SLOT_ID };
