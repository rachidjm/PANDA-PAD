/** Decorative background for the "NFTs coming soon" banner — a fanned stack of blank card outlines, no numbers,
 *  no prices, nothing resembling a promise of value. Pure inline SVG, themed with the app's own colors. */
export default function NftTeaserArt() {
  return (
    <svg viewBox="0 0 800 280" preserveAspectRatio="xMidYMid slice" className="h-full w-full" aria-hidden>
      <defs>
        <linearGradient id="nft-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0e0d0c" />
          <stop offset="100%" stopColor="#16140f" />
        </linearGradient>
      </defs>
      <rect width="800" height="280" fill="url(#nft-bg)" />
      <g transform="translate(560,140)">
        <rect x="-70" y="-95" width="140" height="190" rx="16" transform="rotate(-10)" fill="#f7f4ec" opacity="0.04" />
        <rect x="-70" y="-95" width="140" height="190" rx="16" transform="rotate(6)" fill="#f7f4ec" opacity="0.05" />
        <rect x="-70" y="-95" width="140" height="190" rx="16" fill="#16140f" stroke="#c9d94c" strokeOpacity="0.5" strokeWidth="2" />
        <circle cx="0" cy="-30" r="3" fill="#c9d94c" />
        <circle cx="26" cy="46" r="2" fill="#ff6a1a" opacity="0.8" />
        <circle cx="-34" cy="60" r="2" fill="#f7f4ec" opacity="0.5" />
      </g>
      <circle cx="140" cy="60" r="150" fill="#c9d94c" opacity="0.06" />
    </svg>
  );
}
