import { useState, useEffect, useRef, useMemo } from 'react';
import MarkdownContent from './MarkdownContent';

// Découpe à un endroit "sûr" pour le markdown : jamais au milieu d'un mot, ni au
// milieu d'un lien [texte](url) ou d'un gras **texte** — sinon react-markdown
// reçoit un token incomplet et l'affiche en texte brut pendant l'animation.
function safeCut(text, n) {
  if (n >= text.length) return text;

  let cut = n;
  // Recule jusqu'au début du mot en cours (une coupe en pleine URL ou en plein
  // identifiant de ticket produirait un rendu faux à chaque frame).
  while (cut > 0 && !/\s/.test(text[cut - 1])) cut--;
  if (cut <= 0) cut = n;

  const before = text.slice(0, cut);

  // Lien markdown non fermé : on recule jusqu'au "[" d'ouverture.
  const openBracket = before.lastIndexOf('[');
  if (openBracket !== -1 && before.indexOf(']', openBracket) === -1) {
    cut = openBracket;
  }

  // Gras non fermé (nombre impair de "**") : on recule jusqu'au "**" d'ouverture.
  if (((before.match(/\*\*/g) || []).length) % 2 === 1) {
    const lastBold = before.lastIndexOf('**');
    if (lastBold !== -1) cut = lastBold;
  }

  return text.slice(0, Math.max(0, cut));
}

// Durée bornée : proportionnelle à la longueur mais PLAFONNÉE. L'implémentation
// précédente (18 ms par caractère) mettait 36 s à afficher une réponse de
// 2000 caractères — d'où l'impression que le chatbot "bloquait".
function revealDuration(length) {
  return Math.min(2400, Math.max(450, length * 6));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// `running` ne contrôle QUE l'état de l'animation et n'est modifié que depuis le
// callback rAF (asynchrone) : aucun setState synchrone dans l'effet, ce qui
// déclenchait react-hooks/set-state-in-effect.
export default function TypewriterText({ content, isNew = true }) {
  const fullText = content || '';
  const total = fullText.length;
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const shouldAnimate = isNew && total > 0 && !reducedMotion;

  const [running, setRunning] = useState(shouldAnimate);
  const [revealed, setRevealed] = useState(shouldAnimate ? 0 : total);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!running) return undefined;

    const duration = revealDuration(total);
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      if (progress >= 1) {
        setRevealed(total);
        setRunning(false);
        frameRef.current = null;
        return;
      }
      // Accélération douce en fin de course : les derniers mots arrivent un peu
      // plus vite, ce qui donne l'impression d'une réponse qui "se pose".
      const eased = 1 - Math.pow(1 - progress, 1.35);
      setRevealed(Math.floor(eased * total));
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [running, total]);

  if (!fullText) return null;

  // Si `isNew` passe à false pendant l'animation (historique chargé de façon
  // asynchrone), on affiche immédiatement le texte complet plutôt que de laisser
  // l'animation se terminer sur un fragment.
  const animate = running && shouldAnimate;

  return (
    <span className="typewriter-wrapper">
      <MarkdownContent content={animate ? safeCut(fullText, revealed) : fullText} />
      {animate && <span className="typewriter-cursor" />}
    </span>
  );
}
