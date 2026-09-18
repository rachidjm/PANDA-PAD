import { DoodleKind } from "@/lib/types";

const LINE = "#171512";

export default function Doodle({ kind, className = "" }: { kind: DoodleKind; className?: string }) {
  return (
    <svg viewBox="0 0 200 200" className={`doodle doodle-${kind} ${className}`} aria-hidden>
      <g stroke={LINE} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        <DoodleShape kind={kind} />
      </g>
    </svg>
  );
}

function DoodleShape({ kind }: { kind: DoodleKind }) {
  switch (kind) {
    case "cat":
      return (
        <g className="doodle-dance">
          <circle cx="100" cy="112" r="46" fill="#fff" />
          <path d="M64 78 L52 44 L86 66 Z" fill="#fff" />
          <path d="M136 78 L148 44 L114 66 Z" fill="#fff" />
          <circle cx="82" cy="106" r="6" fill={LINE} stroke="none" />
          <circle cx="118" cy="106" r="6" fill={LINE} stroke="none" />
          <path d="M86 128 Q100 138 114 128" fill="none" />
          <path d="M60 112 L36 106 M60 122 L36 126" />
          <path d="M140 112 L164 106 M140 122 L164 126" />
        </g>
      );
    case "frog":
      return (
        <g className="doodle-bop">
          <ellipse cx="100" cy="126" rx="52" ry="40" fill="#fff" />
          <circle cx="72" cy="86" r="18" fill="#fff" />
          <circle cx="128" cy="86" r="18" fill="#fff" />
          <circle cx="72" cy="86" r="7" fill={LINE} stroke="none" />
          <circle cx="128" cy="86" r="7" fill={LINE} stroke="none" />
          <path d="M74 138 Q100 156 126 138" fill="none" />
        </g>
      );
    case "donut":
      return (
        <g className="doodle-spin">
          <circle cx="100" cy="100" r="54" fill="#fff" />
          <circle cx="100" cy="100" r="20" fill="none" />
          <circle cx="80" cy="72" r="3" fill={LINE} stroke="none" />
          <circle cx="120" cy="76" r="3" fill={LINE} stroke="none" />
          <circle cx="66" cy="104" r="3" fill={LINE} stroke="none" />
          <circle cx="134" cy="108" r="3" fill={LINE} stroke="none" />
          <circle cx="94" cy="132" r="3" fill={LINE} stroke="none" />
          <circle cx="122" cy="136" r="3" fill={LINE} stroke="none" />
        </g>
      );
    case "ghost":
      return (
        <g className="doodle-float">
          <path d="M62 140 V96 a38 38 0 0 1 76 0 v44 l-12 -10 -12 10 -12 -10 -12 10 -12 -10 -16 10z" fill="#fff" />
          <circle cx="84" cy="100" r="6" fill={LINE} stroke="none" />
          <circle cx="116" cy="100" r="6" fill={LINE} stroke="none" />
        </g>
      );
    case "egg":
      return (
        <g className="doodle-wobble">
          <path d="M100 50 C130 50 146 100 146 130 A46 40 0 0 1 54 130 C54 100 70 50 100 50 Z" fill="#fff" />
          <path d="M84 96 L100 108 L88 122" fill="none" />
          <circle cx="80" cy="132" r="5" fill={LINE} stroke="none" />
          <circle cx="112" cy="140" r="5" fill={LINE} stroke="none" />
        </g>
      );
    case "cloud":
      return (
        <g className="doodle-drift">
          <path d="M58 128 a26 26 0 0 1 6 -51 a34 34 0 0 1 64 -8 a28 28 0 0 1 -6 55 Z" fill="#fff" />
          <circle cx="86" cy="112" r="5" fill={LINE} stroke="none" />
          <circle cx="116" cy="112" r="5" fill={LINE} stroke="none" />
          <path d="M90 126 Q101 132 112 126" fill="none" />
        </g>
      );
    case "fish":
      return (
        <g className="doodle-swim">
          <ellipse cx="94" cy="104" rx="46" ry="30" fill="#fff" />
          <path d="M140 104 L168 84 L168 124 Z" fill="#fff" />
          <circle cx="76" cy="98" r="5" fill={LINE} stroke="none" />
          <path d="M70 122 Q94 132 112 120" fill="none" />
        </g>
      );
    case "worm":
    default:
      return (
        <g className="doodle-wiggle">
          <path d="M40 130 Q60 90 90 130 T140 110 T170 90" fill="none" strokeWidth="18" />
          <circle cx="46" cy="126" r="4" fill="#fff" stroke="none" />
        </g>
      );
  }
}
