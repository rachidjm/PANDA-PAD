/** PANDA's own "AI" marker — a plain four-point sparkle, filled with the current text color. Used wherever
 *  the AI Assistant is pointed to (the nav button, the mobile tab, the floating button) instead of an emoji. */
export default function SparkleIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2z" />
    </svg>
  );
}
