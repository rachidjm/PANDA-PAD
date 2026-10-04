import Panda from "@/components/panda/Panda";

/** Decorative background for the Recruiters banner — reuses the real PANDA mascot rather than inventing new
 *  art, on a bamboo-tinted gradient with a simple growth/radiating motif. */
export default function RecruitersArt() {
  return (
    <div className="relative h-full w-full overflow-hidden">
      <svg viewBox="0 0 800 280" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <linearGradient id="rec-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#16140f" />
            <stop offset="100%" stopColor="#0e0d0c" />
          </linearGradient>
        </defs>
        <rect width="800" height="280" fill="url(#rec-bg)" />
        <circle cx="620" cy="140" r="210" fill="#c9d94c" opacity="0.1" />
        <circle cx="620" cy="140" r="130" fill="#c9d94c" opacity="0.08" />
        <circle cx="620" cy="140" r="60" fill="#c9d94c" opacity="0.1" />
      </svg>
      <div className="absolute right-10 top-1/2 -translate-y-1/2 sm:right-16">
        <Panda pose="success" size={120} />
      </div>
    </div>
  );
}
