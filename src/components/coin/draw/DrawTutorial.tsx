"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { moveStep, TUTORIAL_IMAGES, TUTORIAL_STEPS } from "@/lib/draw-tutorial";

/**
 * Draw Your Trade's four-step tutorial. On a desktop it is a card at the top of the panel — it pushes the panel down and
 * covers nothing. On a phone it is a sheet from the bottom, over a light backdrop, closed with "Saltar", the ✕, a tap
 * outside or Escape. Each step: a picture (a neutral placeholder until the real ones are delivered) and one or two
 * sentences.
 */

function usePhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

function Picture({ step }: { step: number }) {
  const src = TUTORIAL_IMAGES[step];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a small, fixed illustration from /public
    return <img src={src} alt="" width={320} height={320} className="h-32 w-32 shrink-0 rounded-2xl bg-black object-contain sm:h-28 sm:w-28" />;
  }
  return (
    <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-2xl border border-dashed border-paper/20 bg-paper/5 sm:h-24 sm:w-24" aria-hidden>
      <span className="font-display text-4xl font-bold text-paper/30">{step + 1}</span>
    </div>
  );
}

export default function DrawTutorial({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage();
  const phone = usePhone();
  const [step, setStep] = useState(0);
  const total = TUTORIAL_STEPS.length;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const go = (move: "next" | "back") => {
    const to = moveStep(step, move, total);
    if (to === "done") onClose();
    else setStep(to);
  };

  const body = (
    <div role="dialog" aria-modal={phone} aria-labelledby="draw-tutorial-title" className="text-paper">
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
      <div className="mt-2 flex flex-col items-center gap-4 text-center sm:flex-row sm:items-center sm:text-left">
        <Picture step={step} />
        <p className="text-sm leading-relaxed text-paper/90" aria-live="polite">
          {t(TUTORIAL_STEPS[step])}
        </p>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" onClick={onClose} className="min-h-11 text-xs font-semibold text-panda-grey underline underline-offset-2 hover:text-paper sm:min-h-0">
          {t("tutorial.skip")}
        </button>
        <div className="flex items-center gap-2">
          {step > 0 && (
            <button type="button" onClick={() => go("back")} className="min-h-11 rounded-full border border-paper/15 px-4 text-sm font-semibold text-paper/80 transition-colors hover:text-paper sm:min-h-9">
              {t("tutorial.back")}
            </button>
          )}
          <button type="button" onClick={() => go("next")} className="min-h-11 rounded-full bg-paper px-5 text-sm font-semibold text-ink transition hover:brightness-90 sm:min-h-9">
            {t(step === total - 1 ? "tutorial.done" : "tutorial.next")}
          </button>
        </div>
      </div>
    </div>
  );

  if (!phone) return <div className="mb-4 rounded-2xl border border-paper/15 bg-ink-raised p-4">{body}</div>;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end sm:hidden">
      <button type="button" aria-label={t("tutorial.skip")} onClick={onClose} className="absolute inset-0 bg-ink/60" />
      <div className="relative w-full rounded-t-3xl border-t border-paper/15 bg-ink-raised px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-4 shadow-2xl">{body}</div>
    </div>,
    document.body
  );
}
