"use client";

import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

/** Animates a number counting up (or down) from its previous value to `value` whenever it changes. */
export function useCountUp(value: number, duration = 1.2): number {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    // No animation when the user asked for reduced motion — the value is
    // used directly below instead of going through animated state.
    if (reduceMotion) {
      prevRef.current = value;
      return;
    }
    const from = prevRef.current;
    const controls = animate(from, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setDisplay(v),
    });
    prevRef.current = value;
    return () => controls.stop();
  }, [value, duration, reduceMotion]);

  return reduceMotion ? value : display;
}
