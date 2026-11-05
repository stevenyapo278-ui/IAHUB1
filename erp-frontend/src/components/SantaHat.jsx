/**
 * ─── Bonnet de Père Noël ─────────────────────────────────────────────────────
 *
 * Décalque SVG posé sur le logo de la sidebar (reprend NOEL/noel/SantaHat.jsx).
 * Le parent doit être en `position: relative` et ne pas rogner l'élément.
 */
export default function SantaHat({ size = 22, style }) {
  return (
    <svg
      className="xmas-santa-hat"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      style={style}
    >
      <path d="M8 44c2-20 14-34 34-34 4 0 8 1 11 3-4 2-6 6-6 10 0 10-8 18-21 21z" fill="#c0392b" />
      <path d="M6 42c8-3 20-4 34-1 8 2 14 5 18 9-6 2-14 3-24 2-12-1-22-4-28-10z" fill="#ffffff" />
      <circle cx="54" cy="13" r="6" fill="#ffffff" />
    </svg>
  );
}
