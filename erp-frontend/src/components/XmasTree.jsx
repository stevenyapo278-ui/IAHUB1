import { useId } from 'react';

/**
 * Sapin décoratif de la sidebar, en SVG inline.
 *
 * Un caractère emoji (🎄) est dessiné par la police du système (Apple Color Emoji,
 * Segoe UI Emoji, Noto Color Emoji…) : son dessin, ses couleurs et sa taille changent
 * donc d'une machine à l'autre. Ce composant fige l'apparence : même sapin, même
 * étoile et mêmes boules partout, quelle que soit la machine ou la version de l'OS.
 *
 * Les animations (halo, scintillement de l'étoile, boules) restent en CSS afin de
 * respecter `prefers-reduced-motion`.
 */
export default function XmasTree({ className = '' }) {
  // IDs de dégradés uniques : deux instances sur la même page ne se marchent pas dessus.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const greenTop = `xmas-green-top-${uid}`;
  const greenMid = `xmas-green-mid-${uid}`;
  const greenLow = `xmas-green-low-${uid}`;
  const trunk = `xmas-trunk-${uid}`;
  const star = `xmas-star-${uid}`;

  return (
    <svg
      className={`xmas-tree-svg ${className}`.trim()}
      viewBox="0 0 96 100"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={greenTop} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5cd47c" />
          <stop offset="100%" stopColor="#33a457" />
        </linearGradient>
        <linearGradient id={greenMid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4ec56d" />
          <stop offset="100%" stopColor="#2b8f4a" />
        </linearGradient>
        <linearGradient id={greenLow} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#43b962" />
          <stop offset="100%" stopColor="#237c3f" />
        </linearGradient>
        <linearGradient id={trunk} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a06a44" />
          <stop offset="100%" stopColor="#6f4326" />
        </linearGradient>
        <radialGradient id={star} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#fff3b0" />
          <stop offset="55%" stopColor="#ffd166" />
          <stop offset="100%" stopColor="#f0a91f" />
        </radialGradient>
      </defs>

      {/* Tronc (sous les étages) */}
      <rect x="43" y="82" width="10" height="16" rx="3" fill={`url(#${trunk})`} />

      {/* Trois étages, du bas vers le haut. Le contour épais arrondi adoucit les pointes. */}
      <polygon
        points="48,46 20,86 76,86"
        fill={`url(#${greenLow})`}
        stroke={`url(#${greenLow})`}
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <polygon
        points="48,32 26,66 70,66"
        fill={`url(#${greenMid})`}
        stroke={`url(#${greenMid})`}
        strokeWidth="10"
        strokeLinejoin="round"
      />
      <polygon
        points="48,18 32,44 64,44"
        fill={`url(#${greenTop})`}
        stroke={`url(#${greenTop})`}
        strokeWidth="10"
        strokeLinejoin="round"
      />

      {/* Boules (avec un reflet pour donner du volume) */}
      <g>
        <circle cx="43" cy="37" r="3" fill="#ffd43b" />
        <circle cx="42.2" cy="36.2" r="1" fill="#fff8dc" opacity="0.7" />

        <circle cx="52" cy="33" r="2.8" fill="#e74c3c" />
        <circle cx="51.2" cy="32.2" r="0.9" fill="#fff" opacity="0.6" />

        <circle cx="37" cy="59" r="3.2" fill="#e055a8" />
        <circle cx="36.1" cy="58.1" r="1" fill="#fff" opacity="0.6" />

        <circle cx="49" cy="52" r="3" fill="#ffd43b" />
        <circle cx="48.2" cy="51.2" r="1" fill="#fff8dc" opacity="0.7" />

        <circle cx="60" cy="58" r="3" fill="#e74c3c" />
        <circle cx="59.2" cy="57.2" r="1" fill="#fff" opacity="0.6" />

        <circle cx="31" cy="79" r="3.4" fill="#4dc3e8" />
        <circle cx="30" cy="78" r="1.1" fill="#fff" opacity="0.6" />

        <circle cx="43" cy="72" r="3.2" fill="#ffd43b" />
        <circle cx="42.1" cy="71.1" r="1" fill="#fff8dc" opacity="0.7" />

        <circle cx="55" cy="79" r="3.4" fill="#e74c3c" />
        <circle cx="54.1" cy="78.1" r="1.1" fill="#fff" opacity="0.6" />

        <circle cx="66" cy="72" r="3" fill="#e055a8" />
        <circle cx="65.1" cy="71.1" r="1" fill="#fff" opacity="0.6" />
      </g>

      {/* Étoile */}
      <path
        className="xmas-tree-star"
        d="M48 3 L50.2 8.9 L56.6 9.2 L51.6 13.2 L53.3 19.3 L48 15.8 L42.7 19.3 L44.4 13.2 L39.4 9.2 L45.8 8.9 Z"
        fill={`url(#${star})`}
        stroke="#e8a51c"
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}
