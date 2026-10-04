/** Decorative background for the X-community banner — a placeholder until replaced with PANDA's real X
 *  profile/banner image (see docs note in banners-config.tsx). Pure inline SVG: no network request, scales
 *  losslessly, themed with the same CSS variables as the rest of the app. */
export default function XCommunityArt() {
  return (
    <svg viewBox="0 0 800 280" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="x-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#16140f" />
          <stop offset="100%" stopColor="#0e0d0c" />
        </linearGradient>
      </defs>
      <rect width="800" height="280" fill="url(#x-bg)" />
      <circle cx="660" cy="60" r="180" fill="#c9d94c" opacity="0.08" />
      <circle cx="120" cy="240" r="120" fill="#ff6a1a" opacity="0.06" />
      <g opacity="0.9" transform="translate(560,40)">
        <path
          d="M30 0 L96 0 L160 82 L224 0 L256 0 L176 104 L260 210 L194 210 L128 124 L62 210 L28 210 L112 102 Z"
          fill="#f7f4ec"
          opacity="0.14"
        />
      </g>
    </svg>
  );
}
