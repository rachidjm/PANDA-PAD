"use client";

import { MotionConfig } from "framer-motion";

/** Makes every framer-motion animation in the app respect the OS's
 * prefers-reduced-motion setting, the same way the existing hand-written
 * Panda/Doodle CSS keyframes already do via globals.css. */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
